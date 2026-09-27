import type { Queryable } from "@/infrastructure/db/pool";

/**
 * Snapshot das tabelas de negócio para medir "efeitos": o que mudou no banco durante um caso.
 * Tabelas da plataforma que mudam por design (chats, agent_audit_log) ficam de fora.
 */
const TABLES = ["customers", "products", "orders", "order_items", "payments", "customer_notifications", "workflow_runs"] as const;
const VOLATILE = new Set(["updated_at"]);

export type Snapshot = Record<string, Map<string, Record<string, unknown>>>;

export interface DatabaseChange {
  table: string;
  id: string;
  kind: "insert" | "update" | "delete";
  changes?: Record<string, { before: unknown; after: unknown }>;
}

export async function snapshot(db: Queryable): Promise<Snapshot> {
  const result: Snapshot = {};
  for (const table of TABLES) {
    const { rows } = await db.query(`SELECT * FROM ${table} ORDER BY id`);
    result[table] = new Map(rows.map((r) => [String(r.id), JSON.parse(JSON.stringify(r))]));
  }
  return result;
}

export function diff(before: Snapshot, after: Snapshot): DatabaseChange[] {
  const changes: DatabaseChange[] = [];
  for (const table of TABLES) {
    const a = before[table];
    const b = after[table];
    for (const [id, row] of b) {
      const old = a.get(id);
      if (!old) {
        changes.push({ table, id, kind: "insert" });
        continue;
      }
      const fields: DatabaseChange["changes"] = {};
      for (const key of Object.keys(row)) {
        if (VOLATILE.has(key)) continue;
        if (JSON.stringify(old[key]) !== JSON.stringify(row[key])) fields[key] = { before: old[key], after: row[key] };
      }
      if (Object.keys(fields).length) changes.push({ table, id, kind: "update", changes: fields });
    }
    for (const id of a.keys()) if (!b.has(id)) changes.push({ table, id, kind: "delete" });
  }
  return changes;
}
