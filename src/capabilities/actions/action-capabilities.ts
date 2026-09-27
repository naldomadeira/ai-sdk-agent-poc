import { z } from "zod";
import {
  composeTemplatedNotification,
  sendCustomerNotification as sendCustomerNotificationUseCase,
} from "@/application/notifications/send-customer-notification";
import { NOTIFICATION_TEMPLATES } from "@/domain/notifications/notification";
import { cancelOrder as cancelOrderUseCase } from "@/application/orders/cancel-order";
import { refundPayment as refundPaymentUseCase } from "@/application/payments/refund-payment";
import { defineCapability } from "../capability";

/**
 * Escrita = capabilities semânticas de negócio. Cada uma é só um adaptador fino:
 * schema de entrada + chamada ao use case. Regras e autorização ficam no use case.
 */

const orderId = z.number().int().positive().describe("Número do pedido, ex.: 123 para #123");

export const cancelOrder = defineCapability({
  name: "cancelOrder",
  kind: "action",
  permission: "orders:cancel",
  approval: "none",
  description:
    "Cancela um pedido que ainda não foi enviado. Não reembolsa: se o resultado indicar refundRequired, " +
    "informe o usuário e ofereça refundPayment.",
  inputSchema: z.object({
    orderId,
    reason: z.string().min(5).max(500).describe("Motivo do cancelamento, informado pelo usuário"),
  }),
  execute: (input, ctx) => cancelOrderUseCase(ctx.app, ctx.principal, input),
});

export const refundPayment = defineCapability({
  name: "refundPayment",
  kind: "action",
  permission: "payments:refund",
  approval: "required",
  description:
    "Reembolsa o pagamento de um pedido (total ou parcial). Exige aprovação humana: o usuário verá " +
    "um pedido de confirmação antes da execução.",
  inputSchema: z.object({
    orderId,
    amountCents: z.number().int().positive().optional().describe("Valor em centavos; omita para reembolso total"),
    reason: z.string().min(5).max(500).describe("Motivo do reembolso"),
  }),
  execute: (input, ctx) => refundPaymentUseCase(ctx.app, ctx.principal, input),
});

/**
 * Notificação ao cliente. Duas formas de conteúdo, mutuamente exclusivas:
 *  - `template`: o texto é da aplicação (renderizado a partir do banco) → segue a política existente,
 *    sem aprovação;
 *  - `subject` + `body`: texto livre escrito pelo agente → o executor exige aprovação humana.
 * A origem é inferida da FORMA do input. O schema é estrito: campos extras (ex.: `approved`,
 * `contentOrigin`) são recusados, então o modelo não consegue declarar aprovação nem origem.
 */
const notificationInput = z
  .strictObject({
    customerId: z.number().int().positive(),
    orderId: orderId.optional(),
    template: z.enum(NOTIFICATION_TEMPLATES).optional()
      .describe("Texto padrão da aplicação (sem aprovação): order_status_update, order_late_apology (exigem orderId), satisfaction_survey"),
    subject: z.string().min(3).max(120).optional().describe("Só para texto livre (exige aprovação humana)"),
    body: z.string().min(10).max(2000).optional().describe("Só para texto livre (exige aprovação humana)"),
  })
  .superRefine((input, ctx) => {
    const free = input.subject !== undefined || input.body !== undefined;
    if (input.template && free) {
      ctx.addIssue({ code: "custom", message: "Use template OU subject+body, não os dois" });
    } else if (!input.template && !(input.subject && input.body)) {
      ctx.addIssue({ code: "custom", message: "Informe template, ou subject e body" });
    }
  });

export const sendCustomerNotification = defineCapability({
  name: "sendCustomerNotification",
  kind: "action",
  permission: "notifications:send",
  // Política da capability: sem aprovação. O risco do CONTEÚDO é tratado à parte, por contentOrigin:
  // texto livre do agente exige aprovação no executor (requiresApproval).
  approval: "none",
  contentOrigin: (input) => (input.template ? "application_template" : "agent_generated"),
  description:
    "Envia uma notificação por e-mail a um cliente (limite de 3 por cliente a cada 24h). Prefira `template` " +
    "(texto padrão da aplicação, envio imediato). Texto livre (`subject` + `body`) é escrito por você e só sai " +
    "depois da aprovação humana do texto exato. Se orderId for informado, o pedido precisa pertencer ao cliente.",
  inputSchema: notificationInput,
  async execute(input, ctx) {
    if (input.template) {
      const draft = await composeTemplatedNotification(ctx.app, { customerId: input.customerId, orderId: input.orderId, template: input.template });
      return sendCustomerNotificationUseCase(ctx.app, ctx.principal, draft, {
        content: { contentOrigin: "application_template", templateId: input.template },
      });
    }
    return sendCustomerNotificationUseCase(
      ctx.app,
      ctx.principal,
      { customerId: input.customerId, orderId: input.orderId, subject: input.subject!, body: input.body! },
      { content: { contentOrigin: "agent_generated" } },
    );
  },
});
