import { describe, expect, it } from "vitest";
import { validateReadOnlySql } from "@/capabilities/database/sql-guard";

const reason = (sql: string) => {
  const r = validateReadOnlySql(sql);
  return r.ok ? "OK" : r.reason;
};

describe("validateReadOnlySql", () => {
  it.each([
    "SELECT * FROM orders",
    "select id from orders where status = 'pending';",
    "WITH t AS (SELECT 1 AS x) SELECT x FROM t",
    "SELECT * FROM orders WHERE cancel_reason = 'please update; drop table orders'",
    'SELECT "id" FROM orders -- comentário com DELETE',
    "SELECT /* insert */ 1",
  ])("aceita: %s", (sql) => {
    expect(reason(sql)).toBe("OK");
  });

  it.each([
    ["INSERT INTO orders VALUES (1)", "Apenas SELECT"],
    ["UPDATE orders SET status = 'paid'", "Apenas SELECT"],
    ["DELETE FROM orders", "Apenas SELECT"],
    ["DROP TABLE orders", "Apenas SELECT"],
    ["ALTER TABLE orders ADD x int", "Apenas SELECT"],
    ["TRUNCATE orders", "Apenas SELECT"],
    ["SELECT 1; DELETE FROM orders", "uma instrução"],
    ["WITH d AS (DELETE FROM orders RETURNING *) SELECT * FROM d", "DELETE"],
    ["SELECT * INTO copia FROM orders", "INTO"],
    ["SELECT * FROM orders FOR UPDATE", "UPDATE"],
    ["SELECT pg_sleep(10)", "pg_sleep"],
    ['SELECT "pg_sleep"(10)', "pg_sleep"],
    ["SELECT pg_read_file('/etc/passwd')", "pg_read_file"],
    ["SELECT set_config('x', 'y', false)", "set_config"],
    ["SELECT $$x$$", "dollar-quoting"],
    ["SELECT 'aberto", "não terminado"],
    ["", "vazio"],
    ["SELECT 1 " + "x".repeat(6000), "excede"],
  ])("recusa: %s", (sql, expected) => {
    expect(reason(sql)).toContain(expected);
  });
});
