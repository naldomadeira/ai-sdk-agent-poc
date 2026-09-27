<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Projeto

Leia `specs/README.md` antes de mudar arquitetura; decisões estão em `specs/decisions/` (ADRs).

Invariantes — não quebre:
- Toda capability passa por `invokeCapability`; registre novas em `src/capabilities/registry.ts`.
- Capabilities não têm regra de negócio: delegam a um use case em `src/application/` (que chama `assertCan`).
- Escrita é sempre verbo de negócio. Nunca crie capability genérica de escrita (`updateOrder`...).
- `queryDatabase` usa só `readonlyPool()` (role `agent_readonly`). Tabelas da plataforma não recebem GRANT.
- O principal vem da sessão no servidor, nunca de parâmetro de tool.
- Testes não chamam LLM real: use `evaluation/scripted-model.ts`. Só `pnpm smoke` e `pnpm eval:real` usam LLM.
- Mudou capability, instrução do agente ou modelo? Rode `pnpm eval` e atualize `specs/evaluation.md` se o resultado mudar.
  Lacunas aceitas ficam em `KNOWN_GAPS` (`evaluation/cases.ts`).

Verificação: `pnpm check` (lint, typecheck, test, build). Banco: `pnpm db:up && pnpm db:reset` (porta 5467).
