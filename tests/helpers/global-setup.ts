import { Pool } from "pg";
import { dropAll, migrate } from "../../src/infrastructure/db/migrate";
import { loadTestEnv } from "./test-env";

/** Recria o schema do banco de teste uma vez por execução. */
export default async function setup() {
  loadTestEnv();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await dropAll(pool);
    await migrate(pool, process.env.DATABASE_READONLY_URL!, () => {});
  } finally {
    await pool.end();
  }
}
