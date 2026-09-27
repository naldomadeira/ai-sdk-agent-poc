/**
 * CLI de banco: `tsx scripts/db.ts migrate|seed|reset`.
 * Usa DATABASE_URL / DATABASE_READONLY_URL de .env.local.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true });

import { Pool } from "pg";
import { dropAll, migrate } from "../src/infrastructure/db/migrate";
import { seed } from "../src/infrastructure/db/seed";

async function main() {
  const command = process.argv[2];
  const url = process.env.DATABASE_URL;
  const readonlyUrl = process.env.DATABASE_READONLY_URL;
  if (!url || !readonlyUrl) throw new Error("Defina DATABASE_URL e DATABASE_READONLY_URL (.env.local)");

  const pool = new Pool({ connectionString: url });
  try {
    if (command === "reset") await dropAll(pool);
    if (command === "migrate" || command === "reset") await migrate(pool, readonlyUrl);
    if (command === "seed" || command === "reset") {
      await seed(pool);
      console.log("seed ok");
    }
    if (!["migrate", "seed", "reset"].includes(command ?? "")) {
      throw new Error("Uso: tsx scripts/db.ts migrate|seed|reset");
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
