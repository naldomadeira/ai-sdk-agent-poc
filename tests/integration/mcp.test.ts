import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { capabilities } from "@/capabilities/registry";
import type { Principal } from "@/domain/auth/principal";
import { createMcpServer } from "@/mcp/server";
import { auditRows, capabilityContext } from "../helpers/capability-context";
import { principals, withSeededDatabase } from "../helpers/db";

withSeededDatabase();

async function connect(principal: Principal) {
  const { server } = createMcpServer(capabilities, capabilityContext(principal, { channel: "mcp", agent: "mcp-client" }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("MCP — mesmas capabilities, outro transporte", () => {
  it("expõe capabilities permitidas e sem aprovação humana obrigatória", async () => {
    const client = await connect(principals.manager);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    // sendCustomerNotification aparece: com template roda; com texto livre o executor exige aprovação.
    expect(names).toEqual(["cancelOrder", "inspectSchema", "prepareLateOrderNotifications", "queryDatabase", "sendCustomerNotification"]);
    expect(tools.find((t) => t.name === "queryDatabase")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "queryDatabase")?.inputSchema.required).toContain("sql");
  });

  it("viewer via MCP só lê", async () => {
    const { tools } = await (await connect(principals.viewer)).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["inspectSchema", "queryDatabase"]);
  });

  it("chamada passa pela mesma validação e auditoria", async () => {
    const client = await connect(principals.viewer);
    const ok = await client.callTool({ name: "queryDatabase", arguments: { sql: "SELECT count(*)::int AS n FROM orders", purpose: "contar" } });
    expect(ok.isError).toBe(false);
    expect(JSON.parse((ok.content as { text: string }[])[0].text).rows).toEqual([{ n: 41 }]);

    const blocked = await client.callTool({ name: "queryDatabase", arguments: { sql: "DELETE FROM orders", purpose: "ataque" } });
    expect(blocked.isError).toBe(true);

    expect((await auditRows("queryDatabase")).map((r) => `${r.channel}:${r.status}`)).toEqual(["mcp:ok", "mcp:error"]);
  });
});
