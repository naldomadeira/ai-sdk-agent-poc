/**
 * Servidor MCP (stdio) com as capabilities da aplicação.
 *   pnpm mcp            (uso manual)
 * Em clientes MCP, chame o tsx direto — `pnpm run` escreve um cabeçalho no stdout e corrompe o protocolo:
 *   { "command": "<caminho>/ai-sdk/node_modules/.bin/tsx", "args": ["scripts/mcp-server.ts"], "cwd": "<caminho>/ai-sdk" }
 * Opera em nome de MCP_PRINCIPAL_ID (usuário de serviço), com as permissões dessa role.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true });

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCapabilityContext } from "../src/agents/capability-context";
import { capabilities } from "../src/capabilities/registry";
import { env } from "../src/config/env";
import { appPool } from "../src/infrastructure/db/pool";
import { staffRepository } from "../src/infrastructure/db/repositories/staff-repository";
import { createMcpServer } from "../src/mcp/server";

async function main() {
  // stdout é o canal do protocolo: logs vão para stderr.
  console.info = console.error;
  const principal = await staffRepository.findById(appPool(), env().MCP_PRINCIPAL_ID);
  if (!principal) throw new Error(`MCP_PRINCIPAL_ID ${env().MCP_PRINCIPAL_ID} não existe em staff_users`);

  const ctx = createCapabilityContext(principal, { channel: "mcp", agent: "mcp-client" });
  const { server, exposed } = createMcpServer(capabilities, ctx);
  await server.connect(new StdioServerTransport());
  console.error(`MCP pronto como ${principal.name} (${principal.role}): ${exposed.join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
