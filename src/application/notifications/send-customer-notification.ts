import { assertCan, type Principal } from "@/domain/auth/principal";
import {
  assertValidNotification,
  assertWithinRateLimit,
  renderNotificationTemplate,
  type ContentOrigin,
  type NotificationDraft,
  type NotificationTemplateId,
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
  contentOrigin: ContentOrigin;
  templateId: string | null;
  subject: string;
  body: string;
}

export interface NotificationContentMeta {
  contentOrigin: ContentOrigin;
  templateId?: NotificationTemplateId;
}

/**
 * Envia (simula) uma notificação ao cliente. Aceita um `tx` externo para que o workflow
 * possa enviar vários dentro da própria transação.
 */
export async function sendCustomerNotification(
  ctx: AppContext,
  principal: Principal,
  draft: NotificationDraft,
  opts: { tx?: Queryable; workflowRunId?: string; content: NotificationContentMeta },
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
      contentOrigin: opts.content.contentOrigin,
      templateId: opts.content.templateId,
    });
    return {
      notificationId: id,
      customerId: customer.id,
      orderId: draft.orderId ?? null,
      channel: "email" as const,
      contentOrigin: opts.content.contentOrigin,
      templateId: opts.content.templateId ?? null,
      subject: draft.subject,
      body: draft.body,
    };
  };

  return opts.tx ? run(opts.tx) : ctx.db.transaction(run);
}

/**
 * Resolve o texto de um template a partir de dados do banco (cliente, pedido, atraso).
 * O modelo escolhe QUAL template e PARA QUEM; o texto é da aplicação.
 */
export async function composeTemplatedNotification(
  ctx: AppContext,
  input: { customerId: number; orderId?: number; template: NotificationTemplateId },
): Promise<NotificationDraft> {
  const customer = await customerRepository.findById(ctx.db, input.customerId);
  if (!customer) throw notFound("Cliente", input.customerId);
  let order: { id: number; status: string; daysLate?: number } | undefined;
  if (input.orderId !== undefined) {
    const found = await orderRepository.findById(ctx.db, input.orderId);
    if (!found) throw notFound("Pedido", `#${input.orderId}`);
    const late = ctx.now().getTime() - found.expectedDeliveryAt.getTime();
    order = { id: found.id, status: found.status, daysLate: Math.max(0, Math.floor(late / 86_400_000)) };
  }
  return renderNotificationTemplate(input.template, { customer, order });
}
