import { invalidInput, invalidState } from "../shared/errors";

export type OrderStatus =
  | "pending"
  | "paid"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";

export interface Order {
  id: number;
  customerId: number;
  status: OrderStatus;
  totalCents: number;
  placedAt: Date;
  expectedDeliveryAt: Date;
}

const CANCELLABLE: readonly OrderStatus[] = ["pending", "paid", "processing"];
const OPEN: readonly OrderStatus[] = ["pending", "paid", "processing", "shipped"];

/** Regra: só cancela antes do envio, e sempre com motivo. */
export function assertCancellable(order: Order, reason: string): void {
  if (reason.trim().length < 5) {
    throw invalidInput("Informe o motivo do cancelamento (mín. 5 caracteres)");
  }
  if (order.status === "cancelled" || order.status === "refunded") {
    throw invalidState(`Pedido #${order.id} já está ${order.status === "cancelled" ? "cancelado" : "reembolsado"}`, {
      status: order.status,
    });
  }
  if (!CANCELLABLE.includes(order.status)) {
    throw invalidState(
      `Pedido #${order.id} não pode ser cancelado: status "${order.status}". Após o envio use o fluxo de devolução.`,
      { status: order.status },
    );
  }
}

/** Mesmo critério da view `late_orders`. */
export function isLate(order: Pick<Order, "status" | "expectedDeliveryAt">, now: Date): boolean {
  return OPEN.includes(order.status) && order.expectedDeliveryAt.getTime() < now.getTime();
}

/** Pedido pago cujo pagamento ainda precisa ser devolvido após o cancelamento. */
export function cancellationNeedsRefund(status: OrderStatus): boolean {
  return status === "paid" || status === "processing";
}
