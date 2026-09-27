# ADR 0003 — Defesa em profundidade para SQL somente leitura

**Status:** aceita · 2026-09-27

## Contexto

`queryDatabase` executa SQL escrito por um LLM. Validação por regex sozinha é contornável.

## Decisão

Quatro camadas independentes; qualquer uma sozinha já barra escrita:

1. **Validação estática** (`sql-guard.ts`): uma instrução; começa com SELECT/WITH; palavras-chave de
   escrita/DDL/controle proibidas (após mascarar literais e comentários); funções perigosas proibidas
   (`pg_sleep`, `pg_read_file`, `set_config`, `dblink`...); sem dollar-quoting. Recusa cedo e devolve
   ao agente uma mensagem útil.
2. **Role do Postgres `agent_readonly`**: só `SELECT` nas tabelas de e-commerce e nas views; nenhum acesso
   a `staff_users`, `chats`, `workflow_runs`, `agent_audit_log`. `default_transaction_read_only = on`.
3. **Transação `BEGIN READ ONLY`** + `SET LOCAL statement_timeout` (padrão 3s) + `ROLLBACK` sempre.
4. **Limite de linhas aplicado por fora**: `SELECT * FROM (<sql>) LIMIT n+1`, com `truncated`.

Tudo auditado com o `purpose` informado pelo agente.

## Consequências

- Testes provam as camadas separadamente, inclusive a role recusando `DELETE` sem passar pelo guard.
- A validação estática tem falsos positivos (ex.: coluna chamada `update`). Aceitável: o agente recebe o
  motivo e reescreve.
- Para agentes de cliente final: adicionar RLS por `customer_id` à role (próximo passo documentado).
