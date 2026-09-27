import { assertCan, type Principal } from "@/domain/auth/principal";
import {
  assertValidNotification,
  assertWithinRateLimit,
  type NotificationDraft,
} from "@/domain/notifications/notification";
import { invalidInput, notFound } from "@/domain/shared/errors";
import type { Queryable } from "@/infrastructure/db/pool";
import { customerRepository } from "@/infrastructure/db/repositories/customer-repository";
import { notificationRepository } from "@/infrastructure/db/repositories/notification-repository";
import { orderRepository } from "@/infrastructure/db/repositories/order-repository";
import type { AppContext } from "../context";

export interface SendNotificationResult {
  notificationId: number;
  customerId: number;
  orderId: number | null;
  channel: "email";
}

/**
 * Envia (simula) uma notificação ao cliente. Aceita um `tx` externo para que o workflow
 * possa enviar vários dentro da própria transação.
 */
export async function sendCustomerNotification(
  ctx: AppContext,
  principal: Principal,
  draft: NotificationDraft,
  opts: { tx?: Queryable; workflowRunId?: string } = {},
): Promise<SendNotificationResult> {
  assertCan(principal, "notifications:send");
  assertValidNotification(draft);

  const run = async (tx: Queryable) => {
    const customer = await customerRepository.findById(tx, draft.customerId);
    if (!customer) throw notFound("Cliente", draft.customerId);

    if (draft.orderId !== undefined) {
      const order = await orderRepository.findById(tx, draft.orderId);
      if (!order) throw notFound("Pedido", `#${draft.orderId}`);
      // Impede que o agente mencione pedido de outro cliente.
      if (order.customerId !== customer.id) {
        throw invalidInput(`Pedido #${order.id} não pertence ao cliente ${customer.id}`);
      }
    }

    const now = ctx.now();
    const sent = await notificationRepository.countSince(tx, customer.id, new Date(now.getTime() - 24 * 3600_000));
    assertWithinRateLimit(sent);

    const { id } = await notificationRepository.insert(tx, draft, {
      sentBy: principal.id,
      workflowRunId: opts.workflowRunId,
      at: now,
    });
    return { notificationId: id, customerId: customer.id, orderId: draft.orderId ?? null, channel: "email" as const };
  };

  return opts.tx ? run(opts.tx) : ctx.db.transaction(run);
}
