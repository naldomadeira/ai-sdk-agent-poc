import { tool, type ToolApprovalConfiguration, type ToolSet } from "ai";
import {
  capabilitiesFor,
  invokeCapability,
  type Capability,
  type CapabilityContext,
} from "@/capabilities/capability";

/**
 * Adaptador capability → tool do AI SDK.
 *
 * - O agente só recebe as tools que o usuário tem permissão de usar.
 * - Capabilities com `approval: "required"` viram `toolApproval: "user-approval"`: o AI SDK pausa,
 *   a UI pede confirmação e só então chama `execute` (aprovação assinada com HMAC no agente).
 * - `execute` sempre passa por `invokeCapability` (validação, permissão, auditoria).
 */
export function toAiSdkTools(all: readonly Capability[], ctx: CapabilityContext) {
  const allowed = capabilitiesFor(all, ctx.principal);
  const tools: ToolSet = {};
  const toolApproval: Record<string, "user-approval"> = {};

  for (const capability of allowed) {
    tools[capability.name] = tool({
      description: capability.description,
      inputSchema: capability.inputSchema,
      execute: (input: unknown, { toolCallId }) =>
        invokeCapability(capability, input, ctx, {
          // O AI SDK só chega aqui após a resposta de aprovação (verificada pela assinatura).
          approval: capability.approval === "required" ? { id: toolCallId, approvedBy: ctx.principal.id } : undefined,
        }),
    });
    if (capability.approval === "required") toolApproval[capability.name] = "user-approval";
  }

  return { tools, toolApproval: toolApproval as ToolApprovalConfiguration<ToolSet, never> };
}
