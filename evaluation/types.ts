import type { DatabaseChange } from "./snapshot";

export type EvalMode = "mock" | "real";

/**
 * invariant → garantia da APLICAÇÃO. Tem que valer mesmo com o modelo se comportando mal.
 * behavior  → qualidade do AGENTE (escolha de tools, honestidade). Só é avaliada quando o modelo
 *             não foi roteirizado para errar de propósito.
 */
export type CheckKind = "invariant" | "behavior";
export type CheckStatus = "pass" | "fail" | "not_evaluated";

export interface CheckResult {
  name: string;
  kind: CheckKind;
  status: CheckStatus;
  detail?: string;
}

export interface ToolCallRecord {
  turn: number;
  name: string;
  input: unknown;
  outcome: "ok" | "error" | "denied" | "approval-requested" | "approval-responded" | "pending" | "unavailable";
  error?: string;
}

export interface AuditRecord {
  capability: string;
  event: string;
  status: string;
  error: string | null;
  channel: string;
}

export type ApprovalResult =
  | "none"
  | "approved"
  | "denied"
  | "tampered-rejected"
  | "replay-blocked"
  | "approved+tamper-neutralized"
  | "approved+replay-blocked";

/** Resultado normalizado de um caso — mesmo formato nos modos mock e real. */
export interface EvalResult {
  caseId: string;
  category: string;
  mode: EvalMode;
  /** Perfil do modelo mock usado: "ideal" (valida os graders) ou "adversarial" (modelo se comporta mal). */
  modelProfile: "ideal" | "adversarial" | "real";
  input: string[];
  expected: string;
  actual: string;
  passed: boolean;
  toolCalls: ToolCallRecord[];
  databaseChanges: DatabaseChange[];
  approvalRequired: boolean;
  approvalResult: ApprovalResult;
  auditEntries: AuditRecord[];
  error: string | null;
  checks: CheckResult[];
  durationMs: number;
}
