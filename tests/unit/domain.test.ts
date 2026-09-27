import { describe, expect, it } from "vitest";
import { assertCan, can, type Principal } from "@/domain/auth/principal";
import {
  assertValidNotification,
  assertWithinRateLimit,
  lateOrderNotification,
} from "@/domain/notifications/notification";
import { assertCancellable, isLate, type Order } from "@/domain/orders/order";
import { planRefund, type Payment } from "@/domain/payments/payment";
import { DomainError } from "@/domain/shared/errors";

const now = new Date("2026-09-27T12:00:00Z");
const order = (over: Partial<Order> = {}): Order => ({
  id: 123,
  customerId: 1,
  status: "paid",
  totalCents: 10_000,
  placedAt: new Date("2026-09-25T12:00:00Z"),
  expectedDeliveryAt: new Date("2026-09-30T12:00:00Z"),
  ...over,
});
const payment = (over: Partial<Payment> = {}): Payment => ({
  id: 1,
  orderId: 123,
  method: "credit_card",
  status: "captured",
  amountCents: 10_000,
  refundedCents: 0,
  ...over,
});
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return "OK";
};

describe("orders", () => {
  it("cancela pedidos antes do envio", () => {
    for (const status of ["pending", "paid", "processing"] as const) {
      expect(code(() => assertCancellable(order({ status }), "cliente pediu"))).toBe("OK");
    }
  });

  it("recusa cancelar pedido enviado, entregue, cancelado ou reembolsado", () => {
    for (const status of ["shipped", "delivered", "cancelled", "refunded"] as const) {
      expect(code(() => assertCancellable(order({ status }), "cliente pediu"))).toBe("INVALID_STATE");
    }
  });

  it("exige motivo", () => {
    expect(code(() => assertCancellable(order(), "  "))).toBe("INVALID_INPUT");
  });

  it("atrasado = aberto e com prazo vencido", () => {
    const past = new Date("2026-09-20T00:00:00Z");
    expect(isLate(order({ status: "processing", expectedDeliveryAt: past }), now)).toBe(true);
    expect(isLate(order({ status: "delivered", expectedDeliveryAt: past }), now)).toBe(false);
    expect(isLate(order({ status: "paid" }), now)).toBe(false);
  });
});

describe("payments", () => {
  it("reembolso total encerra pedido como reembolsado", () => {
    const plan = planRefund(payment(), order(), undefined, "produto com defeito");
    expect(plan).toEqual({ refundCents: 10_000, remainingCents: 0, paymentStatus: "refunded", orderStatus: "refunded" });
  });

  it("reembolso total de pedido cancelado mantém o pedido cancelado", () => {
    expect(planRefund(payment(), order({ status: "cancelled" }), undefined, "cancelamento").orderStatus).toBe("cancelled");
  });

  it("reembolso parcial", () => {
    const plan = planRefund(payment(), order(), 2_500, "desconto acordado");
    expect(plan.paymentStatus).toBe("partially_refunded");
    expect(plan.remainingCents).toBe(7_500);
    expect(plan.orderStatus).toBe("paid");
  });

  it("não reembolsa acima do saldo, valor inválido, pagamento não capturado ou pedido em trânsito", () => {
    expect(code(() => planRefund(payment({ refundedCents: 9_000 }), order(), 2_000, "motivo ok"))).toBe("INVALID_INPUT");
    expect(code(() => planRefund(payment(), order(), -1, "motivo ok"))).toBe("INVALID_INPUT");
    expect(code(() => planRefund(payment({ status: "pending" }), order(), undefined, "motivo ok"))).toBe("INVALID_STATE");
    expect(code(() => planRefund(payment({ status: "refunded" }), order(), undefined, "motivo ok"))).toBe("INVALID_STATE");
    expect(code(() => planRefund(payment(), order({ status: "shipped" }), undefined, "motivo ok"))).toBe("INVALID_STATE");
    expect(code(() => planRefund(payment(), order(), undefined, ""))).toBe("INVALID_INPUT");
  });
});

describe("notifications", () => {
  it("limite diário por cliente", () => {
    expect(code(() => assertWithinRateLimit(2))).toBe("OK");
    expect(code(() => assertWithinRateLimit(3))).toBe("RATE_LIMITED");
  });

  it("valida assunto e corpo", () => {
    expect(code(() => assertValidNotification({ customerId: 1, subject: "Oi", body: "curto" }))).toBe("INVALID_INPUT");
  });

  it("template determinístico de atraso", () => {
    const one = lateOrderNotification({ id: 1, name: "João Silva" }, [{ orderId: 131, daysLate: 2 }]);
    expect(one).toMatchObject({ customerId: 1, orderId: 131, subject: "Atualização sobre o pedido #131" });
    expect(one.body).toContain("Olá, João.");
    const many = lateOrderNotification({ id: 1, name: "João Silva" }, [
      { orderId: 131, daysLate: 2 },
      { orderId: 140, daysLate: 1 },
    ]);
    expect(many.orderId).toBeUndefined();
    expect(many.body).toContain("#131 (2 dia(s) de atraso), #140");
  });
});

describe("authorization", () => {
  const viewer: Principal = { id: "v", name: "V", role: "viewer" };
  const support: Principal = { id: "s", name: "S", role: "support" };
  const manager: Principal = { id: "m", name: "M", role: "manager" };

  it("matriz de permissões", () => {
    expect(can(viewer, "data:read")).toBe(true);
    expect(can(viewer, "orders:cancel")).toBe(false);
    expect(can(support, "orders:cancel")).toBe(true);
    expect(can(support, "payments:refund")).toBe(false);
    expect(can(manager, "payments:refund")).toBe(true);
  });

  it("role desconhecida não recebe nada", () => {
    expect(can({ id: "x", name: "X", role: "admin" as never }, "data:read")).toBe(false);
  });

  it("assertCan lança FORBIDDEN", () => {
    expect(code(() => assertCan(support, "payments:refund"))).toBe("FORBIDDEN");
  });
});
