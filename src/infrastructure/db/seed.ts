import type { Queryable } from "./pool";

/**
 * Seed determinístico: mesmos dados sempre, com datas relativas a `now`
 * (assim "hoje", "este mês" e "atrasado" funcionam em qualquer dia).
 *
 * Pedidos começam em #100. Pedidos com papel fixo nos cenários da POC:
 *  - #123 João Silva, pago e ainda não enviado → pode ser cancelado e reembolsado.
 *  - #104, #110, #131, #140 atrasados (prazo vencido e não entregues).
 */

export const STAFF = [
  { id: "u_ana", name: "Ana (gerente)", role: "manager" },
  { id: "u_bruno", name: "Bruno (suporte)", role: "support" },
  { id: "u_carla", name: "Carla (leitura)", role: "viewer" },
] as const;

const CUSTOMERS = [
  ["João Silva", "joao.silva@example.com", "São Paulo"],
  ["Maria Oliveira", "maria.oliveira@example.com", "Rio de Janeiro"],
  ["Pedro Santos", "pedro.santos@example.com", "Belo Horizonte"],
  ["Ana Costa", "ana.costa@example.com", "Curitiba"],
  ["Lucas Pereira", "lucas.pereira@example.com", "Porto Alegre"],
  ["Juliana Almeida", "juliana.almeida@example.com", "Recife"],
  ["Rafael Souza", "rafael.souza@example.com", "Salvador"],
  ["Fernanda Lima", "fernanda.lima@example.com", "Fortaleza"],
  ["Carlos Rodrigues", "carlos.rodrigues@example.com", "Brasília"],
  ["Beatriz Gomes", "beatriz.gomes@example.com", "Campinas"],
] as const;

const PRODUCTS = [
  ["NB-001", "Notebook Pro 14", "eletrônicos", 689900],
  ["PH-002", "Smartphone X", "eletrônicos", 349900],
  ["HP-003", "Fone Bluetooth", "acessórios", 29990],
  ["KB-004", "Teclado Mecânico", "acessórios", 44990],
  ["MS-005", "Mouse Sem Fio", "acessórios", 12990],
  ["MN-006", "Monitor 27\"", "eletrônicos", 189900],
  ["CH-007", "Cadeira Ergonômica", "móveis", 129900],
  ["DK-008", "Mesa Ajustável", "móveis", 219900],
  ["BK-009", "Livro TypeScript", "livros", 8990],
  ["CB-010", "Cabo USB-C", "acessórios", 4990],
] as const;

type Status = "pending" | "paid" | "processing" | "shipped" | "delivered" | "cancelled" | "refunded";

/** [cliente(idx), horas atrás, status, itens [produto(idx), qtd][], método] — um por pedido, a partir do #100. */
type OrderSpec = [number, number, Status, [number, number][], "credit_card" | "pix" | "boleto"];

const DELIVERY_DAYS = 5;

// Horas atrás: < 24 ≈ hoje (se o seed rodar depois das ~dez da manhã); 120+ = prazo de 5 dias vencido.
const ORDERS: OrderSpec[] = [
  /* 100 */ [0, 24 * 40, "delivered", [[0, 1]], "credit_card"],
  /* 101 */ [1, 24 * 38, "delivered", [[1, 1], [2, 1]], "pix"],
  /* 102 */ [2, 24 * 35, "delivered", [[5, 2]], "credit_card"],
  /* 103 */ [3, 24 * 33, "cancelled", [[3, 1]], "boleto"],
  /* 104 */ [4, 24 * 12, "shipped", [[6, 1]], "credit_card"], // atrasado
  /* 105 */ [5, 24 * 30, "delivered", [[8, 3], [9, 2]], "pix"],
  /* 106 */ [0, 24 * 28, "delivered", [[3, 1], [4, 1]], "credit_card"],
  /* 107 */ [6, 24 * 27, "refunded", [[1, 1]], "credit_card"],
  /* 108 */ [7, 24 * 25, "delivered", [[7, 1]], "pix"],
  /* 109 */ [8, 24 * 24, "delivered", [[2, 2]], "credit_card"],
  /* 110 */ [1, 24 * 9, "processing", [[0, 1], [5, 1]], "credit_card"], // atrasado
  /* 111 */ [9, 24 * 22, "delivered", [[9, 5]], "pix"],
  /* 112 */ [2, 24 * 20, "delivered", [[1, 1]], "credit_card"],
  /* 113 */ [3, 24 * 18, "delivered", [[6, 2]], "boleto"],
  /* 114 */ [0, 24 * 16, "delivered", [[5, 1], [4, 1]], "pix"],
  /* 115 */ [4, 24 * 15, "delivered", [[8, 2]], "credit_card"],
  /* 116 */ [5, 24 * 14, "delivered", [[0, 1]], "credit_card"],
  /* 117 */ [6, 24 * 13, "delivered", [[3, 1], [2, 1]], "pix"],
  /* 118 */ [7, 24 * 11, "delivered", [[4, 3]], "credit_card"],
  /* 119 */ [8, 24 * 10, "delivered", [[7, 1], [6, 1]], "credit_card"],
  /* 120 */ [1, 24 * 8, "delivered", [[2, 1]], "pix"],
  /* 121 */ [9, 24 * 7, "delivered", [[1, 2]], "credit_card"],
  /* 122 */ [2, 24 * 6, "delivered", [[9, 3]], "boleto"],
  /* 123 */ [0, 24 * 2, "paid", [[1, 1], [2, 1]], "credit_card"], // cenário cancelar/reembolsar
  /* 124 */ [3, 24 * 4, "shipped", [[5, 1]], "pix"],
  /* 125 */ [4, 24 * 3, "processing", [[3, 1]], "credit_card"],
  /* 126 */ [5, 24 * 3, "pending", [[0, 1]], "boleto"],
  /* 127 */ [6, 24 * 2, "paid", [[7, 1]], "credit_card"],
  /* 128 */ [7, 24 * 2, "pending", [[4, 2]], "boleto"],
  /* 129 */ [8, 24 * 1, "processing", [[6, 1], [8, 1]], "pix"],
  /* 130 */ [9, 24 * 1, "paid", [[2, 1]], "credit_card"],
  /* 131 */ [0, 24 * 7, "processing", [[3, 1], [9, 1]], "credit_card"], // atrasado
  /* 132 */ [1, 6, "paid", [[1, 1]], "credit_card"],
  /* 133 */ [2, 5, "pending", [[9, 4]], "boleto"],
  /* 134 */ [3, 4, "paid", [[0, 1], [3, 1]], "pix"],
  /* 135 */ [0, 3, "pending", [[4, 1]], "pix"],
  /* 136 */ [5, 2, "paid", [[5, 1]], "credit_card"],
  /* 137 */ [6, 1, "pending", [[8, 1]], "boleto"],
  /* 138 */ [7, 24 * 45, "delivered", [[0, 1]], "credit_card"],
  /* 139 */ [8, 24 * 50, "delivered", [[1, 1]], "pix"],
  /* 140 */ [9, 24 * 6, "paid", [[6, 1]], "credit_card"], // atrasado
];

