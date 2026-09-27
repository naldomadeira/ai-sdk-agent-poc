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

// ---------- proveniência do conteúdo ----------

/**
 * De onde veio o texto que sai para o cliente. Decidido pela aplicação a partir da FORMA da chamada
 * (template + dados estruturados × assunto/corpo livres), nunca por uma declaração do modelo.
 */
export type ContentOrigin = "agent_generated" | "application_template";

export const NOTIFICATION_TEMPLATES = ["order_status_update", "order_late_apology", "satisfaction_survey"] as const;
export type NotificationTemplateId = (typeof NOTIFICATION_TEMPLATES)[number];

const STATUS_LABELS: Record<string, string> = {
  pending: "aguardando pagamento",
  paid: "pago",
  processing: "em separação",
  shipped: "enviado",
  delivered: "entregue",
  cancelled: "cancelado",
  refunded: "reembolsado",
};

export interface TemplateData {
  customer: { id: number; name: string };
  order?: { id: number; status: string; daysLate?: number };
}

/** Templates determinísticos: o texto depende só de dados do banco, não do modelo. */
export function renderNotificationTemplate(templateId: NotificationTemplateId, data: TemplateData): NotificationDraft {
  const firstName = data.customer.name.split(" ")[0];
  const needsOrder = () => {
    if (!data.order) throw invalidInput(`O template ${templateId} exige orderId`);
    return data.order;
  };
  switch (templateId) {
    case "order_status_update": {
      const order = needsOrder();
      return {
        customerId: data.customer.id,
        orderId: order.id,
        subject: `Atualização do pedido #${order.id}`,
        body: `Olá, ${firstName}. O status do seu pedido #${order.id} agora é: ${STATUS_LABELS[order.status] ?? order.status}. Obrigado por comprar conosco.`,
      };
    }
    case "order_late_apology": {
      const order = needsOrder();
      return lateOrderNotification(data.customer, [{ orderId: order.id, daysLate: order.daysLate ?? 0 }]);
    }
    case "satisfaction_survey":
      return {
        customerId: data.customer.id,
        orderId: data.order?.id,
        subject: "Como foi sua experiência?",
        body: `Olá, ${firstName}. Queremos saber como foi sua experiência com a nossa loja. Responda a este e-mail com uma nota de 0 a 10 e, se quiser, um comentário. Obrigado!`,
      };
  }
}
