import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

/**
 * Modelo roteirizado: cada chamada ao LLM consome o próximo "turno".
 * Serve para testar o loop do agente sem LLM real — inclusive simulando um modelo que
 * se comporta mal (chama tools que não deveria, mente sobre o resultado, obedece injeção).
 *
 * Um turno pode ser uma função que recebe o prompt serializado: útil quando o modelo
 * precisa "ler" algo do histórico (ex.: o runId devolvido por uma tool anterior).
 */
export type StaticTurn = { text: string } | { toolCalls: { toolName: string; input: Record<string, unknown> }[] };
export type ScriptedTurn = StaticTurn | ((prompt: string) => StaticTurn);

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

let callSeq = 0;

function toolCalls(turn: Extract<StaticTurn, { toolCalls: unknown }>) {
  return turn.toolCalls.map((c) => ({
    type: "tool-call" as const,
    toolCallId: `call_${++callSeq}`,
    toolName: c.toolName,
    input: JSON.stringify(c.input),
  }));
}

function content(turn: StaticTurn) {
  return "text" in turn ? [{ type: "text" as const, text: turn.text }] : toolCalls(turn);
}

const finishReason = (turn: StaticTurn) => ({ unified: "text" in turn ? ("stop" as const) : ("tool-calls" as const), raw: undefined });

export function scriptedModel(turns: ScriptedTurn[]) {
  let i = 0;
  const next = (prompt: unknown): StaticTurn => {
    const turn = turns[i++];
    if (!turn) throw new Error(`scriptedModel: sem turno #${i}`);
    return typeof turn === "function" ? turn(JSON.stringify(prompt)) : turn;
  };

  return new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      const turn = next(prompt);
      return { content: content(turn), finishReason: finishReason(turn), usage, warnings: [] };
    },
    doStream: async ({ prompt }) => {
      const turn = next(prompt);
      const parts =
        "text" in turn
          ? [
              { type: "text-start" as const, id: "t1" },
              { type: "text-delta" as const, id: "t1", delta: turn.text },
              { type: "text-end" as const, id: "t1" },
            ]
          : toolCalls(turn);
      return {
        stream: simulateReadableStream({
          chunks: [{ type: "stream-start" as const, warnings: [] }, ...parts, { type: "finish" as const, finishReason: finishReason(turn), usage }],
        }),
      };
    },
  });
}

/** Extrai o primeiro UUID que aparece no prompt (ex.: runId de um workflow). */
export function lastUuidIn(prompt: string): string {
  const all = prompt.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g);
  if (!all?.length) throw new Error("nenhum UUID no prompt");
  return all[all.length - 1];
}
