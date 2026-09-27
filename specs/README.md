# Specs

Todo o planejamento desta POC vive aqui. O código segue estes documentos; quando divergirem, o
documento é atualizado junto com o código.

| Documento | Conteúdo |
| --- | --- |
| [roadmap.md](./roadmap.md) | Fases, status e critério de pronto de cada fase |
| [architecture.md](./architecture.md) | Camadas, fluxos, segurança e a resposta à pergunta central da POC |
| [decisions/](./decisions/) | ADRs — decisões arquiteturais e seus trade-offs |

## Pergunta central

> Como permitir que um agente opere uma aplicação sem criar uma tool para cada método do banco?

Resposta curta (detalhada em `architecture.md`): **leitura genérica e controlada** (`inspectSchema` +
`queryDatabase`) para perguntas, **capabilities semânticas de negócio** para escrita, e **workflows**
para processos determinísticos. Toda autorização e regra de negócio fica na aplicação, nunca no prompt.

## ADRs

| # | Decisão |
| --- | --- |
| [0001](./decisions/0001-capability-layer.md) | Camada de capabilities independente de transporte (AI SDK / MCP) |
| [0002](./decisions/0002-generic-read-specific-write.md) | Leitura genérica via SQL controlado, escrita via domain actions |
| [0003](./decisions/0003-sql-read-only-defense-in-depth.md) | Defesa em profundidade para SQL somente leitura |
| [0004](./decisions/0004-human-approval.md) | Aprovação humana com `toolApproval` do AI SDK v7 + HMAC |
| [0005](./decisions/0005-memory-server-side-history.md) | Memória = histórico persistido no servidor, servidor como fonte da verdade |
| [0006](./decisions/0006-deterministic-workflows.md) | Workflows determinísticos com estado persistido, fora do loop do LLM |
| [0007](./decisions/0007-raw-sql-no-orm.md) | `pg` + SQL puro em vez de ORM |
| [0008](./decisions/0008-authentication-stub.md) | Autenticação simulada, autorização real |
