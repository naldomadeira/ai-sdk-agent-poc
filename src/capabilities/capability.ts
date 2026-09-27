import type { Pool } from "pg";
import type { z } from "zod";
import type { AppContext } from "@/application/context";
import { can, type Permission, type Principal } from "@/domain/auth/principal";
import { DomainError, type DomainErrorCode } from "@/domain/shared/errors";
import type { AuditChannel, AuditLogger } from "@/observability/audit-log";

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
  inputSchema: z.ZodType<I>;
  execute(input: I, ctx: CapabilityContext): Promise<O>;
}

export function defineCapability<I, O>(capability: Capability<I, O>): Capability<I, O> {
  return capability;
}

export type CapabilityErrorCode = DomainErrorCode | "INTERNAL";

export type CapabilityResult<O> =
  | { ok: true; data: O }
  | { ok: false; error: { code: CapabilityErrorCode; message: string; details?: unknown } };

export interface ApprovalEvidence {
  /** Id da aprovação emitida pelo canal (ex.: approvalId do AI SDK). */
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
  const base = {
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
  if (!can(ctx.principal, capability.permission)) {
    return fail("forbidden", "FORBIDDEN", `Sem permissão para ${capability.name}`);
  }
  if (capability.approval === "required" && !opts.approval) {
    return fail("forbidden", "APPROVAL_REQUIRED", `${capability.name} exige aprovação humana`);
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
