-- Domínio de e-commerce. Valores monetários em centavos (inteiros) para evitar arredondamento.
-- Os COMMENTs são lidos por `inspectSchema`: são a documentação que o agente recebe.

CREATE TABLE customers (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text        NOT NULL,
  email       text        NOT NULL UNIQUE,
  phone       text,
  city        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE customers IS 'Clientes da loja.';

CREATE TABLE products (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku          text    NOT NULL UNIQUE,
  name         text    NOT NULL,
  category     text    NOT NULL,
  price_cents  integer NOT NULL CHECK (price_cents >= 0),
  stock        integer NOT NULL DEFAULT 0 CHECK (stock >= 0)
);
COMMENT ON TABLE products IS 'Catálogo de produtos.';
COMMENT ON COLUMN products.price_cents IS 'Preço atual em centavos de BRL.';

-- Pedidos começam em 100 para que "#123" seja um número de pedido realista.
CREATE TABLE orders (
  id                    integer GENERATED ALWAYS AS IDENTITY (START WITH 100) PRIMARY KEY,
  customer_id           integer     NOT NULL REFERENCES customers(id),
  status                text        NOT NULL CHECK (status IN
                          ('pending','paid','processing','shipped','delivered','cancelled','refunded')),
  total_cents           integer     NOT NULL CHECK (total_cents >= 0),
  placed_at             timestamptz NOT NULL DEFAULT now(),
  expected_delivery_at  timestamptz NOT NULL,
  shipped_at            timestamptz,
  delivered_at          timestamptz,
  cancelled_at          timestamptz,
  cancel_reason         text
);
CREATE INDEX orders_customer_idx ON orders (customer_id);
CREATE INDEX orders_placed_at_idx ON orders (placed_at);
CREATE INDEX orders_status_idx ON orders (status);
COMMENT ON TABLE orders IS 'Pedidos. O número do pedido (#123) é o id.';
COMMENT ON COLUMN orders.status IS
  'pending=aguardando pagamento; paid=pago; processing=em separação; shipped=enviado; delivered=entregue; cancelled=cancelado; refunded=reembolsado.';
COMMENT ON COLUMN orders.total_cents IS 'Total do pedido em centavos de BRL.';
COMMENT ON COLUMN orders.expected_delivery_at IS
  'Prazo prometido de entrega. Pedido atrasado = não entregue/cancelado/reembolsado e prazo < now(). Use a view late_orders.';

CREATE TABLE order_items (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id          integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id        integer NOT NULL REFERENCES products(id),
  quantity          integer NOT NULL CHECK (quantity > 0),
  unit_price_cents  integer NOT NULL CHECK (unit_price_cents >= 0)
);
CREATE INDEX order_items_order_idx ON order_items (order_id);
COMMENT ON TABLE order_items IS 'Itens de cada pedido, com o preço unitário praticado na compra.';

CREATE TABLE payments (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id        integer     NOT NULL UNIQUE REFERENCES orders(id),
  method          text        NOT NULL CHECK (method IN ('credit_card','pix','boleto')),
  status          text        NOT NULL CHECK (status IN
                    ('pending','captured','partially_refunded','refunded','failed')),
  amount_cents    integer     NOT NULL CHECK (amount_cents >= 0),
  refunded_cents  integer     NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  paid_at         timestamptz,
  refunded_at     timestamptz,
  refund_reason   text,
  CHECK (refunded_cents <= amount_cents)
);
COMMENT ON TABLE payments IS 'Pagamento de cada pedido (1:1).';
COMMENT ON COLUMN payments.status IS
  'pending=aguardando; captured=pago; partially_refunded=reembolso parcial; refunded=reembolsado; failed=falhou.';

-- Views semânticas: fixam definições de negócio para que o agente não as reinvente em SQL.
CREATE VIEW late_orders AS
SELECT o.id AS order_id, o.customer_id, c.name AS customer_name, o.status, o.total_cents,
       o.placed_at, o.expected_delivery_at,
       floor(extract(epoch FROM now() - o.expected_delivery_at) / 86400)::int AS days_late
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.status IN ('pending','paid','processing','shipped')
  AND o.expected_delivery_at < now();
COMMENT ON VIEW late_orders IS 'Pedidos atrasados: ainda não entregues e com prazo de entrega vencido.';

CREATE VIEW customer_spending AS
SELECT c.id AS customer_id, c.name AS customer_name, o.id AS order_id, o.placed_at,
       (o.total_cents - coalesce(p.refunded_cents, 0)) AS spent_cents
FROM orders o
JOIN customers c ON c.id = o.customer_id
LEFT JOIN payments p ON p.order_id = o.id
WHERE o.status IN ('paid','processing','shipped','delivered','refunded')
  AND p.status IN ('captured','partially_refunded','refunded');
COMMENT ON VIEW customer_spending IS
  'Gasto efetivo por pedido (pago, descontando reembolsos). "Quanto o cliente gastou" = SUM(spent_cents) filtrando placed_at.';
