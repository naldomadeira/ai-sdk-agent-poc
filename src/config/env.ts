import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url(),
  DATABASE_READONLY_URL: z.url(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_BASE_URL: z.url().optional(),
  AI_MODEL: z.string().min(1).default("claude-haiku-4-5-20251001"),
  TOOL_APPROVAL_SECRET: z.string().min(32, "TOOL_APPROVAL_SECRET precisa de 32+ caracteres"),
  AGENT_QUERY_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(3000),
  AGENT_QUERY_MAX_ROWS: z.coerce.number().int().min(1).max(1000).default(100),
  MCP_PRINCIPAL_ID: z.string().default("u_bruno"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Lido sob demanda para que `next build` não exija segredos em tempo de build. */
export function env(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Configuração inválida:\n${z.prettifyError(parsed.error)}`);
    }
    cached = parsed.data;
  }
  return cached;
}
