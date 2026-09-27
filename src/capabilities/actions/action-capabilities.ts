import { z } from "zod";
import { sendCustomerNotification as sendCustomerNotificationUseCase } from "@/application/notifications/send-customer-notification";
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

export const sendCustomerNotification = defineCapability({
  name: "sendCustomerNotification",
  kind: "action",
  permission: "notifications:send",
  approval: "none",
  description:
    "Envia uma notificação por e-mail a um cliente (limite de 3 por cliente a cada 24h). " +
    "Se orderId for informado, o pedido precisa pertencer ao cliente.",
  inputSchema: z.object({
    customerId: z.number().int().positive(),
    orderId: orderId.optional(),
    subject: z.string().min(3).max(120),
    body: z.string().min(10).max(2000),
  }),
  execute: (input, ctx) => sendCustomerNotificationUseCase(ctx.app, ctx.principal, input),
});
