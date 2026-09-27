# ADR 0010 — Autorização × risco do conteúdo; decisões já tomadas são finais

**Status:** aceita · 2026-09-27

## Contexto

Revisando a auditoria após a Fase 12, apareceram dois problemas.

1. **Conteúdo gerado pelo agente saiu sem revisão.** A Ana pediu "mande uma pesquisa de satisfação pros 3
   clientes que mais compram"; o agente escreveu o texto e chamou `sendCustomerNotification` três vezes, sem
   aprovação. Não houve violação: ela tinha permissão. Mas a mesma capability serve tanto para texto
   controlado pela aplicação quanto para texto livre do modelo, e só a permissão era avaliada.
2. **Execução de workflow reaproveitada sem contexto.** A idempotência da Fase 12 fez o Bruno receber a
   execução pendente preparada pela Ana, que ele aprovou sem saber de quem era. O chat da Ana continuou
   mostrando "Aprovar" para algo já enviado.

Uma primeira versão tornava toda notificação `approval: "required"`. Foi descartada: tratava igual um
template da aplicação e um texto inventado pelo modelo, e punia o caso seguro.

## Decisão

### 1. Autorização e risco do conteúdo são avaliados separadamente, no executor

- `approval` continua sendo a política da capability (autorização + risco da ação).
- Nova propriedade opcional `contentOrigin(input)`, derivada da **forma do input validado**:
  - `template` + dados estruturados → `application_template` (o texto é renderizado pela aplicação a
    partir do banco; o modelo só escolhe qual template e para quem);
  - `subject` + `body` livres → `agent_generated`.
- `requiresApproval(capability, input)` = `approval === "required"` **ou** `agent_generated`. É a regra
  única, usada pelo executor (`invokeCapability`) e pelo adaptador do AI SDK (`toolApproval` dinâmico).
  Se um adaptador errar, o executor falha fechado (`APPROVAL_REQUIRED`).
- O modelo **não consegue declarar** aprovação nem origem: o schema é estrito (campos como `approved`,
  `contentOrigin` ou `approval` são recusados), exige exatamente uma forma de conteúdo, e a evidência de
  aprovação só é criada pelo adaptador depois da resposta de aprovação assinada.
- Auditoria: cada chamada grava `content_origin` e `approval` (`not_required | approved | missing`);
  `customer_notifications` grava `content_origin` e `template_id`.
- Compatibilidade: a chamada antiga (`subject` + `body`) continua válida e agora é classificada como
  conteúdo do agente, portanto com aprovação. O workflow de atrasos grava `application_template`.
  Via MCP, a capability volta a ser exposta: template funciona, texto livre é bloqueado (não há canal de
  aprovação no MCP).

### 2. O backend é a autoridade sobre decisões já tomadas

- `prepareLateOrderNotifications` devolve `reusedExistingRun`, `preparedByCurrentUser`, `requestedBy`,
  `preparedAt` e um `notice` gerado **pela aplicação**. A UI mostra o `notice` direto do resultado da tool,
  sem depender do modelo repetir.
- Capabilities com aprovação podem declarar `pendingApprovalStatus(input)`. Ao carregar um chat (página e
  handler), pedidos pendentes cujo alvo já foi decidido são **reconciliados**: viram resultado
  `ALREADY_DECIDED` com quem decidiu, e a UI deixa de mostrar Aprovar/Rejeitar.
- Qualquer resposta de aprovação para algo que o servidor já considera decidido (aba desatualizada, replay,
  decisão de outra pessoa) recebe **HTTP 409 `ALREADY_DECIDED`**. O workflow também recusa com
  `ALREADY_DECIDED` (antes, `INVALID_STATE`). A idempotência e o uso único de aprovação (ADR 0004) seguem
  valendo por baixo.

## Consequências

- Envio por template continua imediato; texto livre do agente passa sempre por um humano que lê o texto
  exato (a assinatura HMAC garante que o texto executado é o aprovado).
- O raio de dano de um modelo manipulado diminui (e-mail com texto arbitrário), mas **não zera**: ações
  permitidas e sem aprovação, como `cancelOrder` ou um e-mail por template, ainda executam se o modelo for
  induzido. Ver evaluation.md, EVAL-07.
- Reaproveitar execução de outra pessoa continua permitido (quem tem a permissão decide); a decisão fica
  explícita para quem aprova e para a auditoria (`requested_by` × `approved_by`).
