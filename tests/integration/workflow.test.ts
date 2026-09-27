import { describe, expect, it } from "vitest";
import { invokeCapability } from "@/capabilities/capability";
import { sendPreparedNotifications } from "@/capabilities/workflows/workflow-capabilities";
import { SEED_FACTS } from "@/infrastructure/db/seed";
import { prepareLateOrderNotifications, sendPreparedLateOrderNotifications } from "@/workflows/late-order-notifications";
import { capabilityContext } from "../helpers/capability-context";
import { ctx, db, principals, withSeededDatabase } from "../helpers/db";

withSeededDatabase();

const notificationCount = async () => (await db.query("SELECT count(*)::int AS n FROM customer_notifications")).rows[0].n;

describe("workflow late-order-notifications", () => {
  it("prepara rascunhos (um por cliente), sem enviar nada", async () => {
    const run = await prepareLateOrderNotifications(ctx, principals.support);
    expect(run.status).toBe("awaiting_approval");
    expect(run.lateOrderCount).toBe(SEED_FACTS.lateOrderIds.length);
    expect(run.drafts.map((d) => d.customerName).sort()).toEqual([...SEED_FACTS.lateCustomerNames].sort());
    expect(run.drafts.find((d) => d.customerName === "João Silva")?.body).toContain("#131");
    expect(await notificationCount()).toBe(0);
  });

  it("é determinístico: mesmos dados → mesmos rascunhos", async () => {
    const a = await prepareLateOrderNotifications(ctx, principals.support);
    const b = await prepareLateOrderNotifications(ctx, principals.support);
    expect(b.drafts).toEqual(a.drafts);
  });

  it("envia após aprovação e não reenvia", async () => {
    const run = await prepareLateOrderNotifications(ctx, principals.support);
    const sent = await sendPreparedLateOrderNotifications(ctx, principals.support, run.runId);
    expect(sent.sent).toHaveLength(run.customerCount);
    expect(await notificationCount()).toBe(run.customerCount);

    await expect(sendPreparedLateOrderNotifications(ctx, principals.support, run.runId)).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await notificationCount()).toBe(run.customerCount);
  });

  it("cliente no limite diário é pulado sem abortar o lote", async () => {
    for (let i = 0; i < 3; i++) {
      await db.query(
        "INSERT INTO customer_notifications (customer_id, subject, body, sent_by) VALUES (1, 'x', 'mensagem anterior', 'u_bruno')",
      );
    }
    const run = await prepareLateOrderNotifications(ctx, principals.support);
    const result = await sendPreparedLateOrderNotifications(ctx, principals.support, run.runId);
    expect(result.skipped).toMatchObject([{ customerId: 1, reason: expect.stringContaining("limite") }]);
    expect(result.sent).toHaveLength(run.customerCount - 1);
  });

  it("viewer não dispara o workflow", async () => {
    await expect(prepareLateOrderNotifications(ctx, principals.viewer)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("via capability, o envio exige aprovação humana", async () => {
    const run = await prepareLateOrderNotifications(ctx, principals.support);
    const result = await invokeCapability(sendPreparedNotifications, { runId: run.runId }, capabilityContext(principals.support));
    expect(result).toMatchObject({ ok: false, error: { code: "APPROVAL_REQUIRED" } });
    expect(await notificationCount()).toBe(0);
  });
});
