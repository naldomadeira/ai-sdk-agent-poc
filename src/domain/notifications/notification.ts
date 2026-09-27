import { DomainError, invalidInput } from "../shared/errors";

export const MAX_NOTIFICATIONS_PER_CUSTOMER_PER_DAY = 3;

export interface NotificationDraft {
  customerId: number;
  orderId?: number;
  subject: string;
  body: string;
}

export function assertValidNotification(draft: NotificationDraft): void {
  if (draft.subject.trim().length < 3 || draft.subject.length > 120) {
    throw invalidInput("Assunto deve ter entre 3 e 120 caracteres");
  }
  if (draft.body.trim().length < 10 || draft.body.length > 2000) {
    throw invalidInput("Mensagem deve ter entre 10 e 2000 caracteres");
  }
}

/** Anti-spam: limite diário por cliente, validado no backend (o agente não consegue burlar). */
export function assertWithinRateLimit(sentLast24h: number): void {
  if (sentLast24h >= MAX_NOTIFICATIONS_PER_CUSTOMER_PER_DAY) {
    throw new DomainError(
      "RATE_LIMITED",
      `Cliente já recebeu ${sentLast24h} notificações nas últimas 24h (limite ${MAX_NOTIFICATIONS_PER_CUSTOMER_PER_DAY})`,
      { sentLast24h },
    );
  }
}

export interface LateOrderRef {
  orderId: number;
  daysLate: number;
}

/** Template determinístico — o workflow não pede texto ao LLM. */
export function lateOrderNotification(
  customer: { id: number; name: string },
  orders: LateOrderRef[],
): NotificationDraft {
  const firstName = customer.name.split(" ")[0];
  const list = orders.map((o) => `#${o.orderId} (${o.daysLate} dia(s) de atraso)`).join(", ");
  const plural = orders.length > 1;
  return {
    customerId: customer.id,
    orderId: plural ? undefined : orders[0]?.orderId,
    subject: plural ? "Atualização sobre seus pedidos" : `Atualização sobre o pedido #${orders[0]?.orderId}`,
    body:
      `Olá, ${firstName}. ${plural ? "Seus pedidos" : "Seu pedido"} ${list} ` +
      `${plural ? "estão" : "está"} com a entrega atrasada. Pedimos desculpas — nossa equipe já está ` +
      `acompanhando e você receberá o código de rastreio atualizado em até 24h.`,
  };
}
