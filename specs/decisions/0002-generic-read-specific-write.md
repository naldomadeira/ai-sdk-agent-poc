# ADR 0002 — Leitura genérica via SQL controlado, escrita via domain actions

**Status:** aceita · 2026-09-27

## Contexto

Pergunta central da POC: como operar a aplicação sem uma tool por método de repositório?
Perguntas de leitura são abertas e combinatórias ("top 5 do mês", "quanto o João gastou", "atrasados
por cidade"). Escritas são poucas, têm regras e efeitos colaterais.

## Decisão

- **Leitura:** duas capabilities genéricas — `inspectSchema` (schema + documentação de negócio via
  `COMMENT ON`) e `queryDatabase` (um SELECT, somente leitura, com limites).
- **Definições de negócio em views** (`late_orders`, `customer_spending`), para o modelo não reinventar
  "atrasado" ou "gasto" a cada pergunta.
- **Escrita:** capabilities semânticas (`cancelOrder`, `refundPayment`, `sendCustomerNotification`),
  cada uma delegando a um use case. Nunca `updateOrder`/`updatePayment` genéricos.

## Consequências

- Leitura cobre perguntas não previstas sem código novo. Smoke test: o agente errou um nome de coluna,
  recebeu o erro estruturado, chamou `inspectSchema` e corrigiu sozinho.
- Qualidade da leitura depende de schema bem documentado: os `COMMENT ON` fazem parte da interface.
- Leitura genérica expõe tudo que a role pode ler: serve para usuários **internos**. Para agente voltado
  ao cliente final, ver ADR 0003 (RLS) ou capabilities de leitura específicas.
- Escritas continuam explícitas, revisáveis e testáveis.
