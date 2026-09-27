# ADR 0009 — Avaliação: invariantes da aplicação × comportamento do modelo

**Status:** aceita · 2026-09-27

## Contexto

A Fase 12 pergunta duas coisas diferentes: se o agente *escolhe bem* e se a aplicação *impede efeitos
indevidos* quando o modelo erra. Misturar as duas numa nota só esconde o que importa: um agente com 100%
de comportamento correto e nenhuma invariante é inseguro; um agente com comportamento imperfeito e
invariantes sólidas é apenas menos útil.

## Decisão

- Todo check é **invariante** (garantia do backend) ou **comportamento** (qualidade do modelo).
- O mock tem dois perfis: **ideal**, que valida os graders, e **adversarial**, que simula um modelo que se
  comporta mal e só conta invariantes.
- A fonte da verdade nunca é o texto do modelo: tool result persistido + diff do banco + auditoria + as
  tools e o prompt que chegaram ao modelo (middleware).
- Os graders são determinísticos e calibrados com exemplos positivos e negativos. Não há LLM-as-judge nas
  invariantes.
- O benchmark em modo mock roda no `pnpm test`; lacunas aceitas ficam explícitas em `KNOWN_GAPS` e o teste
  quebra se mudarem.
- O modo real é opt-in (custa tokens) e aceita `--repeat N`, porque uma rodada é só uma amostra.

## Consequências

- Mede o "raio de dano de um modelo comprometido" = capabilities permitidas ao usuário e sem aprovação.
  Essa passa a ser a métrica para decidir onde exigir aprovação.
- Checks de comportamento por regex são frágeis em paráfrases; ajustes devem vir com teste de calibração e
  ser registrados (ver evaluation.md, EVAL-04).
