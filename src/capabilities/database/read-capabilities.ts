import type { DatabaseError } from "pg";
import { z } from "zod";
import { env } from "@/config/env";
import { DomainError, invalidInput } from "@/domain/shared/errors";
import { defineCapability } from "../capability";
import { validateReadOnlySql } from "./sql-guard";

/**
 * Leitura genérica e controlada: 2 capabilities cobrem qualquer pergunta sobre os dados,
 * em vez de uma tool por método de repositório (getOrdersByCustomer, getTopCustomers...).
 */

interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  description: string | null;
}

interface RelationInfo {
  name: string;
  kind: "table" | "view";
  description: string | null;
  columns: ColumnInfo[];
  foreignKeys: { column: string; references: string }[];
}

export const inspectSchema = defineCapability({
  name: "inspectSchema",
  kind: "read",
  permission: "data:read",
  approval: "none",
  description:
    "Lista tabelas e views que você pode consultar, com colunas, tipos, chaves estrangeiras e a " +
    "documentação de negócio de cada uma (ex.: significado de status, definição de 'atrasado'). " +
    "Chame antes de escrever SQL para tabelas que ainda não conhece.",
  inputSchema: z.object({
    tables: z.array(z.string().max(63)).max(20).optional().describe("Filtrar por nomes; omita para todas"),
  }),
  async execute({ tables }, ctx): Promise<{ relations: RelationInfo[] }> {
    // Executa com a role agent_readonly: só aparecem relações que ela pode ler.
    const { rows } = await ctx.readonlyPool.query<{
      relname: string; relkind: string; rel_description: string | null; column_name: string;
      data_type: string; is_nullable: boolean; col_description: string | null; fk_ref: string | null;
    }>(
      `SELECT c.relname, c.relkind, obj_description(c.oid, 'pg_class') AS rel_description,
              a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS data_type,
              NOT a.attnotnull AS is_nullable, col_description(c.oid, a.attnum) AS col_description,
              (SELECT rc.relname || '.' || ra.attname
                 FROM pg_constraint k
                 JOIN pg_class rc ON rc.oid = k.confrelid
                 JOIN pg_attribute ra ON ra.attrelid = k.confrelid AND ra.attnum = k.confkey[1]
                WHERE k.conrelid = c.oid AND k.contype = 'f' AND k.conkey[1] = a.attnum LIMIT 1) AS fk_ref
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       WHERE c.relkind IN ('r', 'v') AND has_table_privilege(c.oid, 'SELECT')
         AND ($1::text[] IS NULL OR c.relname = ANY($1))
       ORDER BY c.relkind, c.relname, a.attnum`,
      [tables?.length ? tables : null],
    );

    const byName = new Map<string, RelationInfo>();
    for (const r of rows) {
      let rel = byName.get(r.relname);
      if (!rel) {
        rel = { name: r.relname, kind: r.relkind === "v" ? "view" : "table", description: r.rel_description, columns: [], foreignKeys: [] };
        byName.set(r.relname, rel);
      }
      rel.columns.push({ name: r.column_name, type: r.data_type, nullable: r.is_nullable, description: r.col_description });
      if (r.fk_ref) rel.foreignKeys.push({ column: r.column_name, references: r.fk_ref });
    }
    return { relations: [...byName.values()] };
  },
});

export interface QueryDatabaseOutput {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  maxRows: number;
  durationMs: number;
}

const PG_ERRORS: Record<string, string> = {
  "57014": "Consulta excedeu o tempo limite; simplifique ou filtre mais",
  "42501": "Sem permissão de leitura nessa tabela/função (use inspectSchema para ver o que é permitido)",
  "25006": "Operação de escrita recusada: conexão somente leitura",
};

export const queryDatabase = defineCapability({
  name: "queryDatabase",
  kind: "read",
  permission: "data:read",
  approval: "none",
  description:
    "Executa UMA consulta SQL somente leitura (SELECT ou WITH...SELECT, dialeto PostgreSQL) e devolve as linhas. " +
    "Valores monetários estão em centavos (colunas *_cents). Prefira as views late_orders e customer_spending " +
    "para 'atrasados' e 'quanto gastou'. Escritas são impossíveis aqui: para agir use as tools de negócio.",
  inputSchema: z.object({
    sql: z.string().min(1).max(5_000).describe("Uma única instrução SELECT"),
    purpose: z.string().min(3).max(200).describe("Em uma frase, a pergunta que esta consulta responde (vai para o log de auditoria)"),
    maxRows: z.number().int().min(1).max(500).optional().describe("Limite de linhas (padrão definido pela aplicação)"),
  }),
  async execute({ sql, maxRows }, ctx): Promise<QueryDatabaseOutput> {
    const guard = validateReadOnlySql(sql);
    if (!guard.ok) throw invalidInput(guard.reason);

    const { AGENT_QUERY_TIMEOUT_MS: timeoutMs, AGENT_QUERY_MAX_ROWS: configMax } = env();
    const limit = Math.min(maxRows ?? configMax, configMax);
    const started = Date.now();
    const client = await ctx.readonlyPool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query(`SET LOCAL statement_timeout = ${Math.trunc(timeoutMs)}`);
      // Limite aplicado por fora: o agente não consegue pedir mais linhas que o permitido.
      const result = await client.query(`SELECT * FROM (\n${guard.sql}\n) AS agent_query LIMIT ${limit + 1}`);
      const truncated = result.rows.length > limit;
      const rows = truncated ? result.rows.slice(0, limit) : result.rows;
      return {
        columns: result.fields.map((f) => f.name),
        rows,
        rowCount: rows.length,
        truncated,
        maxRows: limit,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      const pgError = error as DatabaseError;
      const known = pgError.code ? PG_ERRORS[pgError.code] : undefined;
      // Erros de SQL (sintaxe, coluna inexistente) voltam ao agente para ele corrigir a consulta.
      throw new DomainError("INVALID_INPUT", known ?? `Erro no SQL: ${pgError.message}`, { pgCode: pgError.code });
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  },
});