export const SEED_FACTS = {
  firstOrderId: 100,
  orderCount: ORDERS.length,
  cancellableOrderId: 123,
  lateOrderIds: [104, 110, 131, 140],
  lateCustomerNames: ["Lucas Pereira", "Maria Oliveira", "João Silva", "Beatriz Gomes"],
  joaoOrderIds: [100, 106, 114, 123, 131, 135],
} as const;

const HOUR = 3600_000;

export async function seed(db: Queryable, now = new Date()) {
  await db.query(`TRUNCATE consumed_approvals, agent_audit_log, customer_notifications, workflow_runs, chats, staff_users,
    payments, order_items, orders, products, customers RESTART IDENTITY CASCADE`);

  for (const s of STAFF) {
    await db.query("INSERT INTO staff_users (id, name, role) VALUES ($1, $2, $3)", [s.id, s.name, s.role]);
  }
  for (const [name, email, city] of CUSTOMERS) {
    await db.query(
      "INSERT INTO customers (name, email, phone, city, created_at) VALUES ($1, $2, $3, $4, $5)",
      [name, email, "+55 11 90000-0000", city, new Date(now.getTime() - 90 * 24 * HOUR)],
    );
  }
  for (const [sku, name, category, price] of PRODUCTS) {
    await db.query(
      "INSERT INTO products (sku, name, category, price_cents, stock) VALUES ($1, $2, $3, $4, $5)",
      [sku, name, category, price, 50],
    );
  }

  for (const [customerIdx, hoursAgo, status, items, method] of ORDERS) {
    const placedAt = new Date(now.getTime() - hoursAgo * HOUR);
    const expected = new Date(placedAt.getTime() + DELIVERY_DAYS * 24 * HOUR);
    const total = items.reduce((sum, [p, q]) => sum + PRODUCTS[p][3] * q, 0);
    const shippedAt = ["shipped", "delivered"].includes(status) ? new Date(placedAt.getTime() + 24 * HOUR) : null;
    const deliveredAt = status === "delivered" ? new Date(placedAt.getTime() + 4 * 24 * HOUR) : null;
    const cancelledAt = status === "cancelled" ? new Date(placedAt.getTime() + 2 * HOUR) : null;

    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO orders (customer_id, status, total_cents, placed_at, expected_delivery_at,
         shipped_at, delivered_at, cancelled_at, cancel_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [customerIdx + 1, status, total, placedAt, expected, shippedAt, deliveredAt, cancelledAt,
        cancelledAt ? "Cliente desistiu da compra" : null],
    );
    const orderId = rows[0].id;
    for (const [p, q] of items) {
      await db.query(
        "INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents) VALUES ($1,$2,$3,$4)",
        [orderId, p + 1, q, PRODUCTS[p][3]],
      );
    }

    const paymentStatus =
      status === "pending" ? "pending"
      : status === "cancelled" ? "failed"
      : status === "refunded" ? "refunded"
      : "captured";
    const paidAt = ["captured", "refunded"].includes(paymentStatus) ? new Date(placedAt.getTime() + HOUR) : null;
    await db.query(
      `INSERT INTO payments (order_id, method, status, amount_cents, refunded_cents, paid_at, refunded_at, refund_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [orderId, method, paymentStatus, total, paymentStatus === "refunded" ? total : 0, paidAt,
        paymentStatus === "refunded" ? new Date(placedAt.getTime() + 3 * 24 * HOUR) : null,
        paymentStatus === "refunded" ? "Produto com defeito" : null],
    );
  }
}
