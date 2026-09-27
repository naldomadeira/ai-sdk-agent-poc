# Arquitetura

> **Princípio:** a IA decide **o quê** fazer; a aplicação decide **se** pode fazer.

## Visão geral

```text
                 Next.js / React  (useChat, cartões de aprovação, /audit)
                           │  POST /api/chat  { id, message }   ← só a mensagem nova
                           ▼
              ┌───────────────────────────┐
              │  chat-handler              │  principal (sessão) · histórico (chats) · merge seguro
              │  commerceAgent             │  ToolLoopAgent, criado por request
              │  (AI SDK v7)               │  toolApproval + HMAC
              └─────────────┬─────────────┘
                            │  tools = capabilitiesFor(principal)
      ┌─────────────────────┼──────────────────────────┐
      ▼                     ▼                          ▼
 Read capabilities    Domain capabilities        Workflow capabilities
 inspectSchema        cancelOrder                prepareLateOrderNotifications
 queryDatabase        refundPayment  (aprovação) sendPreparedNotifications (aprovação)
      │               sendCustomerNotification         │
      │                     │                          ▼
      │                     ▼                  workflows/late-order-notifications
      │               Use cases (application/)  (etapas fixas + workflow_runs)
      │               autorização + regras + transação  │
      │                     │                          │ usa os mesmos use cases
      ▼                     ▼                          ▼
 Postgres (role agent_readonly,        Repositórios (pg, SQL parametrizado)
 BEGIN READ ONLY, timeout, limit)                │
                    └──────────── PostgreSQL ────┘

 Todo caminho passa por invokeCapability → valida · autoriza · exige aprovação · audita (agent_audit_log)
 O mesmo registry é servido por MCP (src/mcp/server.ts) sem código novo.
```

## Camadas

| Camada | Pasta | Responsabilidade | Não faz |
| --- | --- | --- | --- |
| UI | `src/app`, `src/components` | Chat com streaming, aprovação, auditoria | Nenhuma regra |
| Agente | `src/agents` | Instruções, escolha de tools, memória, streaming | Autorização, regra de negócio |
| Capabilities | `src/capabilities` | Contrato para agentes: schema, permissão, aprovação, auditoria | Regra de negócio |
| Workflows | `src/workflows` | Processos determinísticos de várias etapas | Chamar o LLM |
| Aplicação | `src/application` | Use cases: autorização + orquestração + transação | Conhecer AI SDK/MCP |
| Domínio | `src/domain` | Regras puras (cancelável? reembolsável? limite?) | I/O |
| Infra | `src/infrastructure` | Pool, migrations, seed, repositórios | Regra |
| Observabilidade | `src/observability` | Audit log (Postgres + console JSON) | — |
| MCP | `src/mcp`, `scripts/mcp-server.ts` | Outro transporte para o mesmo registry | — |

Dependências apontam para dentro: `app → agents → capabilities → application → domain`. O domínio não
importa nada da IA; dá para plugar os use cases num controller NestJS sem mudança.

## Fluxos

### Leitura (ex.: "5 clientes que mais gastaram este mês")
1. Agente chama `inspectSchema` (tabelas/views legíveis pela role, com `COMMENT ON`).
2. Agente escreve um SELECT usando a view `customer_spending`.
3. `queryDatabase`: guard estático → role `agent_readonly` → `BEGIN READ ONLY` + `statement_timeout` →
   `LIMIT` externo → audit com `purpose`.
4. Erro de SQL volta como `{ ok: false, error }`; o agente corrige e tenta de novo.

### Ação (ex.: "Cancele o pedido #123")
`cancelOrder` → `invokeCapability` (schema, permissão, audit) → use case `cancelOrder` (permissão de novo,
`FOR UPDATE`, `assertCancellable`) → repositório. Regra violada → `{ ok: false, code: "INVALID_STATE" }` e
o agente explica.

### Ação com aprovação (ex.: "Reembolse o pedido #123")
1. Modelo chama `refundPayment` → AI SDK emite `tool-approval-request` assinado (HMAC) e **não executa**.
2. `onEnd` persiste a mensagem e audita `approval_requested`.
3. UI mostra o cartão (valor, pedido, motivo). Usuário aprova → `addToolApprovalResponse` → reenvio automático.
4. Servidor aceita só a resposta de aprovação daquela tool call, audita `approval_granted`/`denied`.
5. AI SDK verifica a assinatura e executa → `invokeCapability` com evidência de aprovação → use case
   (que ainda exige `payments:refund`).

### Workflow (ex.: "Encontre pedidos atrasados e prepare notificações")
`prepareLateOrderNotifications` (busca → agrupa → template → `workflow_runs.awaiting_approval`) →
agente mostra rascunhos → `sendPreparedNotifications` (aprovação) → envio via use case, idempotente.

## Agente × Workflow

| Use o **agente** quando… | Use um **workflow** quando… |
| --- | --- |
| o pedido é aberto e precisa de interpretação | a sequência de passos é conhecida |
| a resposta depende de explorar dados | o resultado precisa ser reproduzível e auditável por etapa |
| é uma ação única, escolhida em conversa | há efeito em lote (N clientes, N pedidos) |
| o valor está em explicar | é preciso pausar (aprovação), retomar e não repetir |

O agente **dispara e explica** workflows; não os executa passo a passo com o LLM.

## Segurança — onde cada garantia mora

