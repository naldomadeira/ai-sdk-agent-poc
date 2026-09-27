# ADR 0004 — Aprovação humana com `toolApproval` do AI SDK v7 + HMAC

**Status:** aceita · 2026-09-27

## Contexto

`refundPayment` (e o envio em lote do workflow) não podem executar só porque o modelo decidiu.

## Decisão

- A capability declara `approval: "required"`. O adaptador converte em `toolApproval: { name: "user-approval" }`
  no `ToolLoopAgent` (API do v7; `needsApproval` ficou restrito ao `WorkflowAgent`).
- `experimental_toolApprovalSecret` (`TOOL_APPROVAL_SECRET`) assina cada pedido de aprovação com HMAC,
  amarrando tool, callId e input. Adulterar o input depois do pedido é rejeitado (testado).
- UI: `addToolApprovalResponse` + `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses`.
- O servidor aceita do cliente **apenas** a resposta de aprovação sobre uma tool call que ele mesmo emitiu
  (ADR 0005).
- `invokeCapability` recusa capability `required` sem evidência de aprovação: um canal novo que esqueça a
  aprovação falha fechado.
- Aprovar não substitui permissão: o use case ainda exige `payments:refund`.
- Pedido, concessão e negação vão para o audit log. Continuar a conversa ignorando o pedido = negação.

## Consequências

- Nesta POC quem pede e quem aprova é o mesmo usuário. Para valores altos, o próximo passo é four-eyes
  (aprovador ≠ solicitante, validado no use case).
- MCP não expõe capabilities com aprovação até existir um canal de aprovação humano (ADR 0001).
