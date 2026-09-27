# Fase 13 — Agent Core Extraction

## Objetivo

Extrair, a partir das duas POCs, o contrato arquitetural que é independente do runtime de agente.

A Fase 13 **não substitui Mastra nem AI SDK** e não tenta criar uma terceira implementação do agente.
Ela formaliza a fronteira que as duas POCs demonstraram ser reutilizável.

## Decisão arquitetural

A aplicação deve separar:

```text
Application
    |
    +-- Agent Core contract
    |      |
    |      +-- capabilities
    |      +-- registry
    |      +-- executor
    |      +-- actor/context
    |      +-- authorization
    |      +-- approval
    |      +-- audit
    |      +-- workflow boundary
    |
    +-- Agent runtime adapter
           +-- Mastra
           +-- AI SDK
           +-- future runtimes
```

O runtime escolhe **como o agente raciocina e chama capabilities**.
O Agent Core define **o que a aplicação permite fazer e como isso é garantido**.

## Componentes candidatos ao Agent Core

### 1. Actor / Principal

Identidade autenticada fornecida pelo servidor.

Nunca deve ser confiada a partir do prompt ou de parâmetros enviados pelo modelo.

### 2. Capability

Contrato mínimo para uma capacidade da aplicação:

- nome estável;
- descrição para o agente;
- schema de entrada;
- permissão necessária;
- política de aprovação;
- executor;
- metadados de risco/canal quando aplicável.

Uma capability não deve conter regra de negócio duplicada.

### 3. Capability Registry

Fonte única das capabilities disponíveis.

O registry deve permitir:

- descoberta;
- filtragem por principal;
- adaptação para runtimes de agente;
- exposição via MCP;
- auditoria consistente.

### 4. Capability Executor

Ponto único para a execução:

```text
validate
  -> authorize
  -> approval check
  -> execute use case
  -> audit
```

Nenhum adapter de runtime deve conseguir pular essa fronteira.

### 5. Approval

A aprovação é evidência de autorização, não uma instrução textual.

Deve ser:

- persistida;
- vinculada à capability;
- vinculada aos argumentos aprovados;
- single-use;
- verificável pelo domínio/aplicação;
- independente do estado interno de um runtime.

### 6. Audit

O texto produzido pelo LLM não é evidência de execução.

A fonte de verdade é:

- resultado da capability;
- alteração efetiva no banco;
- auditoria;
- aprovação persistida.

### 7. Context

O runtime pode transportar contexto de conversa, mas dados de segurança devem ser reconstruíveis pelo servidor.

O contexto mínimo relevante para o Agent Core é:

- actor/principal;
- canal;
- request/run identifiers;
- tenant, quando existir;
- correlation id;
- informações de autorização necessárias.

## Tipos de capability

### Read capability

Pode ser genérica quando o efeito é somente leitura e o banco garante o isolamento.

Exemplo:

- `inspectSchema`
- `queryDatabase`

### Domain capability

Representa uma intenção de negócio que altera estado ou produz efeito externo.

Exemplo:

- `cancelOrder`
- `refundPayment`
- `sendCustomerNotification`

A capability chama um use case; não implementa regras de negócio próprias.

### Workflow capability

Inicia ou retoma um processo determinístico de várias etapas.

O LLM decide quando delegar para o workflow, mas não deve improvisar suas etapas internas.

## Runtime adapters

### Mastra adapter

Responsável por:

- transformar capabilities em Mastra tools;
- integrar memory;
- executar/suspender workflows;
- transportar contexto;
- converter resultados para o protocolo do Mastra.

### AI SDK adapter

Responsável por:

- transformar capabilities em AI SDK tools;
- integrar `ToolLoopAgent`;
- transportar approvals;
- streaming/UI;
- converter resultados para o protocolo do AI SDK.

Nenhum desses adapters deve reimplementar autorização, aprovação, auditoria ou regra de domínio.

## Regras de segurança

1. O LLM pode propor uma capability; a aplicação decide se pode executar.
2. O actor vem da sessão/servidor, nunca do modelo.
3. Toda escrita passa por uma capability semântica.
4. Nunca expor uma capability genérica de escrita.
5. Read-only SQL deve ser garantido pelo banco, com guards como defesa adicional.
6. Aprovações devem sobreviver a restart/resume do runtime.
7. Aprovação deve ser vinculada aos argumentos exatos.
8. Aprovação deve ser consumida uma única vez.
9. Auditoria deve registrar tentativas permitidas e negadas.
10. O resultado do LLM nunca prova que uma ação ocorreu.

## O que permanece fora do Agent Core

Não extrair nesta fase:

- UI/chat;
- Next.js;
- Mastra;
- AI SDK;
- implementação específica de memory;
- implementação específica de streaming;
- Postgres;
- ORM;
- regras de negócio;
- autenticação concreta;
- provedor de LLM.

## Estado da extração

A Fase 13 é uma **extração de contrato**, não uma publicação imediata de um pacote npm.

O objetivo é evitar abstrair prematuramente. As duas POCs continuam como referências executáveis e os adapters
permanecem concretos até existir uma terceira aplicação real que justifique a biblioteca.

## Critérios de conclusão

- [x] Fronteira Agent Core/runtime documentada.
- [x] Capability, Registry e Executor identificados como abstrações comuns.
- [x] Actor/context, authorization, approval e audit identificados como infraestrutura comum.
- [x] Read/domain/workflow capabilities diferenciadas.
- [x] Responsabilidades de Mastra e AI SDK isoladas.
- [x] Regras de segurança independentes de prompt/runtime documentadas.
- [x] Nenhuma mudança funcional necessária nas POCs.
