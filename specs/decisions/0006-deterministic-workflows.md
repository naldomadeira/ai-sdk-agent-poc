# ADR 0006 — Workflows determinísticos fora do loop do LLM

**Status:** aceita · 2026-09-27

## Contexto

"Encontre pedidos atrasados e prepare notificações" é um processo: critérios fixos, várias etapas,
efeito colateral em lote, necessidade de aprovação e de não repetir envio.

## Decisão

- `src/workflows/late-order-notifications.ts`: função TypeScript comum com etapas explícitas
  (buscar → agrupar → preparar por template → persistir `awaiting_approval` → enviar).
- Estado em `workflow_runs` (máquina de estados). O envio só ocorre a partir de `awaiting_approval`,
  com `SELECT ... FOR UPDATE`: idempotente.
- Exposto ao agente como 2 capabilities: `prepareLateOrderNotifications` (sem efeito externo) e
  `sendPreparedNotifications` (aprovação humana).
- Regras de negócio por item (limite diário) pulam o cliente sem abortar o lote.

**Regra:** *Agent = decisão/raciocínio. Workflow = processo determinístico.*
Use workflow quando a sequência é conhecida, o resultado precisa ser reproduzível, há efeito em lote ou
é preciso retomar/auditar etapas. Use o agente para interpretar o pedido, escolher o que fazer e explicar.

## Consequências

- O texto das notificações não vem do LLM: previsível, revisável, testável.
- Sem engine de workflow durável. Quando houver esperas longas, retries ou agendamento, migrar para
  `WorkflowAgent`/Vercel Workflow mantendo as mesmas capabilities.

## Adendo — Fase 12 (2026-09-27)

A idempotência era **por execução** (a mesma `workflow_run` não envia duas vezes), mas não **por evento**:
rodar o workflow de novo criava outra execução e renotificava os mesmos atrasos (EVAL-11). Agora preparar
(a) devolve a execução `awaiting_approval` existente, em vez de criar outra, e (b) exclui pedidos cujo
cliente já foi notificado por uma execução concluída nas últimas 24h. A janela é uma escolha de produto
deliberadamente simples.
