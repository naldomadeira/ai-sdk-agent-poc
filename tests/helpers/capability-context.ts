import type { CapabilityContext } from "@/capabilities/capability";
import type { Principal } from "@/domain/auth/principal";
import { readonlyPool } from "@/infrastructure/db/pool";
import { createAuditLogger } from "@/observability/audit-log";
import { ctx as app, db } from "./db";

export function capabilityContext(principal: Principal, over: Partial<CapabilityContext> = {}): CapabilityContext {
  return {
    app,
    readonlyPool: readonlyPool(),
    principal,
    audit: createAuditLogger(db, { console: false }),
    channel: "test",
    agent: "test",
    ...over,
  };
}

export async function auditRows(capability?: string) {
  const { rows } = await db.query<{ capability: string; event: string; status: string; actor_id: string; channel: string; error: string | null; input: unknown; output: unknown; approval_id: string | null }>(
    `SELECT capability, event, status, actor_id, channel, error, input, output, approval_id FROM agent_audit_log
     WHERE $1::text IS NULL OR capability = $1 ORDER BY id`,
    [capability ?? null],
  );
  return rows;
}
