# ADR 0005 — Memória = histórico persistido no servidor

**Status:** aceita · 2026-09-27

## Contexto

"Meu nome é João / Quais são meus pedidos? / Qual deles foi o mais caro?" exige contexto entre turnos.
O padrão mais simples do AI SDK é o cliente reenviar todo o histórico, mas isso deixa o cliente
reescrever o passado (inclusive resultados de tools).

## Decisão

- Tabela `chats` (id, dono, `messages jsonb` de `UIMessage[]`), padrão de persistência do AI SDK.
- O cliente envia só a última mensagem (`prepareSendMessagesRequest`); o servidor carrega o histórico,
  incorpora a mensagem (`mergeIncomingMessage`) e persiste no `onEnd` do `createAgentUIStreamResponse`.
- O servidor é a fonte da verdade: do cliente só aceita (a) mensagem de usuário nova, com partes de texto,
  e (b) respostas de aprovação para tool calls pendentes que ele emitiu. Mensagens de assistente
  desconhecidas são rejeitadas.
- Chat de outro usuário → 404.
- Os resultados de tools ficam no histórico: "qual deles foi o mais caro" é respondido a partir da consulta
  anterior, sem nova query (verificado no smoke test com LLM real).

## Consequências

- Sem infraestrutura extra (vector store, serviço de memória). Suficiente para memória de conversa.
- Conversas longas crescem sem limite: próximo passo é `pruneMessages`/compactação no `prepareStep`.
- Memória de longo prazo (preferências entre conversas) fica fora do escopo.
