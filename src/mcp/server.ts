import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import { capabilitiesFor, invokeCapability, type Capability, type CapabilityContext } from "@/capabilities/capability";

/**
 * Adaptador capability → MCP. Mesmo registry, mesma autorização e auditoria do agente web.
 *
 * Fase atual: capabilities com aprovação humana NÃO são expostas via MCP — o protocolo
 * ainda não tem aqui um canal de aprovação ligado a um humano da aplicação. Próximo passo:
 * elicitation do MCP ou uma fila de aprovações na UI.
 */
export function createMcpServer(all: readonly Capability[], ctx: CapabilityContext) {
  const server = new McpServer({ name: "commerce-capabilities", version: "0.1.0" });
  const exposed = capabilitiesFor(all, ctx.principal).filter((c) => c.approval === "none");

  for (const capability of exposed) {
    server.registerTool(
      capability.name,
      {
        description: capability.description,
        // Todas as capabilities usam z.object; o SDK MCP aceita Zod 4 diretamente.
        inputSchema: capability.inputSchema as unknown as z.ZodObject<z.ZodRawShape>,
        annotations: {
          readOnlyHint: capability.kind === "read",
          destructiveHint: capability.kind !== "read",
        },
      },
      async (input) => {
        const result = await invokeCapability(capability, input, ctx);
        return {
          isError: !result.ok,
          content: [{ type: "text" as const, text: JSON.stringify(result.ok ? result.data : result.error) }],
        };
      },
    );
  }

  return { server, exposed: exposed.map((c) => c.name) };
}
