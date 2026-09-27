import { config } from "dotenv";

/**
 * Deriva as URLs do banco de teste (commerce_test) a partir das de dev, a menos que
 * TEST_DATABASE_URL / TEST_DATABASE_READONLY_URL estejam definidas.
 */
export function loadTestEnv() {
  config({ path: ".env.local", quiet: true });
  config({ quiet: true });

  const toTestDb = (url: string) => {
    const u = new URL(url);
    u.pathname = "/commerce_test";
    return u.toString();
  };
  const base = process.env.DATABASE_URL ?? "postgres://commerce:commerce_dev_password@localhost:5467/commerce";
  const readonly =
    process.env.DATABASE_READONLY_URL ??
    "postgres://agent_readonly:agent_readonly_dev_password@localhost:5467/commerce";

  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? toTestDb(base);
  process.env.DATABASE_READONLY_URL = process.env.TEST_DATABASE_READONLY_URL ?? toTestDb(readonly);
  process.env.TOOL_APPROVAL_SECRET = "test-secret-test-secret-test-secret-0123";
  process.env.AGENT_QUERY_TIMEOUT_MS = "500";
  process.env.AGENT_QUERY_MAX_ROWS = "20";
  // Testes nunca chamam o LLM real.
  delete process.env.ANTHROPIC_API_KEY;
}
