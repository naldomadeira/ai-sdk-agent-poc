# ADR 0001 — Camada de capabilities independente de transporte

**Status:** aceita · 2026-09-27

## Contexto

O agente precisa de tools. Se cada tool do AI SDK carregar lógica própria (validação, permissão, log),
essa lógica se repete — e se perde quando o mesmo recurso for exposto por MCP ou chamado por outro agente.

## Decisão

Criar `src/capabilities/`: cada capability é um objeto com `name`, `description`, `kind`
(`read | action | workflow`), `permission`, `approval` (`none | required`), `inputSchema` (Zod) e
`execute(input, ctx)`. Todas passam por um único executor, `invokeCapability`, que valida input,
verifica permissão, exige evidência de aprovação e audita.

Transportes são adaptadores finos sobre o mesmo registry (`capabilities/registry.ts`):
- `agents/ai-sdk-tools.ts` → tools do AI SDK + `toolApproval`
- `mcp/server.ts` → tools MCP

O agente só recebe as capabilities que o usuário autenticado pode usar (`capabilitiesFor`).

## Consequências

- Adicionar uma capability = 1 arquivo + 1 linha no registry; ela aparece em todos os canais com a mesma
  segurança e auditoria.
- A capability não tem regra de negócio: ela delega ao use case. Isso mantém a regra testável sem LLM.
- Custo: uma indireção a mais em relação a declarar `tool()` direto. Aceitável.
- Nomes de pasta diferem do exemplo do enunciado (`src/tools/...`): "tool" é um conceito do transporte;
  "capability" é o que a aplicação oferece.
