import { invokeCapability, type ApprovalEvidence, type Capability, type CapabilityResult } from "@/capabilities/capability";
import { appPool, createDatabase, readonlyPool, type Database } from "@/infrastructure/db/pool";
import { seed, STAFF } from "@/infrastructure/db/seed";
import { createAuditLogger } from "@/observability/audit-log";
import type { Principal, Role } from "@/domain/auth/principal";
import { EvalSession } from "./session";
import { diff, snapshot, type DatabaseChange, type Snapshot } from "./snapshot";
import type { ApprovalResult, AuditRecord, CheckResult, EvalMode, EvalResult, ToolCallRecord } from "./types";

export const PRINCIPALS: Record<Role, Principal> = {
  manager: { ...STAFF[0] },
  support: { ...STAFF[1] },
  viewer: { ...STAFF[2] },
};

export interface CaseContext {
  mode: EvalMode;
  db: Database;
  now: Date;
  /** Nova conversa pelo caminho HTTP real. */
  session(role: Role, name?: string): EvalSession;
  /** Chamada direta a uma capability (sem modelo) — testa a camada de aplicação isoladamente. */
  invoke<I, O>(capability: Capability<I, O>, input: unknown, role: Role, approval?: ApprovalEvidence): Promise<CapabilityResult<O>>;
  /** Executa SQL cru na conexão agent_readonly, sem o guard: prova a camada do Postgres. Devolve o erro ou null. */
  rawReadonly(sql: string): Promise<string | null>;
  /** Mudanças no banco desde o início do caso. */
  changes(): Promise<DatabaseChange[]>;
  audit(): Promise<AuditRecord[]>;
  count(sql: string, values?: unknown[]): Promise<number>;
}

export interface CaseOutcome {
  actual: string;
  checks: CheckResult[];
  approvalRequired: boolean;
  approvalResult: ApprovalResult;
}

export interface EvalCase {
  id: string;
  category: string;
  title: string;
  input: string[];
  expected: string;
  /** Perfil do modelo mock: ideal (valida os graders) ou adversarial (modelo se comporta mal). */
  mockProfile: "ideal" | "adversarial";
  setup?(db: Database): Promise<void>;
  run(ctx: CaseContext): Promise<CaseOutcome>;
}

async function auditEntries(db: Database): Promise<AuditRecord[]> {
  const { rows } = await db.query<AuditRecord>(
    "SELECT capability, event, status, error, channel FROM agent_audit_log ORDER BY id",
  );
  return rows;
}

export async function runCase(evalCase: EvalCase, mode: EvalMode): Promise<EvalResult> {
  const started = Date.now();
  const db = createDatabase(appPool());
  const now = new Date();
  await seed(db, now);
  await evalCase.setup?.(db);
  const before: Snapshot = await snapshot(db);

  const sessions: EvalSession[] = [];
  const direct: ToolCallRecord[] = [];
  const ctx: CaseContext = {
    mode,
    db,
    now,
    session(role, name) {
      const s = new EvalSession({ mode, db, now, principal: PRINCIPALS[role], chatId: `eval-${evalCase.id}-${name ?? sessions.length + 1}` });
      sessions.push(s);
      return s;
    },
    async invoke(capability, input, role, approval) {
      const result = await invokeCapability(capability, input, {
        app: { db, now: () => now },
        readonlyPool: readonlyPool(),
        principal: PRINCIPALS[role],
        audit: createAuditLogger(db, { console: false }),
        channel: "test",
        agent: "evaluation-harness",
        chatId: `eval-${evalCase.id}-direct`,
      }, { approval });
      direct.push({
        turn: 0,
        name: capability.name,
        input,
        outcome: result.ok ? "ok" : "error",
        error: result.ok ? undefined : `${result.error.code}: ${result.error.message}`,
      });
      return result;
    },
    async rawReadonly(sql) {
      try {
        await readonlyPool().query(sql);
        return null;
      } catch (error) {
        return (error as Error).message;
      }
    },
    changes: async () => diff(before, await snapshot(db)),
    audit: () => auditEntries(db),
    async count(sql, values) {
      const { rows } = await db.query<{ n: number }>(sql, values);
      return Number(rows[0]?.n ?? 0);
    },
  };

  let outcome: CaseOutcome | undefined;
  let error: string | null = null;
  try {
    outcome = await evalCase.run(ctx);
  } catch (e) {
    error = (e as Error).stack ?? String(e);
  }

  const toolCalls = [...(await Promise.all(sessions.map((s) => s.toolCalls()))).flat(), ...direct];
  const checks = outcome?.checks ?? [];
  return {
    caseId: evalCase.id,
    category: evalCase.category,
    mode,
    modelProfile: mode === "real" ? "real" : evalCase.mockProfile,
    input: evalCase.input,
    expected: evalCase.expected,
    actual: outcome?.actual ?? "",
    passed: !error && checks.length > 0 && checks.every((c) => c.status !== "fail"),
    toolCalls,
    databaseChanges: diff(before, await snapshot(db)),
    approvalRequired: outcome?.approvalRequired ?? false,
    approvalResult: outcome?.approvalResult ?? "none",
    auditEntries: await auditEntries(db),
    error,
    checks,
    durationMs: Date.now() - started,
  };
}

export async function runAll(cases: EvalCase[], mode: EvalMode, onResult?: (r: EvalResult) => void) {
  const results: EvalResult[] = [];
  for (const c of cases) {
    const result = await runCase(c, mode);
    onResult?.(result);
    results.push(result);
  }
  return results;
}

/** Relatório em markdown (tabela por caso + checks que falharam). */
export function toMarkdown(results: EvalResult[]): string {
  const passed = results.filter((r) => r.passed).length;
  const lines = [
    `**${passed}/${results.length} casos aprovados** — modo \`${results[0]?.mode}\``,
    "",
    "| Caso | Categoria | Modelo | Resultado | Invariantes | Comportamento | Aprovação | Efeitos no banco |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const r of results) {
    const count = (kind: string) => {
      const cs = r.checks.filter((c) => c.kind === kind);
      const evaluated = cs.filter((c) => c.status !== "not_evaluated");
      return evaluated.length ? `${evaluated.filter((c) => c.status === "pass").length}/${evaluated.length}` : "—";
    };
    lines.push(
      `| ${r.caseId} | ${r.category} | ${r.modelProfile} | ${r.error ? "💥 erro" : r.passed ? "✅" : "❌"} | ${count("invariant")} | ${count("behavior")} | ${r.approvalResult} | ${r.databaseChanges.length} |`,
    );
  }
  const failures = results.flatMap((r) =>
    r.checks.filter((c) => c.status === "fail").map((c) => `- **${r.caseId}** [${c.kind}] ${c.name}${c.detail ? ` — ${c.detail.slice(0, 200)}` : ""}`),
  );
  const errors = results.filter((r) => r.error).map((r) => `- **${r.caseId}** erro: ${r.error!.split("\n")[0]}`);
  if (failures.length || errors.length) lines.push("", "Falhas:", "", ...failures, ...errors);
  return lines.join("\n");
}
