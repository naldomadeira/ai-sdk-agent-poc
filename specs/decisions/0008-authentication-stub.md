# ADR 0008 — Autenticação simulada, autorização real

**Status:** aceita · 2026-09-27

## Decisão

- Três usuários em `staff_users`: Ana (`manager`), Bruno (`support`), Carla (`viewer`). A UI troca o
  usuário via cookie httpOnly; o servidor carrega o principal do banco a cada request.
- Permissões por papel em `domain/auth/principal.ts`. Verificadas em três pontos: filtro de tools
  (`capabilitiesFor`), `invokeCapability` e o use case.
- O principal nunca é parâmetro de tool: o agente é criado por request com o principal preso ao contexto.

## Consequências

Trocar por autenticação real (Auth.js, SSO, guard do NestJS) muda só `app/session.ts`.
O MCP opera como um usuário de serviço (`MCP_PRINCIPAL_ID`).
