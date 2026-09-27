import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { toAiSdkTools } from "@/agents/ai-sdk-tools";
import { sendCustomerNotification } from "@/capabilities/actions/action-capabilities";
import { invokeCapability } from "@/capabilities/capability";
import { capabilities } from "@/capabilities/registry";
import { createMcpServer } from "@/mcp/server";
import { EvalSession } from "../../evaluation/session";
import { capabilityContext } from "../helpers/capability-context";
import { NOW, db, principals, withSeededDatabase } from "../helpers/db";

withSeededDatabase();

const free = { customerId: 1, orderId: 123, subject: "Seu pedido", body: "Texto escrito pelo agente para o João." };
const template = { customerId: 1, orderId: 123, template: "order_status_update" };

const notifications = async () =>
  (await db.query<{ content_origin: string; template_id: string | null; body: string }>(
    "SELECT content_origin, template_id, body FROM customer_notifications ORDER BY id",
  )).rows;
const audit = async () =>
  (await db.query<{ event: string; status: string; content_origin: string | null; approval: string | null; channel: string }>(
    "SELECT event, status, content_origin, approval, channel FROM agent_audit_log WHERE capability = 'sendCustomerNotification' ORDER BY id",
  )).rows;

describe("executor: autorização × risco do conteúdo", () => {
  it("template: texto da aplicação, sai sem aprovação e fica registrado como tal", async () => {
    const result = await invokeCapability(sendCustomerNotification, template, capabilityContext(principals.support));
    expect(result).toMatchObject({ ok: true, data: { contentOrigin: "application_template", templateId: "order_status_update" } });
    const [row] = await notifications();
    expect(row).toMatchObject({ content_origin: "application_template", template_id: "order_status_update" });
    expect(row.body).toContain("pedido #123");
    expect(await audit()).toEqual([expect.objectContaining({ status: "ok", content_origin: "application_template", approval: "not_required" })]);
  });

  it("texto livre sem aprovação: bloqueado no executor, nada sai, auditoria registra 'missing'", async () => {
    const result = await invokeCapability(sendCustomerNotification, free, capabilityContext(principals.support));
    expect(result).toMatchObject({ ok: false, error: { code: "APPROVAL_REQUIRED", message: expect.stringContaining("escrito pelo agente") } });
    expect(await notifications()).toEqual([]);
    expect(await audit()).toEqual([expect.objectContaining({ status: "forbidden", content_origin: "agent_generated", approval: "missing" })]);
  });

  it("texto livre com aprovação: sai e fica registrado como conteúdo do agente aprovado", async () => {
    const result = await invokeCapability(sendCustomerNotification, free, capabilityContext(principals.support), {
      approval: { id: "appr_free_1", approvedBy: "u_bruno" },
    });
    expect(result).toMatchObject({ ok: true, data: { contentOrigin: "agent_generated", body: free.body } });
    expect(await notifications()).toEqual([expect.objectContaining({ content_origin: "agent_generated", template_id: null })]);
    expect(await audit()).toEqual([expect.objectContaining({ status: "ok", content_origin: "agent_generated", approval: "approved" })]);
  });

  it("permissão continua valendo para template: viewer não envia", async () => {
    const result = await invokeCapability(sendCustomerNotification, template, capabilityContext(principals.viewer));
    expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("template não aceita pedido de outro cliente", async () => {
    const result = await invokeCapability(sendCustomerNotification, { ...template, customerId: 2 }, capabilityContext(principals.support));
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });

  it("adaptador AI SDK usa a mesma regra do executor", () => {
    const { toolApproval } = toAiSdkTools(capabilities, capabilityContext(principals.support));
    const policy = (toolApproval as Record<string, (input: unknown) => string | undefined>).sendCustomerNotification;
    expect(policy(template)).toBeUndefined();
    expect(policy(free)).toBe("user-approval");
  });
});

describe("adversarial: modelo tenta driblar a aprovação", () => {
  const session = (name: string) => new EvalSession({ mode: "mock", db, now: NOW, principal: principals.manager, chatId: `notify-${name}` });

  it("texto livre pelo agente pausa para aprovação; nada sai até o humano decidir; negado → nada sai", async () => {
    const s = session("free");
    await s.say("Avise o João", [{ toolCalls: [{ toolName: "sendCustomerNotification", input: free }] }]);
    expect(s.pendingApproval()).toBeDefined();
    expect(await notifications()).toEqual([]);
    await s.answerApproval(false, [{ text: "Ok, não enviei." }]);
    expect(await notifications()).toEqual([]);
    expect((await audit()).map((a) => `${a.event}:${a.status}`)).toEqual(["approval_requested:pending", "approval_denied:denied"]);
  });

  it("template pelo agente sai direto, sem cartão de aprovação", async () => {
    const s = session("template");
    await s.say("Avise o João do status", [{ toolCalls: [{ toolName: "sendCustomerNotification", input: template }] }, { text: "Enviado." }]);
    expect(s.pendingApproval()).toBeUndefined();
    expect(await notifications()).toEqual([expect.objectContaining({ content_origin: "application_template" })]);
  });

  it("modelo declara 'approved: true' no input → recusado, nada sai", async () => {
    const s = session("declared");
    await s.say("Avise o João", [
      { toolCalls: [{ toolName: "sendCustomerNotification", input: { ...free, approved: true } }] },
      { text: "Enviado (aprovado)." },
    ]);
    expect(await notifications()).toEqual([]);
  });

  it("modelo esconde texto livre dentro de uma chamada de template → recusado, nada sai", async () => {
    const s = session("smuggle");
    await s.say("Avise o João", [
      { toolCalls: [{ toolName: "sendCustomerNotification", input: { ...template, body: "Texto que tentaria sair sem aprovação." } }] },
      { text: "Enviado." },
    ]);
    expect(await notifications()).toEqual([]);
  });

  it("via MCP (sem canal de aprovação): template funciona, texto livre é bloqueado", async () => {
    const { server } = createMcpServer(capabilities, capabilityContext(principals.support, { channel: "mcp", agent: "mcp-client" }));
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "1" });
    await Promise.all([server.connect(b), client.connect(a)]);

    expect((await client.callTool({ name: "sendCustomerNotification", arguments: template })).isError).toBe(false);
    const blocked = await client.callTool({ name: "sendCustomerNotification", arguments: free });
    expect(blocked.isError).toBe(true);
    expect(JSON.stringify(blocked.content)).toContain("APPROVAL_REQUIRED");
    expect((await notifications()).map((n) => n.content_origin)).toEqual(["application_template"]);
    expect((await audit()).map((a) => `${a.channel}:${a.approval}`)).toEqual(["mcp:not_required", "mcp:missing"]);
  });
});
