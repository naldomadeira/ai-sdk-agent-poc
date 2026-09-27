import type { Payment, PaymentStatus } from "@/domain/payments/payment";
import type { Queryable } from "../pool";

interface PaymentRow {
  id: number;
  order_id: number;
  method: Payment["method"];
  status: PaymentStatus;
  amount_cents: number;
  refunded_cents: number;
}

export const paymentRepository = {
  async findByOrderId(db: Queryable, orderId: number, opts: { forUpdate?: boolean } = {}): Promise<Payment | null> {
    const { rows } = await db.query<PaymentRow>(
      `SELECT id, order_id, method, status, amount_cents, refunded_cents
       FROM payments WHERE order_id = $1 ${opts.forUpdate ? "FOR UPDATE" : ""}`,
      [orderId],
    );
    const r = rows[0];
    return r
      ? {
          id: r.id,
          orderId: r.order_id,
          method: r.method,
          status: r.status,
          amountCents: r.amount_cents,
          refundedCents: r.refunded_cents,
        }
      : null;
  },

  async applyRefund(
    db: Queryable,
    paymentId: number,
    refundCents: number,
    status: PaymentStatus,
    reason: string,
    at: Date,
  ): Promise<void> {
    await db.query(
      `UPDATE payments SET refunded_cents = refunded_cents + $2, status = $3, refund_reason = $4, refunded_at = $5
       WHERE id = $1`,
      [paymentId, refundCents, status, reason, at],
    );
  },
};
