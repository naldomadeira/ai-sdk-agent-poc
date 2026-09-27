import type { Order, OrderStatus } from "@/domain/orders/order";
import type { Queryable } from "../pool";

interface OrderRow {
  id: number;
  customer_id: number;
  status: OrderStatus;
  total_cents: number;
  placed_at: Date;
  expected_delivery_at: Date;
}

const toOrder = (r: OrderRow): Order => ({
  id: r.id,
  customerId: r.customer_id,
  status: r.status,
  totalCents: r.total_cents,
  placedAt: r.placed_at,
  expectedDeliveryAt: r.expected_delivery_at,
});

const COLUMNS = "id, customer_id, status, total_cents, placed_at, expected_delivery_at";

export interface LateOrderRow {
  orderId: number;
  customerId: number;
  customerName: string;
  daysLate: number;
}

export const orderRepository = {
  async findById(db: Queryable, id: number, opts: { forUpdate?: boolean } = {}): Promise<Order | null> {
    const { rows } = await db.query<OrderRow>(
      `SELECT ${COLUMNS} FROM orders WHERE id = $1 ${opts.forUpdate ? "FOR UPDATE" : ""}`,
      [id],
    );
    return rows[0] ? toOrder(rows[0]) : null;
  },

  async markCancelled(db: Queryable, id: number, reason: string, at: Date): Promise<void> {
    await db.query(
      "UPDATE orders SET status = 'cancelled', cancelled_at = $2, cancel_reason = $3 WHERE id = $1",
      [id, at, reason],
    );
  },

  async setStatus(db: Queryable, id: number, status: OrderStatus): Promise<void> {
    await db.query("UPDATE orders SET status = $2 WHERE id = $1", [id, status]);
  },

  async findLate(db: Queryable, now: Date): Promise<LateOrderRow[]> {
    const { rows } = await db.query<{ order_id: number; customer_id: number; name: string; days_late: number }>(
      `SELECT o.id AS order_id, o.customer_id, c.name,
              floor(extract(epoch FROM $1::timestamptz - o.expected_delivery_at) / 86400)::int AS days_late
       FROM orders o JOIN customers c ON c.id = o.customer_id
       WHERE o.status IN ('pending','paid','processing','shipped') AND o.expected_delivery_at < $1
       ORDER BY o.customer_id, o.id`,
      [now],
    );
    return rows.map((r) => ({
      orderId: r.order_id,
      customerId: r.customer_id,
      customerName: r.name,
      daysLate: r.days_late,
    }));
  },
};
