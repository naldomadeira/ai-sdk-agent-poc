# Agent Core Contract v0.1

Este documento é o contrato conceitual comum às POCs Mastra e AI SDK.

## Core flow

```text
Agent Runtime
     |
     v
Capability Adapter
     |
     v
Capability Registry
     |
     v
Capability Executor
     |
     +--> validate
     +--> authorize
     +--> approval
     +--> use case
     +--> audit
     |
     v
Domain / Infrastructure
```

## Capability contract

Uma capability deve representar uma intenção da aplicação, não um método de repository.

Conceitualmente:

```ts
type Capability = {
  name: string
  description: string
  inputSchema: unknown
  permission?: string
  approval?: "none" | "user"
  kind: "read" | "action" | "workflow"
  execute: (input: unknown, context: CapabilityContext) => Promise<unknown>
}
```

O tipo acima é deliberadamente conceitual nesta fase; a implementação concreta continua em cada POC.

## CapabilityContext

```ts
type CapabilityContext = {
  actor: Actor
  channel: "agent" | "mcp" | "workflow" | "http"
  requestId: string
  runId?: string
  toolCallId?: string
}
```

O actor deve ser resolvido pelo servidor.

## Executor invariant

Nenhum runtime deve executar diretamente um use case sensível.

O caminho esperado é:

```text
runtime -> adapter -> executor -> use case -> repository
```

Isso garante uma única fronteira para:

- validação;
- autorização;
- aprovação;
- auditoria.

## Approval invariant

Uma aprovação válida deve corresponder a:

```text
actor + capability + exact arguments + approval id + unused state
```

A aprovação deve ser consumida atomicamente.

O runtime pode ter sua própria assinatura ou mecanismo de suspensão, mas isso não substitui a evidência persistida quando a ação é sensível.

## Read invariant

Uma capability de consulta genérica somente é aceitável quando:

- a conexão utilizada é read-only;
- a transação é read-only;
- existe timeout;
- existe limite de resultado;
- tabelas/colunas sensíveis estão protegidas;
- SQL destrutivo não pode produzir efeito.

O guard de SQL é defesa adicional; não deve ser a única garantia.

## Write invariant

Não existe:

```text
updateDatabase
executeSQL
deleteRecord
crudTool
```

para o agente.

Existe:

```text
cancelOrder
refundPayment
sendCustomerNotification
```

porque regras de negócio permanecem no domínio.

## Workflow invariant

O workflow deve possuir etapas determinísticas.

O agente pode:

```text
decidir -> iniciar -> explicar
```

mas não:

```text
inventar as etapas -> executar efeitos em lote
```

## Runtime neutrality

Mastra e AI SDK são adapters.

A camada de negócio não deve importar:

- Mastra;
- AI SDK;
- componentes de chat;
- APIs específicas do modelo.

Isso permite trocar o runtime sem mover as regras de segurança para prompts ou tools específicas.

## Próxima validação

Antes de transformar este contrato em pacote reutilizável, aplicar o mesmo contrato a uma terceira aplicação ou integração real.
