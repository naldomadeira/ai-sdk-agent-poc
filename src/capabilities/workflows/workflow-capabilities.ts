import { z } from "zod";
import {
  prepareLateOrderNotifications as prepare,
  sendPreparedLateOrderNotifications as send,
} from "@/workflows/late-order-notifications";
import { defineCapability } from "../capability";

export const prepareLateOrderNotifications = defineCapability({
  name: "prepareLateOrderNotifications",
  kind: "workflow",
  permission: "workflows:late-orders",
  approval: "none",
  description:
    "Workflow determinístico: encontra pedidos atrasados, agrupa por cliente e prepara as notificações " +
    "(nada é enviado). Devolve um runId e os rascunhos para você mostrar ao usuário.",
  inputSchema: z.object({}),
  execute: (_input, ctx) => prepare(ctx.app, ctx.principal),
});

export const sendPreparedNotifications = defineCapability({
  name: "sendPreparedNotifications",
  kind: "workflow",
  permission: "workflows:late-orders",
  approval: "required",
  description:
    "Envia as notificações preparadas por prepareLateOrderNotifications. Exige aprovação humana. " +
    "Use somente depois de mostrar os rascunhos ao usuário.",
  inputSchema: z.object({ runId: z.uuid().describe("runId devolvido por prepareLateOrderNotifications") }),
  execute: ({ runId }, ctx) => send(ctx.app, ctx.principal, runId),
});
