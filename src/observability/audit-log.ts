import type { Queryable } from "@/infrastructure/db/pool";

export type AuditChannel = "agent" | "mcp" | "workflow" | "test";
export type AuditEvent = "capability_call" | "approval_requested" | "approval_granted" | "approval_denied";
export type AuditStatus = "ok" | "error" | "forbidden" | "invalid" | "pending" | "denied";

export interface AuditEntry {
  actorId: string;
  actorRole: string;
  agent: string;
  channel: AuditChannel;
  chatId?: string;
  capability: string;
  event: AuditEvent;
  status: AuditStatus;
  input?: unknown;
  output?: unknown;
  error?: string;
  approvalId?: string;
  durationMs?: number;
}

export interface AuditLogger {
  record(entry: AuditEntry): Promise<void>;
}

const MAX_JSON_BYTES = 8_000;

/** Resultados grandes (ex.: linhas de uma query) são resumidos para não inflar o log. */
function compact(value: unknown): unknown {
  if (value === undefined) return null;
  const json = JSON.stringify(value);
  if (json.length <= MAX_JSON_BYTES) return value;
  return { truncated: true, bytes: json.length, preview: json.slice(0, 1_000) };
}

/**
 * Registra no Postgres (consultável em /audit) e no console como JSON estruturado.
 * Falha de auditoria não derruba a operação, mas é logada como erro.
 */
export function createAuditLogger(db: Queryable, opts: { console?: boolean } = {}): AuditLogger {
  return {
    async record(entry) {
      if (opts.console ?? true) {
        console.info(JSON.stringify({ type: "agent_audit", at: new Date().toISOString(), ...entry, input: compact(entry.input), output: undefined }));
      }
      try {
        await db.query(
          `INSERT INTO agent_audit_log (actor_id, actor_role, agent, channel, chat_id, capability, event, status,
             input, output, error, approval_id, duration_ms)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            entry.actorId, entry.actorRole, entry.agent, entry.channel, entry.chatId ?? null, entry.capability,
            entry.event, entry.status, JSON.stringify(compact(entry.input)), JSON.stringify(compact(entry.output)),
            entry.error ?? null, entry.approvalId ?? null, entry.durationMs ?? null,
          ],
        );
      } catch (error) {
        console.error("audit log write failed", error);
      }
    },
  };
}

export interface AuditRow {
  id: number;
  occurred_at: Date;
  actor_id: string;
  actor_role: string;
  agent: string;
  channel: string;
  chat_id: string | null;
  capability: string;
  event: string;
  status: string;
  input: unknown;
  output: unknown;
  error: string | null;
  approval_id: string | null;
  duration_ms: number | null;
}

export async function recentAuditEntries(db: Queryable, limit = 100): Promise<AuditRow[]> {
  const { rows } = await db.query<AuditRow>(
    "SELECT * FROM agent_audit_log ORDER BY occurred_at DESC, id DESC LIMIT $1",
    [limit],
  );
  return rows;
}
