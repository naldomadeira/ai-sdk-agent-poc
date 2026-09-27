import { z } from "zod";
import {
  prepareLateOrderNotifications as prepare,
  sendPreparedLateOrderNotifications as send,
} from "@/workflows/late-order-notifications";
import { staffRepository } from "@/infrastructure/db/repositories/staff-repository";
import { workflowRunRepository } from "@/infrastructure/db/repositories/workflow-run-repository";
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
  // Outra pessoa pode ter decidido a mesma execução (idempotência reaproveita execuções pendentes):
  // o pedido de aprovação deixa de ser decidível, e o servidor reconcilia o histórico.
  async pendingApprovalStatus({ runId }, app) {
    const run = await workflowRunRepository.findById(app.db, runId);
    if (!run || run.status === "awaiting_approval") return null;
    const by = run.approvedBy ? (await staffRepository.findById(app.db, run.approvedBy))?.name ?? run.approvedBy : null;
    return {
      code: "ALREADY_DECIDED",
      message: `Esta execução já foi decidida (${run.status}${by ? ` por ${by}` : ""}). Nada foi reenviado.`,
    };
  },
  execute: ({ runId }, ctx) => send(ctx.app, ctx.principal, runId),
});
