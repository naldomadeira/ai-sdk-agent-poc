# Fase 14 — Agent Core Contract Conformance

> **Status: ⏸️ PAUSADA.** A fase foi iniciada (análise e proposta), mas **nenhuma implementação foi feita**.
> A implementação fica para uma continuação futura.

## Objetivo

Transformar o Agent Core Contract (v0.1, conceitual, criado na Fase 13) em **propriedades verificáveis**:

1. definir claramente o contrato (proposta de v0.2);
2. identificar suas propriedades verificáveis (IDs `CONF-*`);
3. criar uma suíte de conformidade compartilhada;
4. fechar as lacunas existentes;
5. garantir que Mastra e AI SDK provem as mesmas invariantes;
6. só depois validar o contrato numa terceira aplicação real.

**Não objetivos:** pacote npm, framework, resolver o EVAL-07, four-eyes, auth real, OpenTelemetry, criar a
terceira aplicação, tornar Mastra ou AI SDK parte do Core.

## Estado atual da análise

- A roadmap não definia uma Fase 14; ela foi criada como fase intermediária de conformidade, antes da
  terceira aplicação.
- Foi feita a comparação da implementação atual com o contrato v0.1 e com a POC Mastra.
- Foi redigida uma proposta (contrato v0.2, matriz de conformidade `CONF-EXEC/AUTH/READ/WRITE/APPR/AUDIT/WF/CONTENT/RUNTIME`,
  arquitetura de aprovação e de auditoria, testes adversariais, critérios de conclusão). A proposta **não foi
  aprovada** e não está registrada aqui em detalhe; deve ser revisada na retomada.
- Principal lacuna desta POC: parte da evidência de aprovação é fabricada pelo adapter do AI SDK, e o vínculo
  com os argumentos exatos existe só no HMAC do runtime. Nas duas POCs, o pedido de aprovação pendente vive no
  estado do runtime (`UIMessage` aqui; estado de execução no Mastra), não na persistência da aplicação.

## Divergências encontradas entre AI SDK e Mastra

| # | Tema | AI SDK | Mastra |
|---|---|---|---|
| C1 | Onde a aprovação é verificada | No executor, fora da transação do use case | No domínio, na mesma transação do efeito |
| C2 | Aprovação após falha na execução | Consumida antes: fica queimada | Consumo desfeito: fica reutilizável |
| C3 | O que é persistido | Só o consumo, sem argumentos | Só a decisão, com o input completo |
| C4 | Pedido pendente | Em `UIMessage` (runtime) | No estado de execução do Mastra (runtime) |
| C5 | Quem pode aprovar | Aprovador = solicitante; sem permissão própria | Permissão de aprovação separada |
| C6 | Quando a aprovação é exigida | Por capability + origem do conteúdo | Por canal |
| C7 | Auditoria de sucesso | Escrita separada após o commit (efeito sem auditoria é possível) | Atômica com o efeito |
| C8 | Id da aprovação | `toolCallId` do runtime | `tool_call_id` do runtime |
| C9 | Comparação de argumentos | Só via HMAC | JSON canônico com `localeCompare`; compara input da decisão com input validado |
| C10 | Canal HTTP | Não existe | Existe |
| C11 | Proveniência de conteúdo | Existe (ADR 0010) | Não existe |

## Decisões pendentes

| D | Decisão |
|---|---|
| D1 | Adotar o contrato v0.2 |
| D2 | Registro persistente de aprovações como fonte da verdade |
| D3 | Hash/forma canônica dos argumentos (pós-validação, ordenação estável) |
| D4 | TTL de aprovação ou não |
| D5 | Four-eyes fora do escopo (e se a permissão de aprovar entra) |
| D6 | ContentOrigin no Core (obrigatório, opcional ou aplicação) |
| D7 | ApprovedArtifact/Draft no Core ou não |
| D8 | correlationId no Core |
| D9 | AuditEvent/DeniedAttempt no Core |
| D10 | Estrutura física `src/agent-core/` com fronteira de lint |
| D11 | Onde a aprovação é verificada e consumida (executor com unit of work × domínio) |
| D12 | Semântica da aprovação após falha na execução |
| D13 | Permissão de aprovar separada da permissão de pedir |
| D14 | Id da aprovação do núcleo × id do runtime |
| D15 | Kit de conformidade: especificação comum × implementação compartilhada |

## Registros

- **Nenhuma implementação da Fase 14 foi feita:** nenhum código, migration, teste de conformidade, registro de
  aprovação, executor, canonicalização, adapter ou mudança de runtime.
- **EVAL-07 continua aberto.** Nada nesta fase o resolve; a proposta é tratá-lo numa fase posterior própria
  (intenção e política para dados não confiáveis).
- **Ainda não se deve criar o pacote npm** do Agent Core. Isso só deve ser avaliado depois de as duas POCs
  estarem conformes e de o contrato ser validado numa terceira aplicação real.
- A roadmap (`specs/roadmap.md`) não foi alterada; será atualizada quando a fase for retomada e concluída.
- **A implementação fica para uma continuação futura**, começando pela revisão e aprovação da proposta e das
  decisões D1–D15.
