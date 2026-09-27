import type { AppContext } from "@/application/context";
import { sendCustomerNotification } from "@/application/notifications/send-customer-notification";
import { assertCan, type Principal } from "@/domain/auth/principal";
import { lateOrderNotification, type NotificationDraft } from "@/domain/notifications/notification";
import { DomainError, invalidState, notFound } from "@/domain/shared/errors";
import { orderRepository } from "@/infrastructure/db/repositories/order-repository";
import { workflowRunRepository, type WorkflowRun } from "@/infrastructure/db/repositories/workflow-run-repository";

/**
 * Workflow determinístico: "pedidos atrasados → notificar clientes".
 *
 *   1. encontrar pedidos atrasados      (query fixa, mesmo critério da view late_orders)
 *   2. agrupar por cliente              (um e-mail por cliente, não por pedido)
 *   3. preparar notificações            (template, sem LLM)
 *   4. aguardar aprovação humana        (workflow_runs.status = awaiting_approval)
 *   5. enviar                           (use case sendCustomerNotification, com rate limit)
 *
 * O agente só dispara e reporta. A sequência, os critérios e o texto não dependem do modelo:
 * rodar duas vezes sobre os mesmos dados produz o mesmo resultado.
 */

export const LATE_ORDER_WORKFLOW = "late-order-notifications";

export interface LateOrderNotificationsPayload {
  preparedAt: string;
  lateOrders: { orderId: number; customerId: number; customerName: string; daysLate: number }[];
  drafts: (NotificationDraft & { customerName: string; orderIds: number[] })[];
}

export interface LateOrderNotificationsResult {
  sent: { customerId: number; notificationId: number }[];
  skipped: { customerId: number; reason: string }[];
}

/** Janela em que um pedido atrasado já notificado não é notificado de novo. */
const RENOTIFY_AFTER_MS = 24 * 3600_000;

type Run = WorkflowRun<LateOrderNotificationsPayload, LateOrderNotificationsResult>;

const summarize = (run: Run, reusedExistingRun: boolean) => ({
  runId: run.id,
  status: run.status,
  reusedExistingRun,
  lateOrderCount: run.payload.lateOrders.length,
  customerCount: run.payload.drafts.length,
  drafts: run.payload.drafts.map((d) => ({ customerId: d.customerId, customerName: d.customerName, orderIds: d.orderIds, subject: d.subject, body: d.body })),
});

export async function prepareLateOrderNotifications(ctx: AppContext, principal: Principal) {
  assertCan(principal, "workflows:late-orders");
  const now = ctx.now();

  // Idempotência por evento (achado do EVAL-11): rodar o workflow de novo não pode duplicar efeitos.
  // (a) já existe uma execução aguardando aprovação → devolve a mesma, em vez de criar outra;
  const pending = await workflowRunRepository.findLatestByStatus<LateOrderNotificationsPayload, LateOrderNotificationsResult>(
    ctx.db, LATE_ORDER_WORKFLOW, "awaiting_approval",
  );
  if (pending) return summarize(pending, true);

  // (b) pedidos cujo cliente já foi notificado por uma execução concluída nas últimas 24h ficam de fora.
  const recent = await workflowRunRepository.listByStatusSince<LateOrderNotificationsPayload, LateOrderNotificationsResult>(
    ctx.db, LATE_ORDER_WORKFLOW, "completed", new Date(now.getTime() - RENOTIFY_AFTER_MS),
  );
  const alreadyNotified = new Set(
    recent.flatMap((run) => {
      const sent = new Set((run.result?.sent ?? []).map((s) => s.customerId));
      return run.payload.drafts.filter((d) => sent.has(d.customerId)).flatMap((d) => d.orderIds);
    }),
  );

  // 1. pedidos atrasados (ainda não notificados)
  const lateOrders = (await orderRepository.findLate(ctx.db, now)).filter((o) => !alreadyNotified.has(o.orderId));

  // 2. clientes afetados
  const byCustomer = new Map<number, typeof lateOrders>();
  for (const order of lateOrders) {
    byCustomer.set(order.customerId, [...(byCustomer.get(order.customerId) ?? []), order]);
  }

  // 3. rascunhos determinísticos
  const drafts = [...byCustomer.entries()].map(([customerId, orders]) => ({
    ...lateOrderNotification(
      { id: customerId, name: orders[0].customerName },
      orders.map((o) => ({ orderId: o.orderId, daysLate: o.daysLate })),
    ),
    customerName: orders[0].customerName,
    orderIds: orders.map((o) => o.orderId),
  }));

  // 4. persiste e para, aguardando aprovação
  const payload: LateOrderNotificationsPayload = { preparedAt: now.toISOString(), lateOrders, drafts };
  const run = await workflowRunRepository.create(ctx.db, {
    workflow: LATE_ORDER_WORKFLOW,
    status: drafts.length ? "awaiting_approval" : "completed",
    requestedBy: principal.id,
    payload,
  });
  return summarize({ ...run, result: null } as Run, false);
}

/** 5. Envio — só para runs aguardando aprovação; idempotente pela transição de estado. */
export async function sendPreparedLateOrderNotifications(ctx: AppContext, principal: Principal, runId: string) {
  assertCan(principal, "notifications:send");

  return ctx.db.transaction(async (tx) => {
    const run = await workflowRunRepository.findById<LateOrderNotificationsPayload, LateOrderNotificationsResult>(tx, runId, {
      forUpdate: true,
    });
    if (!run || run.workflow !== LATE_ORDER_WORKFLOW) throw notFound("Execução de workflow", runId);
    if (run.status !== "awaiting_approval") {
      throw invalidState(`Execução ${runId} não está aguardando aprovação (status: ${run.status})`, { status: run.status });
    }

    const result: LateOrderNotificationsResult = { sent: [], skipped: [] };
    for (const draft of run.payload.drafts) {
      try {
        const sent = await sendCustomerNotification(
          ctx,
          principal,
          { customerId: draft.customerId, orderId: draft.orderId, subject: draft.subject, body: draft.body },
          { tx, workflowRunId: run.id },
        );
        result.sent.push({ customerId: draft.customerId, notificationId: sent.notificationId });
      } catch (error) {
        // Regras de negócio (ex.: limite diário) pulam o cliente sem abortar o lote.
        if (!(error instanceof DomainError)) throw error;
        result.skipped.push({ customerId: draft.customerId, reason: error.message });
      }
    }

    await workflowRunRepository.finish(tx, run.id, { status: "completed", approvedBy: principal.id, result });
    return { runId: run.id, status: "completed" as const, ...result };
  });
}
