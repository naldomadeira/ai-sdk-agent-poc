import type { NotificationDraft } from "@/domain/notifications/notification";
import type { Queryable } from "../pool";

export const notificationRepository = {
  async countSince(db: Queryable, customerId: number, since: Date): Promise<number> {
    const { rows } = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM customer_notifications WHERE customer_id = $1 AND created_at >= $2",
      [customerId, since],
    );
    return rows[0].n;
  },

  async insert(
    db: Queryable,
    draft: NotificationDraft,
    meta: { sentBy: string; workflowRunId?: string; at: Date },
  ): Promise<{ id: number }> {
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO customer_notifications (customer_id, order_id, subject, body, sent_by, workflow_run_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [draft.customerId, draft.orderId ?? null, draft.subject, draft.body, meta.sentBy, meta.workflowRunId ?? null, meta.at],
    );
    return rows[0];
  },
};
