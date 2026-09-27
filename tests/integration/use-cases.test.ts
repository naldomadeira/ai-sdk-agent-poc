import { describe, expect, it } from "vitest";
import { cancelOrder } from "@/application/orders/cancel-order";
import { sendCustomerNotification } from "@/application/notifications/send-customer-notification";
import { refundPayment } from "@/application/payments/refund-payment";
import { orderRepository } from "@/infrastructure/db/repositories/order-repository";
import { paymentRepository } from "@/infrastructure/db/repositories/payment-repository";
import { SEED_FACTS } from "@/infrastructure/db/seed";
import { ctx, db, principals, withSeededDatabase } from "../helpers/db";

withSeededDatabase();

describe("repositories", () => {
  it("findById mapeia o pedido", async () => {
    const order = await orderRepository.findById(db, 123);
    expect(order).toMatchObject({ id: 123, customerId: 1, status: "paid" });
    expect(order?.placedAt).toBeInstanceOf(Date);
  });

  it("findLate encontra exatamente os pedidos atrasados do seed", async () => {
    const late = await orderRepository.findLate(db, ctx.now());
    expect(late.map((o) => o.orderId).sort()).toEqual([...SEED_FACTS.lateOrderIds].sort());
    expect(late.every((o) => o.daysLate >= 0)).toBe(true);
  });

  it("payment findByOrderId", async () => {
    expect(await paymentRepository.findByOrderId(db, 123)).toMatchObject({ status: "captured", refundedCents: 0 });
    expect(await paymentRepository.findByOrderId(db, 99_999)).toBeNull();
  });
});

describe("cancelOrder", () => {
  it("cancela pedido pago e sinaliza que precisa de reembolso", async () => {
    const result = await cancelOrder(ctx, principals.support, { orderId: 123, reason: "cliente desistiu" });
    expect(result).toEqual({ orderId: 123, previousStatus: "paid", status: "cancelled", refundRequired: true });
    expect((await orderRepository.findById(db, 123))?.status).toBe("cancelled");
  });

  it("recusa pedido enviado e não altera nada", async () => {
    await expect(cancelOrder(ctx, principals.support, { orderId: 104, reason: "cliente desistiu" })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    expect((await orderRepository.findById(db, 104))?.status).toBe("shipped");
  });

  it("viewer não cancela", async () => {
    await expect(cancelOrder(ctx, principals.viewer, { orderId: 123, reason: "cliente desistiu" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("pedido inexistente", async () => {
    await expect(cancelOrder(ctx, principals.support, { orderId: 9_999, reason: "cliente desistiu" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("refundPayment", () => {
  it("manager reembolsa integralmente (transação: pagamento + pedido)", async () => {
    const result = await refundPayment(ctx, principals.manager, { orderId: 123, reason: "produto com defeito" });
    expect(result).toMatchObject({ orderId: 123, paymentStatus: "refunded", orderStatus: "refunded", remainingCents: 0 });
    expect((await paymentRepository.findByOrderId(db, 123))?.refundedCents).toBe(result.refundedCents);
    expect((await orderRepository.findById(db, 123))?.status).toBe("refunded");
  });

  it("cancelar e depois reembolsar mantém o pedido cancelado", async () => {
    await cancelOrder(ctx, principals.manager, { orderId: 123, reason: "cliente desistiu" });
    const result = await refundPayment(ctx, principals.manager, { orderId: 123, reason: "cancelamento" });
    expect(result.orderStatus).toBe("cancelled");
  });

  it("não reembolsa duas vezes", async () => {
    await refundPayment(ctx, principals.manager, { orderId: 123, reason: "produto com defeito" });
    await expect(refundPayment(ctx, principals.manager, { orderId: 123, reason: "de novo!!" })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  it("support não tem permissão de reembolso", async () => {
    await expect(refundPayment(ctx, principals.support, { orderId: 123, reason: "produto com defeito" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect((await paymentRepository.findByOrderId(db, 123))?.status).toBe("captured");
  });
});

describe("sendCustomerNotification", () => {
  const draft = { customerId: 1, orderId: 123, subject: "Seu pedido", body: "Seu pedido foi atualizado. Obrigado!" };

  it("envia e respeita o limite diário", async () => {
    for (let i = 0; i < 3; i++) await sendCustomerNotification(ctx, principals.support, draft);
    await expect(sendCustomerNotification(ctx, principals.support, draft)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("recusa pedido de outro cliente", async () => {
    await expect(
      sendCustomerNotification(ctx, principals.support, { ...draft, customerId: 2 }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("viewer não envia", async () => {
    await expect(sendCustomerNotification(ctx, principals.viewer, draft)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
