import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

/**
 * Garante a role somente-leitura do agente. Roles são globais no cluster,
 * então isto roda antes das migrations (que só fazem GRANT).
 */
async function ensureReadonlyRole(pool: Pool, readonlyUrl: string) {
  const { username, password } = new URL(readonlyUrl);
  const role = decodeURIComponent(username);
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`Nome de role inválido: ${role}`);
  const { rows } = await pool.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
  const escapedPassword = decodeURIComponent(password).replaceAll("'", "''");
  const verb = rows.length ? "ALTER" : "CREATE";
  // NOSUPERUSER/NOCREATEDB/NOCREATEROLE explícitos; senha não aceita parâmetro em DDL.
  await pool.query(
    `${verb} ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${escapedPassword}'`,
  );
  // Padrão para toda sessão dessa role: somente leitura.
  await pool.query(`ALTER ROLE ${role} SET default_transaction_read_only = on`);
}

export async function migrate(pool: Pool, readonlyUrl: string, log = console.log) {
  await ensureReadonlyRole(pool, readonlyUrl);
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const { rows } = await pool.query<{ name: string }>("SELECT name FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      log(`migrated ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Falha na migration ${file}: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }
}

/** Apaga tudo (uso: db:reset e testes). */
export async function dropAll(pool: Pool) {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
}
