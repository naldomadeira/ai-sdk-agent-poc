import { describe, expect, it } from "vitest";
import { invokeCapability } from "@/capabilities/capability";
import { inspectSchema, queryDatabase, type QueryDatabaseOutput } from "@/capabilities/database/read-capabilities";
import { readonlyPool } from "@/infrastructure/db/pool";
import { SEED_FACTS } from "@/infrastructure/db/seed";
import { auditRows, capabilityContext } from "../helpers/capability-context";
import { db, principals, withSeededDatabase } from "../helpers/db";

withSeededDatabase();

const ctx = () => capabilityContext(principals.viewer);
const query = async (sql: string, maxRows?: number) => {
  const result = await invokeCapability(queryDatabase, { sql, purpose: "teste", maxRows }, ctx());
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.data as QueryDatabaseOutput;
};

describe("inspectSchema", () => {
  it("expõe só o domínio de e-commerce, com documentação de negócio", async () => {
    const result = await invokeCapability(inspectSchema, {}, ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const names = result.data.relations.map((r) => r.name).sort();
    expect(names).toEqual(
      ["customer_notifications", "customer_spending", "customers", "late_orders", "order_items", "orders", "payments", "products"].sort(),
    );
    const orders = result.data.relations.find((r) => r.name === "orders")!;
    expect(orders.columns.find((c) => c.name === "status")?.description).toContain("pending=");
    expect(orders.foreignKeys).toContainEqual({ column: "customer_id", references: "customers.id" });
  });

  it("filtra por tabela", async () => {
    const result = await invokeCapability(inspectSchema, { tables: ["late_orders"] }, ctx());
    expect(result.ok && result.data.relations.map((r) => r.name)).toEqual(["late_orders"]);
  });
});

describe("queryDatabase — perguntas de negócio", () => {
  it("pedidos pendentes", async () => {
    const r = await query("SELECT id FROM orders WHERE status = 'pending' ORDER BY id");
    expect(r.rows.map((row) => row.id)).toEqual([126, 128, 133, 135, 137]);
  });

  it("pedidos atrasados (view semântica)", async () => {
    const r = await query("SELECT order_id FROM late_orders ORDER BY order_id");
    expect(r.rows.map((row) => row.order_id)).toEqual([...SEED_FACTS.lateOrderIds]);
  });

  it("cliente que mais gastou", async () => {
    const r = await query(
      "SELECT customer_name, SUM(spent_cents) AS total FROM customer_spending GROUP BY 1 ORDER BY 2 DESC LIMIT 1",
    );
    expect(r.rows).toHaveLength(1);
    expect(r.columns).toEqual(["customer_name", "total"]);
  });

  it("aplica o limite de linhas por fora e sinaliza truncamento", async () => {
    const r = await query("SELECT id FROM orders", 500);
    expect(r.maxRows).toBe(20); // AGENT_QUERY_MAX_ROWS no ambiente de teste
    expect(r.rowCount).toBe(20);
    expect(r.truncated).toBe(true);
  });
});

describe("queryDatabase — segurança", () => {
  it.each(["DELETE FROM orders", "UPDATE orders SET status='paid'", "DROP TABLE orders", "TRUNCATE orders"])(
    "recusa escrita: %s",
    async (sql) => {
      const result = await invokeCapability(queryDatabase, { sql, purpose: "ataque" }, ctx());
      expect(result).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
      expect((await db.query("SELECT count(*)::int AS n FROM orders")).rows[0].n).toBe(SEED_FACTS.orderCount);
    },
  );

  it("sem acesso a tabelas da plataforma (GRANT)", async () => {
    const result = await invokeCapability(queryDatabase, { sql: "SELECT * FROM staff_users", purpose: "ataque" }, ctx());
    expect(result).toMatchObject({ ok: false, error: { message: expect.stringContaining("Sem permissão") } });
  });

  it("timeout", async () => {
    const result = await invokeCapability(
      queryDatabase,
      { sql: "SELECT count(*) FROM generate_series(1, 1000000000)", purpose: "lenta" },
      ctx(),
    );
    expect(result).toMatchObject({ ok: false, error: { message: expect.stringContaining("tempo limite") } });
  });

  it("erro de SQL volta como mensagem para o agente corrigir", async () => {
    const result = await invokeCapability(queryDatabase, { sql: "SELECT coluna_que_nao_existe FROM orders", purpose: "erro" }, ctx());
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_INPUT", message: expect.stringContaining("coluna_que_nao_existe") } });
  });

  it("a role do agente é somente leitura mesmo sem a validação (defesa em profundidade)", async () => {
    await expect(readonlyPool().query("DELETE FROM orders")).rejects.toThrow(/read-only|permission denied/);
    await expect(readonlyPool().query("INSERT INTO customers (name, email) VALUES ('x', 'x@x')")).rejects.toThrow(
      /read-only|permission denied/,
    );
  });

  it("toda consulta é auditada com o propósito", async () => {
    await query("SELECT 1 AS um");
    await invokeCapability(queryDatabase, { sql: "DELETE FROM orders", purpose: "ataque" }, ctx());
    const rows = await auditRows("queryDatabase");
    expect(rows.map((r) => r.status)).toEqual(["ok", "error"]);
    expect(rows[0]).toMatchObject({ actor_id: "u_carla", event: "capability_call", input: { purpose: "teste" } });
  });
});
