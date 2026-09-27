import type { Pool } from "pg";
import type { z } from "zod";
import type { AppContext } from "@/application/context";
import { can, type Permission, type Principal } from "@/domain/auth/principal";
import type { ContentOrigin } from "@/domain/notifications/notification";
import { DomainError, type DomainErrorCode } from "@/domain/shared/errors";
import type { AuditChannel, AuditEntry, AuditLogger } from "@/observability/audit-log";

/**
 * Capability = uma coisa que a aplicação sabe fazer, descrita de forma que um agente
 * (AI SDK, MCP ou outro) possa escolher e invocar. Não conhece nenhum transporte.
 *
 *  read      → consulta, sem efeito colateral
 *  action    → operação de negócio (delegada a um use case)
 *  workflow  → processo determinístico de várias etapas
 */
export type CapabilityKind = "read" | "action" | "workflow";

export interface CapabilityContext {
  app: AppContext;
  /** Pool da role agent_readonly (somente leitura no Postgres). */
  readonlyPool: Pool;
  principal: Principal;
  audit: AuditLogger;
  channel: AuditChannel;
  agent: string;
  chatId?: string;
}

export interface Capability<I = unknown, O = unknown> {
  name: string;
  description: string;
  kind: CapabilityKind;
  /** Permissão mínima para *ver* e invocar. O use case valida de novo (defesa em profundidade). */
  permission: Permission;
  /** `required` → só executa com evidência de aprovação humana. */
  approval: "none" | "required";
  /**
   * Para capabilities que produzem conteúdo para terceiros: de onde vem o texto, derivado da FORMA do
   * input validado (nunca de um campo que o modelo declare). `agent_generated` sempre exige aprovação,
   * mesmo com `approval: "none"` — ver `requiresApproval`.
   */
  contentOrigin?(input: I): ContentOrigin;
  /**
   * Para capabilities com aprovação cujo alvo pode ser decidido por outro caminho (ex.: execução de
   * workflow aprovada por outra pessoa): devolve o motivo se o pedido pendente já não pode mais ser decidido.
   */
  pendingApprovalStatus?(input: I, app: AppContext): Promise<{ code: "ALREADY_DECIDED"; message: string } | null>;
  inputSchema: z.ZodType<I>;
  execute(input: I, ctx: CapabilityContext): Promise<O>;
}

/**
 * Regra única de aprovação, usada pelo executor e pelos adaptadores (AI SDK):
 * exige aprovação humana se a capability é `required` OU se o conteúdo externo foi escrito pelo agente.
 * Autorização (permissão) e risco do conteúdo são decisões separadas: esta função só trata a segunda.
 */
export function requiresApproval<I>(capability: Capability<I, unknown>, input: I): boolean {
  return capability.approval === "required" || capability.contentOrigin?.(input) === "agent_generated";
}

export function defineCapability<I, O>(capability: Capability<I, O>): Capability<I, O> {
  return capability;
}

export type CapabilityErrorCode = DomainErrorCode | "APPROVAL_ALREADY_USED" | "INTERNAL";

export type CapabilityResult<O> =
  | { ok: true; data: O }
  | { ok: false; error: { code: CapabilityErrorCode; message: string; details?: unknown } };

export interface ApprovalEvidence {
  /** Id único da aprovação no canal (no AI SDK, o toolCallId aprovado). Consumido uma única vez. */
  id: string;
  approvedBy: string;
}

/** Capabilities que o principal pode ver. Quem não tem permissão nem recebe a tool. */
export function capabilitiesFor(all: readonly Capability[], principal: Principal): Capability[] {
  return all.filter((c) => can(principal, c.permission));
}

/**
 * Único ponto de execução de capabilities, para todo canal:
 * valida input → verifica permissão → exige aprovação → executa → audita.
 * Erros de negócio viram resultado estruturado (o agente explica em vez de quebrar);
 * erros inesperados não vazam detalhes internos.
 */
export async function invokeCapability<I, O>(
  capability: Capability<I, O>,
  rawInput: unknown,
  ctx: CapabilityContext,
  opts: { approval?: ApprovalEvidence } = {},
): Promise<CapabilityResult<O>> {
  const started = Date.now();
  const base: Omit<AuditEntry, "status"> = {
    actorId: ctx.principal.id,
    actorRole: ctx.principal.role,
    agent: ctx.agent,
    channel: ctx.channel,
    chatId: ctx.chatId,
    capability: capability.name,
    event: "capability_call" as const,
    approvalId: opts.approval?.id,
  };

  const fail = async (
    status: "invalid" | "forbidden" | "error",
    code: CapabilityErrorCode,
    message: string,
    details?: unknown,
  ): Promise<CapabilityResult<O>> => {
    await ctx.audit.record({ ...base, status, input: rawInput, error: `${code}: ${message}`, durationMs: Date.now() - started });
    return { ok: false, error: { code, message, details } };
  };

  const parsed = capability.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return fail("invalid", "INVALID_INPUT", "Parâmetros inválidos", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  // Proveniência e necessidade de aprovação são decididas aqui, sobre o input JÁ validado.
  const contentOrigin = capability.contentOrigin?.(parsed.data);
  const needsApproval = requiresApproval(capability, parsed.data);
  Object.assign(base, {
    contentOrigin,
    approval: needsApproval ? (opts.approval ? "approved" : "missing") : "not_required",
  });

  if (!can(ctx.principal, capability.permission)) {
    return fail("forbidden", "FORBIDDEN", `Sem permissão para ${capability.name}`);
  }
  if (needsApproval) {
    if (!opts.approval) {
      const why = contentOrigin === "agent_generated" ? " (conteúdo escrito pelo agente)" : "";
      return fail("forbidden", "APPROVAL_REQUIRED", `${capability.name} exige aprovação humana${why}`);
    }
    // Uso único: reapresentar a mesma aprovação (replay) não executa de novo, em nenhum canal.
    const { rowCount } = await ctx.app.db.query(
      `INSERT INTO consumed_approvals (approval_id, capability, consumed_by) VALUES ($1, $2, $3)
       ON CONFLICT (approval_id) DO NOTHING`,
      [opts.approval.id, capability.name, ctx.principal.id],
    );
    if (!rowCount) return fail("forbidden", "APPROVAL_ALREADY_USED", "Esta aprovação já foi utilizada");
  }

  try {
    const data = await capability.execute(parsed.data, ctx);
    await ctx.audit.record({ ...base, status: "ok", input: parsed.data, output: data, durationMs: Date.now() - started });
    return { ok: true, data };
  } catch (error) {
    if (error instanceof DomainError) {
      return fail(error.code === "FORBIDDEN" ? "forbidden" : "error", error.code, error.message, error.details);
    }
    console.error(`capability ${capability.name} failed`, error);
    return fail("error", "INTERNAL", "Erro interno ao executar a operação");
  }
}
