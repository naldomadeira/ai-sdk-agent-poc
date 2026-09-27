import { assertCan, type Principal } from "@/domain/auth/principal";
import { planRefund } from "@/domain/payments/payment";
import { notFound } from "@/domain/shared/errors";
import { orderRepository } from "@/infrastructure/db/repositories/order-repository";
import { paymentRepository } from "@/infrastructure/db/repositories/payment-repository";
import type { AppContext } from "../context";

export interface RefundPaymentInput {
  orderId: number;
  /** Omitido = reembolso do saldo total. */
  amountCents?: number;
  reason: string;
}

export interface RefundPaymentResult {
  orderId: number;
  paymentId: number;
  refundedCents: number;
  remainingCents: number;
  paymentStatus: string;
  orderStatus: string;
}

/**
 * Reembolso. A aprovação humana é garantida pela camada de capabilities; aqui ficam
 * a autorização (permissão da role) e as regras de negócio — valem para qualquer canal.
 */
export async function refundPayment(
  ctx: AppContext,
  principal: Principal,
  input: RefundPaymentInput,
): Promise<RefundPaymentResult> {
  assertCan(principal, "payments:refund");

  return ctx.db.transaction(async (tx) => {
    const order = await orderRepository.findById(tx, input.orderId, { forUpdate: true });
    if (!order) throw notFound("Pedido", `#${input.orderId}`);
    const payment = await paymentRepository.findByOrderId(tx, order.id, { forUpdate: true });
    if (!payment) throw notFound("Pagamento do pedido", `#${order.id}`);

    const plan = planRefund(payment, order, input.amountCents, input.reason);

    await paymentRepository.applyRefund(tx, payment.id, plan.refundCents, plan.paymentStatus, input.reason.trim(), ctx.now());
    if (plan.orderStatus !== order.status) {
      await orderRepository.setStatus(tx, order.id, plan.orderStatus);
    }

    return {
      orderId: order.id,
      paymentId: payment.id,
      refundedCents: plan.refundCents,
      remainingCents: plan.remainingCents,
      paymentStatus: plan.paymentStatus,
      orderStatus: plan.orderStatus,
    };
  });
}
