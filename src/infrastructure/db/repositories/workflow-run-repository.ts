import type { Queryable } from "../pool";

export type WorkflowRunStatus = "awaiting_approval" | "running" | "completed" | "rejected" | "failed";

export interface WorkflowRun<P = unknown, R = unknown> {
  id: string;
  workflow: string;
  status: WorkflowRunStatus;
  requestedBy: string;
  approvedBy: string | null;
  payload: P;
  result: R | null;
}

interface Row {
  id: string;
  workflow: string;
  status: WorkflowRunStatus;
  requested_by: string;
  approved_by: string | null;
  payload: unknown;
  result: unknown;
}

const toRun = <P, R>(r: Row): WorkflowRun<P, R> => ({
  id: r.id,
  workflow: r.workflow,
  status: r.status,
  requestedBy: r.requested_by,
  approvedBy: r.approved_by,
  payload: r.payload as P,
  result: r.result as R | null,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const workflowRunRepository = {
  async create<P>(db: Queryable, run: { workflow: string; status: WorkflowRunStatus; requestedBy: string; payload: P }) {
    const { rows } = await db.query<Row>(
      `INSERT INTO workflow_runs (workflow, status, requested_by, payload) VALUES ($1, $2, $3, $4) RETURNING *`,
      [run.workflow, run.status, run.requestedBy, JSON.stringify(run.payload)],
    );
    return toRun<P, never>(rows[0]);
  },

  async findById<P, R>(db: Queryable, id: string, opts: { forUpdate?: boolean } = {}) {
    if (!UUID.test(id)) return null;
    const { rows } = await db.query<Row>(
      `SELECT * FROM workflow_runs WHERE id = $1 ${opts.forUpdate ? "FOR UPDATE" : ""}`,
      [id],
    );
    return rows[0] ? toRun<P, R>(rows[0]) : null;
  },

  async findLatestByStatus<P, R>(db: Queryable, workflow: string, status: WorkflowRunStatus) {
    const { rows } = await db.query<Row>(
      "SELECT * FROM workflow_runs WHERE workflow = $1 AND status = $2 ORDER BY created_at DESC LIMIT 1",
      [workflow, status],
    );
    return rows[0] ? toRun<P, R>(rows[0]) : null;
  },

  async listByStatusSince<P, R>(db: Queryable, workflow: string, status: WorkflowRunStatus, since: Date) {
    const { rows } = await db.query<Row>(
      "SELECT * FROM workflow_runs WHERE workflow = $1 AND status = $2 AND updated_at >= $3 ORDER BY created_at",
      [workflow, status, since],
    );
    return rows.map((r) => toRun<P, R>(r));
  },

  async finish<R>(db: Queryable, id: string, update: { status: WorkflowRunStatus; approvedBy?: string; result: R }) {
    await db.query(
      `UPDATE workflow_runs SET status = $2, approved_by = $3, result = $4, updated_at = now() WHERE id = $1`,
      [id, update.status, update.approvedBy ?? null, JSON.stringify(update.result)],
    );
  },
};
