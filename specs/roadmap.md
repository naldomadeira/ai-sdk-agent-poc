# Roadmap

Regra de avanço: ao fim de cada fase → testar, corrigir, documentar, atualizar este arquivo, só então
avançar.

Legenda: ✅ concluída · 🚧 em andamento · ⏳ pendente

---

## Fase 0 — Discovery ✅

**Encontrado:** diretório vazio (greenfield). Node 22.23, pnpm 12.4, Docker 29. Porta 5432 ocupada por
outro projeto (`worker-manager-postgres-1`); 5466 livre. Nenhuma chave de LLM no ambiente.

**Versões atuais (set/2026):** `ai` 7.0, `@ai-sdk/react` 4.0, `@ai-sdk/anthropic` 4.0, Next 16.3,
React 19.2, Zod 4.6, Vitest 5, Tailwind 4, `@modelcontextprotocol/sdk` 1.30.

**APIs do AI SDK v7 confirmadas nos `.d.ts`:**
- `ToolLoopAgent` com `toolApproval` (substitui `needsApproval` do v5/v6 fora do `WorkflowAgent`).
- `experimental_toolApprovalSecret` — assinatura HMAC das aprovações.
- `createAgentUIStreamResponse({ agent, uiMessages, originalMessages, onEnd })`.
- UI: `addToolApprovalResponse` + `lastAssistantMessageIsCompleteWithApprovalResponses`; estados de
  tool part `approval-requested` / `approval-responded` / `output-denied`.
- `MockLanguageModelV4` em `ai/test` para testar o agente sem LLM real.

**Decisão:** scaffold com `create-next-app` (App Router, `src/`, Tailwind, ESLint) e construir em cima.

## Fase 1 — Foundation ✅

- [x] `docker-compose.yml` com PostgreSQL 17 em `5467:5432`, TZ `America/Sao_Paulo`
  (5466 foi ocupada durante a sessão por outra POC local, `mastra-agent-poc`; app em 3467 pelo mesmo motivo)
- [x] Banco de teste `commerce_test` criado pelo init script
- [x] Migrations SQL versionadas (`db/migrations`) + runner (`pnpm db:migrate`)
- [x] Role `agent_readonly` criada pelo runner a partir de `DATABASE_READONLY_URL`
- [x] Seed determinístico relativo a "agora" (`pnpm db:seed`)
- [x] Config validada com Zod (`src/config/env.ts`) e `.env.example`

