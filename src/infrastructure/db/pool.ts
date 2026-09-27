import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { env } from "@/config/env";

/** Qualquer coisa que execute SQL: o Pool ou um client dentro de transação. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

export interface Database extends Queryable {
  /** Executa `fn` numa transação; faz rollback se lançar. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

export function createDatabase(pool: Pool): Database {
  return {
    query: (text, values) => pool.query(text, values),
    async transaction(fn) {
      const client: PoolClient = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

// Pools únicos por processo (sobrevivem ao hot reload do Next em dev).
const globalPools = globalThis as unknown as {
  __appPool?: Pool;
  __readonlyPool?: Pool;
};

/** Pool da aplicação (repositórios/use cases). */
export function appPool(): Pool {
  globalPools.__appPool ??= new Pool({ connectionString: env().DATABASE_URL, max: 10 });
  return globalPools.__appPool;
}

/** Pool da role agent_readonly — usado exclusivamente por queryDatabase/inspectSchema. */
export function readonlyPool(): Pool {
  globalPools.__readonlyPool ??= new Pool({
    connectionString: env().DATABASE_READONLY_URL,
    max: 5,
  });
  return globalPools.__readonlyPool;
}

/** Fecha e esquece os pools (scripts e testes). */
export async function closePools(): Promise<void> {
  const pools = [globalPools.__appPool, globalPools.__readonlyPool];
  globalPools.__appPool = undefined;
  globalPools.__readonlyPool = undefined;
  await Promise.all(pools.map((p) => p?.end()));
}
