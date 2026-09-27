/**
 * Primeira camada de defesa do queryDatabase: validação estática do SQL.
 * NÃO é a única — a conexão usa a role agent_readonly (só SELECT) dentro de
 * `BEGIN READ ONLY`. Esta camada existe para recusar cedo, com mensagem útil ao agente,
 * e para bloquear funções perigosas que um SELECT ainda poderia chamar.
 */

export const MAX_SQL_LENGTH = 5_000;

const FORBIDDEN_KEYWORDS = [
  "insert", "update", "delete", "merge", "upsert", "drop", "alter", "truncate", "create", "grant",
  "revoke", "copy", "call", "do", "execute", "prepare", "deallocate", "vacuum", "analyze", "cluster",
  "reindex", "lock", "listen", "notify", "unlisten", "set", "reset", "refresh", "comment", "security",
  "into", "begin", "commit", "rollback", "savepoint", "discard", "load", "import", "checkpoint",
];

const FORBIDDEN_FUNCTIONS = [
  "pg_sleep", "pg_sleep_for", "pg_sleep_until", "pg_read_file", "pg_read_binary_file", "pg_ls_dir",
  "pg_stat_file", "lo_import", "lo_export", "lo_get", "lo_open", "dblink", "dblink_exec",
  "pg_terminate_backend", "pg_cancel_backend", "set_config", "pg_reload_conf", "pg_advisory_lock",
  "pg_advisory_xact_lock", "pg_notify", "query_to_xml", "query_to_json", "txid_current",
];

export type SqlGuardResult = { ok: true; sql: string } | { ok: false; reason: string };

/** Substitui literais, identificadores entre aspas e comentários por marcadores neutros. */
function mask(sql: string): string | null {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += " ";
    } else if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) return null;
      i = end + 2;
      out += " ";
    } else if (ch === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") break;
        else i++;
      }
      if (i >= sql.length) return null;
      i++;
      out += "''";
    } else if (ch === '"') {
      const end = sql.indexOf('"', i + 1);
      if (end === -1) return null;
      // Mantém o conteúdo sem aspas: `"pg_sleep"(5)` precisa cair na checagem de funções.
      out += ` ${sql.slice(i + 1, end)} `;
      i = end + 1;
    } else if (ch === "$" && /[a-zA-Z_$]/.test(next ?? "") && /^\$[a-zA-Z_]*\$/.test(sql.slice(i))) {
      // Dollar-quoting ($$...$$) só aparece em DDL/funções; um SELECT de consulta não precisa.
      return null;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

export function validateReadOnlySql(input: string): SqlGuardResult {
  const sql = input.trim().replace(/;\s*$/, "").trim();
  if (!sql) return { ok: false, reason: "SQL vazio" };
  if (sql.length > MAX_SQL_LENGTH) return { ok: false, reason: `SQL excede ${MAX_SQL_LENGTH} caracteres` };

  const masked = mask(sql);
  if (masked === null) return { ok: false, reason: "SQL com literal/comentário não terminado ou dollar-quoting" };
  const lower = masked.toLowerCase();

  if (lower.includes(";")) return { ok: false, reason: "Apenas uma instrução por consulta" };
  if (!/^\s*(select|with)\b/.test(lower)) return { ok: false, reason: "Apenas SELECT (ou WITH ... SELECT) é permitido" };

  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`).test(lower)) {
      return { ok: false, reason: `Palavra-chave não permitida em consulta somente leitura: ${keyword.toUpperCase()}` };
    }
  }
  for (const fn of FORBIDDEN_FUNCTIONS) {
    if (new RegExp(`\\b${fn}\\s*\\(`).test(lower)) {
      return { ok: false, reason: `Função não permitida: ${fn}` };
    }
  }
  return { ok: true, sql };
}
