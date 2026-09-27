import type { CapabilityContext } from "@/capabilities/capability";
import type { Principal } from "@/domain/auth/principal";
import { appPool, createDatabase, readonlyPool } from "@/infrastructure/db/pool";
import { createAuditLogger } from "@/observability/audit-log";

/** Monta o contexto de execução de capabilities para um principal já autenticado. */
export function createCapabilityContext(
  principal: Principal,
  opts: { channel: CapabilityContext["channel"]; agent: string; chatId?: string },
): CapabilityContext {
  const db = createDatabase(appPool());
  return {
    app: { db, now: () => new Date() },
    readonlyPool: readonlyPool(),
    principal,
    audit: createAuditLogger(db),
    ...opts,
  };
}
