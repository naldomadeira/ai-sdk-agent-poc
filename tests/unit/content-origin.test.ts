import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { mergeIncomingMessage, reconcilePendingApprovals } from "@/agents/chat-memory";
import { cancelOrder, refundPayment, sendCustomerNotification } from "@/capabilities/actions/action-capabilities";
import { requiresApproval } from "@/capabilities/capability";
import { renderNotificationTemplate } from "@/domain/notifications/notification";

const customer = { id: 1, name: "João Silva" };
const free = { customerId: 1, subject: "Olá", body: "Texto escrito pelo agente." };
const template = { customerId: 1, orderId: 123, template: "order_status_update" as const };

describe("templates determinísticos", () => {
  it("mesmo input → mesmo texto", () => {
    const a = renderNotificationTemplate("order_status_update", { customer, order: { id: 123, status: "processing" } });
    const b = renderNotificationTemplate("order_status_update", { customer, order: { id: 123, status: "processing" } });
    expect(a).toEqual(b);
    expect(a.body).toContain("em separação");
  });

  it("templates de pedido exigem orderId", () => {
    expect(() => renderNotificationTemplate("order_status_update", { customer })).toThrow(/orderId/);
    expect(renderNotificationTemplate("satisfaction_survey", { customer }).subject).toBe("Como foi sua experiência?");
  });
});

describe("proveniência decidida pela forma do input", () => {
  it("template → application_template, sem aprovação", () => {
    expect(sendCustomerNotification.contentOrigin!(template)).toBe("application_template");
    expect(requiresApproval(sendCustomerNotification, template)).toBe(false);
  });

  it("texto livre → agent_generated, aprovação obrigatória", () => {
    expect(sendCustomerNotification.contentOrigin!(free)).toBe("agent_generated");
    expect(requiresApproval(sendCustomerNotification, free)).toBe(true);
  });

  it("autorização e conteúdo são independentes: capabilities sem conteúdo seguem a política estática", () => {
    expect(requiresApproval(cancelOrder, { orderId: 1, reason: "motivo" })).toBe(false);
    expect(requiresApproval(refundPayment, { orderId: 1, reason: "motivo" })).toBe(true);
  });
});

describe("schema estrito: o modelo não declara aprovação nem origem", () => {
  const parse = (input: unknown) => sendCustomerNotification.inputSchema.safeParse(input).success;

  it.each([
    ["aprovação declarada", { ...free, approved: true }],
    ["origem declarada", { ...free, contentOrigin: "application_template" }],
    ["evidência forjada", { ...free, approval: { id: "x", approvedBy: "u_ana" } }],
    ["template com texto livre embutido", { ...template, body: "Texto que tentaria sair sem aprovação." }],
    ["nem template nem texto", { customerId: 1 }],
    ["só subject", { customerId: 1, subject: "Olá" }],
    ["template inexistente", { customerId: 1, template: "qualquer_coisa" }],
  ])("recusa: %s", (_name, input) => {
    expect(parse(input)).toBe(false);
  });

  it("aceita as duas formas legítimas", () => {
    expect(parse(template)).toBe(true);
    expect(parse(free)).toBe(true);
  });
});

describe("decisões já tomadas", () => {
  const pending = (state: string, extra: Record<string, unknown> = {}) =>
    ({
      id: "a1",
      role: "assistant",
      parts: [{ type: "tool-sendPreparedNotifications", toolCallId: "c1", state, input: { runId: "r1" }, approval: { id: "ap1" }, ...extra }],
    }) as unknown as UIMessage;

  it("merge recusa com ALREADY_DECIDED uma resposta para aprovação já decidida", () => {
    const stored = [pending("output-available", { output: { ok: true } })];
    const answer = pending("approval-responded", { approval: { id: "ap1", approved: true } });
    expect(() => mergeIncomingMessage(stored, answer)).toThrow(expect.objectContaining({ code: "ALREADY_DECIDED" }));
  });

  it("reconciliação troca o pedido pendente por resultado ALREADY_DECIDED (sem Aprovar/Rejeitar)", async () => {
    const { messages, changed } = await reconcilePendingApprovals([pending("approval-requested")], async () => ({
      code: "ALREADY_DECIDED",
      message: "Esta execução já foi decidida (completed por Bruno).",
    }));
    const part = messages[0].parts[0] as unknown as { state: string; output: { ok: boolean; error: { code: string } }; approval?: unknown };
    expect(changed).toBe(true);
    expect(part.state).toBe("output-available");
    expect(part.output).toMatchObject({ ok: false, error: { code: "ALREADY_DECIDED" } });
    expect(part.approval).toBeUndefined();
  });

  it("reconciliação não mexe em pedidos ainda decidíveis", async () => {
    const { changed } = await reconcilePendingApprovals([pending("approval-requested")], async () => null);
    expect(changed).toBe(false);
  });
});