| Garantia | Onde | Depende do prompt? |
| --- | --- | --- |
| Usuário autenticado | `app/session.ts` (servidor) | Não |
| Tools visíveis por papel | `capabilitiesFor` | Não |
| Permissão na execução | `invokeCapability` **e** use case | Não |
| Parâmetros válidos | Zod em cada capability | Não |
| Regras de negócio | `domain/*` via use case | Não |
| Somente leitura no SQL | guard + role + `READ ONLY` + timeout + limit | Não |
| Aprovação humana | `toolApproval` + HMAC + `invokeCapability` falha fechado | Não |
| Histórico íntegro | `mergeIncomingMessage` (servidor é a fonte) | Não |
| Segredos | `.env.local` (ignorado), validados em `config/env.ts` | Não |
| Auditoria | `invokeCapability` + handler de chat | Não |

O prompt só melhora a *experiência* (usar views, formatar R$, perguntar quando ambíguo, dizer o que o papel
não permite). Remover o prompt inteiro não abre nenhuma brecha.

## Observabilidade

`agent_audit_log` registra usuário, papel, agente, canal (`agent | mcp | workflow`), chat, capability,
evento (`capability_call | approval_requested | approval_granted | approval_denied`), status, input,
resultado (resumido se grande), erro, `approval_id`, duração e timestamp. Visível em `/audit` e emitido no
console como JSON (pronto para coletor de logs). Próximo passo: `telemetry` do AI SDK → OpenTelemetry para
tokens, latência por step e traces.

## MCP

`createMcpServer(capabilities, ctx)` registra as capabilities permitidas ao usuário de serviço
(`MCP_PRINCIPAL_ID`) com `readOnlyHint`/`destructiveHint`. Mesma validação, autorização e auditoria
(canal `mcp`). Capabilities com aprovação humana ficam de fora até existir um canal de aprovação para MCP
(elicitation ou fila de aprovações na UI).

---

## Quantas capabilities, no mínimo, para um agente operar uma aplicação de forma útil e segura?

### Resposta

**Duas de leitura + uma por decisão de negócio que muda estado.** Nada de CRUD.

```text
Leitura (fixo, não cresce com o domínio)
  1. inspectSchema    — o que existe e o que significa
  2. queryDatabase    — responder qualquer pergunta, somente leitura

Escrita (cresce com o negócio, não com as tabelas)
  3..n. uma capability por verbo de negócio: cancelOrder, refundPayment, sendCustomerNotification…

Processos (opcional, quando há lote/etapas/aprovação)
  workflow = preparar (sem efeito) + executar (com aprovação)
```

Nesta POC, **7 capabilities** cobrem os cinco cenários pedidos e perguntas que ninguém previu. O
equivalente "uma tool por método" teria dezenas (`getOrdersByCustomer`, `getOrdersToday`,
`getPendingOrders`, `getTopCustomers`, `getCustomerSpendThisMonth`, `getLateOrders`, `updateOrder`,
`updatePayment`…) e ainda não responderia "atrasados por cidade".

O que torna esse mínimo **seguro** não é o número, é o que fica **fora** das capabilities:
- leitura genérica só é aceitável porque o banco garante somente-leitura (role + transação), não o prompt;
- escrita é sempre semântica porque é onde moram as regras — um `updateOrder` genérico transferiria a regra
  de negócio para o modelo;
- toda capability passa por um executor único que valida, autoriza, pede aprovação e audita.

### Quando usar capability genérica × domain tool específica

| Critério | Genérica (`queryDatabase`) | Específica (domain tool) |
| --- | --- | --- |
| Efeito | Nenhum (leitura) | Muda estado ou tem efeito externo |
| Regras de negócio | Nenhuma além de "pode ler" | Pré-condições, invariantes, limites |
| Espaço de perguntas | Aberto, combinatório | Pequeno e nomeável (um verbo) |
| Custo de erro | Resposta errada, corrigível | Dinheiro, cliente, dado corrompido |
| Autorização | Por tabela/linha (GRANT/RLS) | Por ação e por entidade |
| Aprovação | Não | Quando irreversível ou financeiro |

Promova uma leitura genérica a **capability de leitura específica** quando:
1. **Dado sensível ou escopo por linha** — o agente atende o cliente final e só pode ver os próprios dados
   (ou use RLS na role, mantendo a genérica);
2. **Definição de negócio instável ou difícil** — métricas oficiais (receita, churn) que não podem variar
   com o SQL que o modelo escrever (ou crie uma view, como `late_orders`);
3. **Consulta cara ou crítica de performance** — precisa de índice/cache/paginação garantidos;
4. **Fonte não-SQL** — API externa, busca, estoque em outro serviço.

Nunca crie capability genérica de **escrita**. Toda escrita é um verbo de negócio, com use case, testes e,
se for irreversível ou financeira, aprovação humana.

### Checklist para adicionar uma capability

1. É leitura? Provavelmente já está coberta por `queryDatabase`. Se a definição for recorrente, crie uma
   **view** com `COMMENT ON` e conceda `SELECT` à `agent_readonly`.
2. É escrita? Escreva a regra em `domain/`, o use case em `application/` (com `assertCan`), teste sem LLM.
3. Crie a capability (schema Zod + `permission` + `approval`) delegando ao use case.
4. Registre em `capabilities/registry.ts` → aparece no agente web e no MCP, com auditoria.
