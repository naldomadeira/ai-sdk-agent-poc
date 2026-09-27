import { tool, type ToolApprovalConfiguration, type ToolSet } from "ai";
import {
  capabilitiesFor,
  invokeCapability,
  requiresApproval,
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
  const toolApproval: Record<string, "user-approval" | ((input: unknown) => "user-approval" | undefined)> = {};

  for (const capability of allowed) {
    // Mesma regra do executor. O input que chega aqui já foi validado pelo AI SDK contra o schema;
    // a classificação vem da forma do input, não de algo que o modelo declare.
    const needsApproval = (input: unknown) => requiresApproval(capability, input);
    tools[capability.name] = tool({
      description: capability.description,
      inputSchema: capability.inputSchema,
      execute: (input: unknown, { toolCallId }) =>
        invokeCapability(capability, input, ctx, {
          // O AI SDK só chega aqui, para inputs que exigem aprovação, após a resposta de aprovação
          // (verificada pela assinatura). O id é consumido uma única vez pelo executor.
          approval: needsApproval(input) ? { id: toolCallId, approvedBy: ctx.principal.id } : undefined,
        }),
    });
    if (capability.approval === "required") toolApproval[capability.name] = "user-approval";
    else if (capability.contentOrigin) {
      toolApproval[capability.name] = (input) => (needsApproval(input) ? "user-approval" : undefined);
    }
  }

  return { tools, toolApproval: toolApproval as ToolApprovalConfiguration<ToolSet, never> };
}
