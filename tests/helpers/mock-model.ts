import { MockLanguageModelV4, simulateReadableStream } from "ai/test";

/**
 * Modelo roteirizado: cada chamada ao LLM consome o próximo "turno".
 * Permite testar o loop do agente (tools, aprovação, memória) sem LLM real.
 */
export type ScriptedTurn =
  | { text: string }
  | { toolCalls: { toolName: string; input: Record<string, unknown> }[] };

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

let callSeq = 0;

function toolCalls(turn: Extract<ScriptedTurn, { toolCalls: unknown }>) {
  return turn.toolCalls.map((c) => ({
    type: "tool-call" as const,
    toolCallId: `call_${++callSeq}`,
    toolName: c.toolName,
    input: JSON.stringify(c.input),
  }));
}

function content(turn: ScriptedTurn) {
  return "text" in turn ? [{ type: "text" as const, text: turn.text }] : toolCalls(turn);
}

const finishReason = (turn: ScriptedTurn) => ({ unified: "text" in turn ? ("stop" as const) : ("tool-calls" as const), raw: undefined });

export function scriptedModel(turns: ScriptedTurn[]) {
  let i = 0;
  const next = () => {
    const turn = turns[i++];
    if (!turn) throw new Error(`scriptedModel: sem turno #${i}`);
    return turn;
  };

  return new MockLanguageModelV4({
    doGenerate: async () => {
      const turn = next();
      return { content: content(turn), finishReason: finishReason(turn), usage, warnings: [] };
    },
    doStream: async () => {
      const turn = next();
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

/** Texto de todas as mensagens enviadas ao modelo numa chamada (para checar memória). */
export function promptText(prompt: unknown): string {
  return JSON.stringify(prompt);
}
