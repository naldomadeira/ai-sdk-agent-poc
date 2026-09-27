import { describe, expect, it } from "vitest";
import { cancelOrder, refundPayment, sendCustomerNotification } from "@/capabilities/actions/action-capabilities";
import { capabilitiesFor, invokeCapability } from "@/capabilities/capability";
import { capabilities } from "@/capabilities/registry";
import { orderRepository } from "@/infrastructure/db/repositories/order-repository";
import { paymentRepository } from "@/infrastructure/db/repositories/payment-repository";
import { auditRows, capabilityContext } from "../helpers/capability-context";
import { db, principals, withSeededDatabase } from "../helpers/db";

withSeededDatabase();

describe("capabilitiesFor — o agente só vê o que o usuário pode fazer", () => {
  const names = (role: keyof typeof principals) => capabilitiesFor(capabilities, principals[role]).map((c) => c.name);

  it("viewer: só leitura", () => {
    expect(names("viewer")).toEqual(["inspectSchema", "queryDatabase"]);
  });
  it("support: sem reembolso", () => {
    expect(names("support")).not.toContain("refundPayment");
    expect(names("support")).toContain("cancelOrder");
  });
  it("manager: tudo", () => {
    expect(names("manager")).toHaveLength(capabilities.length);
  });
});

describe("cancelOrder capability", () => {
  it("delega ao use case e audita", async () => {
    const result = await invokeCapability(cancelOrder, { orderId: 123, reason: "cliente desistiu" }, capabilityContext(principals.support));
    expect(result).toEqual({ ok: true, data: { orderId: 123, previousStatus: "paid", status: "cancelled", refundRequired: true } });
    expect((await orderRepository.findById(db, 123))?.status).toBe("cancelled");
    expect(await auditRows("cancelOrder")).toMatchObject([{ status: "ok", actor_id: "u_bruno", output: { status: "cancelled" } }]);
  });

  it("regra de negócio vira resultado estruturado, não exceção", async () => {
    const result = await invokeCapability(cancelOrder, { orderId: 104, reason: "cliente desistiu" }, capabilityContext(principals.support));
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_STATE", message: expect.stringContaining("#104") } });
    expect(await auditRows("cancelOrder")).toMatchObject([{ status: "error", error: expect.stringContaining("INVALID_STATE") }]);
  });

  it("input inválido é barrado pelo schema", async () => {
    const result = await invokeCapability(cancelOrder, { orderId: "123; DROP", reason: "x" }, capabilityContext(principals.support));
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });

  it("viewer: FORBIDDEN mesmo se chamar direto", async () => {
    const result = await invokeCapability(cancelOrder, { orderId: 123, reason: "cliente desistiu" }, capabilityContext(principals.viewer));
    expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect((await orderRepository.findById(db, 123))?.status).toBe("paid");
  });
});

describe("refundPayment capability", () => {
  it("sem evidência de aprovação não executa", async () => {
    const result = await invokeCapability(refundPayment, { orderId: 123, reason: "produto com defeito" }, capabilityContext(principals.manager));
    expect(result).toMatchObject({ ok: false, error: { code: "APPROVAL_REQUIRED" } });
    expect((await paymentRepository.findByOrderId(db, 123))?.status).toBe("captured");
  });

  it("com aprovação executa e registra o approvalId", async () => {
    const result = await invokeCapability(
      refundPayment,
      { orderId: 123, reason: "produto com defeito" },
      capabilityContext(principals.manager),
      { approval: { id: "appr_1", approvedBy: "u_ana" } },
    );
    expect(result).toMatchObject({ ok: true, data: { paymentStatus: "refunded" } });
    expect(await auditRows("refundPayment")).toMatchObject([{ status: "ok", approval_id: "appr_1" }]);
  });

  it("aprovação não substitui permissão: support aprovado continua FORBIDDEN", async () => {
    const result = await invokeCapability(
      refundPayment,
      { orderId: 123, reason: "produto com defeito" },
      capabilityContext(principals.support),
      { approval: { id: "appr_2", approvedBy: "u_bruno" } },
    );
    expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});

describe("sendCustomerNotification capability", () => {
  it("envia", async () => {
    const result = await invokeCapability(
      sendCustomerNotification,
      { customerId: 1, orderId: 123, subject: "Seu pedido", body: "Seu pedido foi atualizado. Obrigado!" },
      capabilityContext(principals.support),
    );
    expect(result).toMatchObject({ ok: true, data: { customerId: 1, channel: "email" } });
  });
});
