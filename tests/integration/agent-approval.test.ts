import type { ModelMessage, ToolApprovalResponse } from "ai";
import { describe, expect, it } from "vitest";
import { createCommerceAgent } from "@/agents/commerce-agent";
import { paymentRepository } from "@/infrastructure/db/repositories/payment-repository";
import { orderRepository } from "@/infrastructure/db/repositories/order-repository";
import { auditRows, capabilityContext } from "../helpers/capability-context";
import { db, principals, withSeededDatabase } from "../helpers/db";
import { scriptedModel } from "../helpers/mock-model";

withSeededDatabase();

const refundCall = { toolCalls: [{ toolName: "refundPayment", input: { orderId: 123, reason: "produto com defeito" } }] };

async function requestRefund() {
  const agent = createCommerceAgent(capabilityContext(principals.manager), {
    model: scriptedModel([refundCall, { text: "Reembolso concluído." }]),
  });
  const messages: ModelMessage[] = [{ role: "user", content: "Reembolse o pedido #123" }];
  const first = await agent.generate({ messages });
  const request = first.content.find((p) => p.type === "tool-approval-request");
  messages.push(...first.responseMessages);
  return { agent, messages, first, request };
}

describe("commerceAgent — ferramentas por papel", () => {
  it("o conjunto de tools depende do usuário autenticado", () => {
    const tools = (role: keyof typeof principals) =>
      Object.keys(createCommerceAgent(capabilityContext(principals[role]), { model: scriptedModel([]) }).tools).sort();
    expect(tools("viewer")).toEqual(["inspectSchema", "queryDatabase"]);
    expect(tools("support")).not.toContain("refundPayment");
    expect(tools("manager")).toContain("refundPayment");
  });

  it("modelo pedindo tool que o usuário não tem não altera nada", async () => {
    const agent = createCommerceAgent(capabilityContext(principals.viewer), {
      model: scriptedModel([
        { toolCalls: [{ toolName: "cancelOrder", input: { orderId: 123, reason: "cliente desistiu" } }] },
        { text: "Não consigo cancelar." },
      ]),
    });
    await agent.generate({ prompt: "Cancele o pedido #123" });
    expect((await orderRepository.findById(db, 123))?.status).toBe("paid");
  });
});

describe("commerceAgent — aprovação humana (refundPayment)", () => {
  it("pausa com pedido de aprovação e não executa", async () => {
    const { request, first } = await requestRefund();
    expect(request).toMatchObject({ type: "tool-approval-request", toolCall: { toolName: "refundPayment" } });
    expect(first.content.some((p) => p.type === "tool-result")).toBe(false);
    expect((await paymentRepository.findByOrderId(db, 123))?.status).toBe("captured");
  });

  it("aprovado → executa o use case", async () => {
    const { agent, messages, request } = await requestRefund();
    if (request?.type !== "tool-approval-request") throw new Error("sem aprovação");
    const approval: ToolApprovalResponse = { type: "tool-approval-response", approvalId: request.approvalId, approved: true };
    messages.push({ role: "tool", content: [approval] });

    const second = await agent.generate({ messages });
    expect(second.text).toBe("Reembolso concluído.");
    expect((await paymentRepository.findByOrderId(db, 123))?.status).toBe("refunded");
    expect(await auditRows("refundPayment")).toMatchObject([{ status: "ok", actor_id: "u_ana" }]);
  });

  it("rejeitado → nada acontece", async () => {
    const { agent, messages, request } = await requestRefund();
    if (request?.type !== "tool-approval-request") throw new Error("sem aprovação");
    messages.push({
      role: "tool",
      content: [{ type: "tool-approval-response", approvalId: request.approvalId, approved: false, reason: "não autorizo" }],
    });

    await agent.generate({ messages });
    expect((await paymentRepository.findByOrderId(db, 123))?.status).toBe("captured");
    expect(await auditRows("refundPayment")).toEqual([]);
  });

  it("aprovação adulterada (input trocado após a assinatura) é recusada", async () => {
    const { agent, messages, request } = await requestRefund();
    if (request?.type !== "tool-approval-request") throw new Error("sem aprovação");
    // Atacante troca o pedido reembolsado depois que o humano viu o pedido de aprovação.
    for (const message of messages) {
      if (message.role !== "assistant" || typeof message.content === "string") continue;
      for (const part of message.content) {
        if (part.type === "tool-call") (part.input as { orderId: number }).orderId = 101;
      }
    }
    messages.push({ role: "tool", content: [{ type: "tool-approval-response", approvalId: request.approvalId, approved: true }] });

    await expect(agent.generate({ messages })).rejects.toThrow(/signature/i);
    expect((await paymentRepository.findByOrderId(db, 101))?.status).toBe("captured");
    expect((await paymentRepository.findByOrderId(db, 123))?.status).toBe("captured");
  });
});
