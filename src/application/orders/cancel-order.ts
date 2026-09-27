import { assertCan, type Principal } from "@/domain/auth/principal";
import { assertCancellable, cancellationNeedsRefund } from "@/domain/orders/order";
import { notFound } from "@/domain/shared/errors";
import { orderRepository } from "@/infrastructure/db/repositories/order-repository";
import type { AppContext } from "../context";

export interface CancelOrderInput {
  orderId: number;
  reason: string;
}

export interface CancelOrderResult {
  orderId: number;
  previousStatus: string;
  status: "cancelled";
  refundRequired: boolean;
}

export async function cancelOrder(
  ctx: AppContext,
  principal: Principal,
  input: CancelOrderInput,
): Promise<CancelOrderResult> {
  assertCan(principal, "orders:cancel");

  return ctx.db.transaction(async (tx) => {
    // FOR UPDATE: duas chamadas concorrentes não cancelam o mesmo pedido duas vezes.
    const order = await orderRepository.findById(tx, input.orderId, { forUpdate: true });
    if (!order) throw notFound("Pedido", `#${input.orderId}`);

    assertCancellable(order, input.reason);
    await orderRepository.markCancelled(tx, order.id, input.reason.trim(), ctx.now());

    return {
      orderId: order.id,
      previousStatus: order.status,
      status: "cancelled",
      refundRequired: cancellationNeedsRefund(order.status),
    };
  });
}
