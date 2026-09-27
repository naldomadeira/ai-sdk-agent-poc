import { isToolUIPart } from "ai";
import { describe, expect, it } from "vitest";
import { reconcileStoredChat } from "@/agents/chat-reconcile";
import { chatRepository } from "@/infrastructure/db/repositories/chat-repository";
import { sendPreparedLateOrderNotifications } from "@/workflows/late-order-notifications";
import { lastUuidIn } from "../../evaluation/scripted-model";
import { EvalSession } from "../../evaluation/session";
import { NOW, ctx, db, principals, withSeededDatabase } from "../helpers/db";

withSeededDatabase();

const prepare = [{ toolCalls: [{ toolName: "prepareLateOrderNotifications", input: {} }] }, { text: "Rascunhos prontos." }];
const send = [(p: string) => ({ toolCalls: [{ toolName: "sendPreparedNotifications", input: { runId: lastUuidIn(p) } }] })];
const count = async (sql: string) => (await db.query<{ n: number }>(sql)).rows[0].n;
const notifications = () => count("SELECT count(*)::int AS n FROM customer_notifications");

async function prepareResult(s: EvalSession) {
  const history = await s.history();
  const part = history.flatMap((m) => m.parts).reverse().find((p) => isToolUIPart(p) && p.type === "tool-prepareLateOrderNotifications");
  return (part as unknown as { output: { data: Record<string, unknown> } }).output.data;
}

describe("workflow reaproveitado por idempotência entre usuários", () => {
  it("Ana cria → Bruno reaproveita com contexto correto → ninguém decide de novo", async () => {
    // 1. Ana prepara e pede o envio, mas não responde à aprovação.
    const ana = new EvalSession({ mode: "mock", db, now: NOW, principal: principals.manager, chatId: "reuse-ana" });
    await ana.say("Encontre pedidos atrasados e prepare notificações.", prepare);
    await ana.say("Pode enviar.", send);
    expect(ana.pendingApproval()).toBeDefined();
    const anaRun = await prepareResult(ana);
    expect(anaRun).toMatchObject({ reusedExistingRun: false, preparedByCurrentUser: true });

    // 2. Bruno prepara: recebe a MESMA execução, com a informação de que é da Ana.
    const bruno = new EvalSession({ mode: "mock", db, now: NOW, principal: principals.support, chatId: "reuse-bruno" });
    await bruno.say("Encontre pedidos atrasados e prepare notificações.", prepare);
    const brunoRun = await prepareResult(bruno);
    expect(brunoRun).toMatchObject({
      runId: anaRun.runId,
      reusedExistingRun: true,
      preparedByCurrentUser: false,
      requestedBy: "Ana (gerente)",
    });
    expect(brunoRun.notice).toMatch(/Já existe uma execução pendente.*Ana \(gerente\).*Nenhuma execução nova/);
    expect(await count("SELECT count(*)::int AS n FROM workflow_runs")).toBe(1); // idempotência preservada

    // 3. Bruno aprova o envio: 4 notificações, uma vez.
    await bruno.say("Pode enviar.", send);
    await bruno.answerApproval(true, [{ text: "Enviadas." }]);
    expect(await notifications()).toBe(4);
    const run = (await db.query("SELECT status, requested_by, approved_by FROM workflow_runs")).rows[0];
    expect(run).toMatchObject({ status: "completed", requested_by: "u_ana", approved_by: "u_bruno" });

    // 4. O chat da Ana é reconciliado: o pedido pendente vira ALREADY_DECIDED (a UI não mostra mais Aprovar).
    const reconciled = await reconcileStoredChat(ctx, (await chatRepository.findById(db, "reuse-ana"))!);
    const anaParts = reconciled.messages.flatMap((m) => m.parts).filter(isToolUIPart);
    expect(anaParts.some((p) => p.state === "approval-requested")).toBe(false);
    expect(anaParts.find((p) => p.type === "tool-sendPreparedNotifications")).toMatchObject({
      state: "output-available",
      output: { ok: false, error: { code: "ALREADY_DECIDED", message: expect.stringContaining("Bruno") } },
    });

    // 5. Aba desatualizada da Ana tenta aprovar (ou negar): 409, nada reenviado.
    expect((await ana.answerApproval(true, [{ text: "x" }])).status).toBe(409);
    expect((await ana.answerApproval(false, [{ text: "x" }])).status).toBe(409);

    // 6. Bruno reapresenta a própria aprovação: 409.
    const approvedAgain = { ...bruno.last!, parts: bruno.last!.parts.map((p) => (isToolUIPart(p) && p.type === "tool-sendPreparedNotifications" ? { ...p, state: "approval-responded", approval: { id: "x", approved: true } } : p)) };
    expect((await bruno.resend(approvedAgain, [{ text: "x" }])).status).toBe(409);

    // 7. Direto no workflow, qualquer um: ALREADY_DECIDED.
    for (const who of [principals.manager, principals.support]) {
      await expect(sendPreparedLateOrderNotifications(ctx, who, String(anaRun.runId))).rejects.toMatchObject({ code: "ALREADY_DECIDED" });
    }
    expect(await notifications()).toBe(4);
  });
});
