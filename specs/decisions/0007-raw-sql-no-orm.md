# ADR 0007 — `pg` + SQL puro em vez de ORM

**Status:** aceita · 2026-09-27

## Decisão

Migrations em `db/migrations/*.sql` com um runner mínimo (`src/infrastructure/db/migrate.ts`) e
repositórios com SQL parametrizado sobre `pg`.

## Motivo

- O agente já escreve SQL para leitura; manter o schema em SQL (com `COMMENT ON`, views, grants e role)
  deixa a "interface para o agente" visível num lugar só.
- Menos dependências numa base que deve ser copiada para outros projetos (Next ou NestJS).
- A POC não depende de nenhum recurso de ORM.

## Consequências

Num projeto que já usa Prisma/Drizzle/TypeORM, os repositórios trocam de implementação; capabilities,
use cases e o guard de SQL não mudam.
