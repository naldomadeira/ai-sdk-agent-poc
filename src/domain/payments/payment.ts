import type { Order, OrderStatus } from "../orders/order";
import { invalidInput, invalidState } from "../shared/errors";

export type PaymentStatus = "pending" | "captured" | "partially_refunded" | "refunded" | "failed";

export interface Payment {
  id: number;
  orderId: number;
  method: "credit_card" | "pix" | "boleto";
  status: PaymentStatus;
  amountCents: number;
  refundedCents: number;
}

export interface RefundPlan {
  refundCents: number;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  remainingCents: number;
}

/**
 * Regras de reembolso:
 * - só pagamentos capturados (ou parcialmente reembolsados);
 * - pedido em trânsito não é reembolsado (aguarda entrega ou cancelamento);
 * - valor > 0 e ≤ saldo reembolsável; sem valor = saldo total;
 * - motivo obrigatório.
 */
export function planRefund(
  payment: Payment,
  order: Order,
  requestedCents: number | undefined,
  reason: string,
): RefundPlan {
  if (reason.trim().length < 5) {
    throw invalidInput("Informe o motivo do reembolso (mín. 5 caracteres)");
  }
  if (payment.status !== "captured" && payment.status !== "partially_refunded") {
    throw invalidState(`Pagamento do pedido #${order.id} não é reembolsável: status "${payment.status}"`, {
      paymentStatus: payment.status,
    });
  }
  if (order.status === "shipped") {
    throw invalidState(`Pedido #${order.id} está em trânsito; reembolse após a entrega ou o cancelamento`, {
      orderStatus: order.status,
    });
  }

  const refundable = payment.amountCents - payment.refundedCents;
  const refundCents = requestedCents ?? refundable;
  if (!Number.isInteger(refundCents) || refundCents <= 0) {
    throw invalidInput("Valor de reembolso deve ser um inteiro positivo em centavos");
  }
  if (refundCents > refundable) {
    throw invalidInput(`Valor excede o saldo reembolsável (${refundable} centavos)`, { refundable });
  }

  const remainingCents = refundable - refundCents;
  const full = remainingCents === 0;
  return {
    refundCents,
    remainingCents,
    paymentStatus: full ? "refunded" : "partially_refunded",
    // Reembolso total de pedido não cancelado encerra o pedido como reembolsado.
    orderStatus: full && order.status !== "cancelled" ? "refunded" : order.status,
  };
}