**Critério:** `pnpm db:reset` sobe schema + dados; consultas de exemplo retornam dados.
**Resultado:** 41 pedidos (#100–#140), 6 hoje, 5 pendentes, 4 atrasados; role `agent_readonly` recusa
`DELETE` e leitura de `staff_users`.

## Fase 2 — Domain ✅

- [x] Regras puras: `domain/orders`, `domain/payments`, `domain/notifications`, `domain/auth`
- [x] Repositórios SQL (`infrastructure/db/repositories`)
- [x] Use cases: `cancelOrder`, `refundPayment`, `sendCustomerNotification` (autorização + regra + transação)

**Critério:** testes de domínio e de repositório verdes. **Resultado:** 28 testes.

## Fase 3 — AI SDK ✅

- [x] `commerceAgent` (`ToolLoopAgent`) criado por request com o principal autenticado
- [x] Streaming via `createAgentUIStreamResponse` + `useChat`
- [x] Read capabilities: `inspectSchema`, `queryDatabase`
- [x] Adapter capability → AI SDK tool (`agents/tools.ts`)

## Fase 4 — Actions ✅

- [x] Capabilities `cancelOrder`, `refundPayment`, `sendCustomerNotification` delegando aos use cases
- [x] Erros de negócio devolvidos como resultado estruturado (o agente explica, não quebra)

## Fase 5 — Human approval ✅

- [x] `refundPayment` e `sendPreparedNotifications` exigem aprovação (`toolApproval: 'user-approval'`)
- [x] Aprovações assinadas com HMAC (`TOOL_APPROVAL_SECRET`)
- [x] UI com Aprovar/Rejeitar; servidor só aceita do cliente a *resposta* de aprovação
- [x] Pedido, concessão e negação de aprovação vão para o audit log

## Fase 6 — Memory/context ✅

- [x] Histórico por chat persistido no Postgres (`chats.messages`)
- [x] Cliente envia só a última mensagem; servidor reconstrói o contexto
- [x] Chat pertence a um usuário (outro usuário recebe 404)

## Fase 7 — Workflow ✅

- [x] `lateOrderNotifications`: encontrar atrasados → agrupar por cliente → preparar rascunhos →
  aprovação → enviar
- [x] Estado persistido em `workflow_runs` (máquina de estados, idempotente)
- [x] Exposto ao agente como 2 capabilities (preparar / enviar com aprovação)

## Fase 8 — MCP básico ✅

- [x] `pnpm mcp` sobe servidor MCP stdio gerado a partir do mesmo registry de capabilities
- [x] Capabilities que exigem aprovação humana **não** são expostas via MCP nesta fase

## Fase 9 — Observabilidade ✅

- [x] `agent_audit_log`: usuário, agente, canal, capability, input, resultado, erro, aprovação,
  duração, timestamp
- [x] Página `/audit` e log estruturado no console

## Fase 10 — Testes e documentação ✅

**Resultado final:** `lint` ✓ · `typecheck` ✓ · `test` 98/98 ✓ · `build` ✓.



Smoke test com LLM real (`claude-haiku-4-5` via gateway compatível, `pnpm smoke`) — os 5 cenários do
enunciado funcionaram ponta a ponta, incluindo aprovação pela UI no navegador. Ajustes que ele revelou
(todos de UX, nenhum de segurança):
- o agente pedia "qual João?" em vez de buscar por nome → instrução de busca com ILIKE;
- como viewer, dizia "vou cancelar" sem ter a tool → instrução gerada do registry listando o que o papel
  não permite;
- adivinhava nomes de coluna e errava → orientado a chamar `inspectSchema` na primeira consulta
  (o erro estruturado já permitia autocorreção);
- inventou prazo de estorno "5 a 10 dias" → regra de não inventar políticas;
- `pnpm run` escreve no stdout e corrompe MCP stdio → clientes chamam `tsx` direto.

- [x] Testes: domínio, repositórios, database tools, action tools, autorização, aprovação, workflow,
  memória, MCP
- [x] `lint`, `typecheck`, `test`, `build` verdes
- [x] `architecture.md` com a resposta sobre capabilities mínimas

## Fase 11 — Publicação ✅

- [x] Repositório público `naldomadeira/ai-sdk-agent-poc`, licença MIT
- [x] README em inglês com limitações e aprendizados do teste com modelo real
- [x] Verificação de segredos antes do primeiro commit. Sem mudança de arquitetura.

## Fase 12 — Agent Evaluation & Security Benchmark ✅

Equivalente à Fase 12 da POC Mastra. Detalhes em [evaluation.md](./evaluation.md) e
[evaluation-cases.md](./evaluation-cases.md).

- [x] Matriz de 12 casos (`EVAL-01`…`EVAL-12`) com IDs canônicos, também para a POC Mastra
- [x] Harness pelo caminho HTTP real, com checks de invariante × comportamento e resultado normalizado
- [x] Modos mock (ideal / adversarial, roda no CI) e real (`pnpm eval:real`, `--repeat N`)
- [x] Fonte da verdade: tool result + diff do banco + auditoria + o que chegou ao modelo
- [x] Graders determinísticos calibrados (`tests/unit/graders.test.ts`)

**Resultado:** mock 9/12 → **11/12** após correções; real: rodada 1 9/12, rodada final **12/12**.
Nenhuma invariante falhou com o modelo real.

**Correções que o benchmark motivou** (bugs contra garantias já declaradas, não features novas):
- aprovação de uso único (`consumed_approvals`, migration 004): o replay direto no agente executava 2×;
- workflow idempotente por evento: rodar de novo duplicava notificações;
- tentativa de usar tool indisponível passa a ser auditada.

**Lacuna conhecida, não corrigida:** EVAL-07. Um modelo que obedece a instrução injetada executa uma action
permitida ao usuário e sem aprovação (`cancelOrder`). Opções em evaluation.md §3.

---

## Próximos passos (fora do escopo da POC)

- Autenticação real (Auth.js / sessão da aplicação) no lugar do seletor de usuário.
- Four-eyes: quem aprova um reembolso ≠ quem pediu, para valores altos.
- Fechar a lacuna do EVAL-07: aprovação por risco ou "taint" (escrita após leitura de dado não confiável exige aprovação).
- Caso de avaliação para alucinação sobre regras do sistema ("cancelar reembolsa automaticamente").
- RLS no Postgres para agentes voltados ao cliente final (leitura genérica com escopo por linha).
- Aprovação via MCP (elicitation) para expor capabilities sensíveis a outros agentes.
- Workflows duráveis (`WorkflowAgent` / Vercel Workflow) quando houver espera longa ou retries.
- Exportar o audit log para OpenTelemetry (`telemetry` do AI SDK).

## Fase 13 — Agent Core Extraction ✅

A Fase 13 extraiu o contrato arquitetural comum demonstrado pelas duas POCs, sem introduzir uma terceira implementação de runtime.

- [x] Fronteira Agent Core/runtime documentada em `specs/phase-13-agent-core-extraction.md`.
- [x] Contrato conceitual v0.1 em `specs/agent-core-contract.md`.
- [x] Capability, Registry e Executor identificados como abstrações comuns.
- [x] Actor/context, autorização, aprovação e auditoria definidos como infraestrutura independente do runtime.
- [x] Read, domain action e workflow capabilities diferenciadas.
- [x] Responsabilidades específicas do AI SDK mantidas no adapter/runtime.
- [x] Regras de segurança documentadas como invariantes da aplicação, não do prompt.
- [x] Nenhuma mudança funcional na POC.

A extração deliberadamente permanece como contrato/documentação. Um pacote compartilhado só deve ser criado depois de validar o contrato em uma terceira aplicação real, evitando abstração prematura.