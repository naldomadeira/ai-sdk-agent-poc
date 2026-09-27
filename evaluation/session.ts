import { getToolName, isToolUIPart, wrapLanguageModel, type LanguageModel, type UIMessage } from "ai";
import { handleChatRequest } from "@/agents/chat-handler";
import { commerceModel } from "@/agents/model";
import type { CapabilityContext } from "@/capabilities/capability";
import type { Principal } from "@/domain/auth/principal";
import { readonlyPool, type Database } from "@/infrastructure/db/pool";
import { chatRepository } from "@/infrastructure/db/repositories/chat-repository";
import { createAuditLogger } from "@/observability/audit-log";
import { scriptedModel, type ScriptedTurn } from "./scripted-model";
import type { EvalMode, ToolCallRecord } from "./types";
import { readChatResponse } from "./ui-stream";

type ToolPart = Extract<UIMessage["parts"][number], { toolCallId: string }> & {
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: { id: string; approved?: boolean };
};

/** O que efetivamente chegou ao modelo em cada chamada (prova de contexto e de tools oferecidas). */
export interface ModelCall {
  tools: string[];
  prompt: string;
}

export interface SessionDeps {
  mode: EvalMode;
  db: Database;
  now: Date;
  principal: Principal;
  chatId: string;
}

/**
 * Uma conversa de avaliação. Passa pelo mesmo caminho da rota HTTP (`handleChatRequest`):
 * memória no servidor, merge seguro, aprovação, persistência e auditoria.
 */
export class EvalSession {
  readonly modelCalls: ModelCall[] = [];
  private turn = 0;
  last: UIMessage | undefined;

  constructor(private readonly deps: SessionDeps) {}

  get chatId() {
    return this.deps.chatId;
  }

  private model(script: ScriptedTurn[]): LanguageModel {
    const base = this.deps.mode === "mock" ? scriptedModel(script) : commerceModel();
    return wrapLanguageModel({
      model: base as Parameters<typeof wrapLanguageModel>[0]["model"],
      middleware: {
        transformParams: async ({ params }) => {
          this.modelCalls.push({
            tools: (params.tools ?? []).map((t) => t.name),
            prompt: JSON.stringify(params.prompt),
          });
          return params;
        },
      },
    });
  }

  private context = (principal: Principal, chatId: string): CapabilityContext => ({
    app: { db: this.deps.db, now: () => this.deps.now },
    readonlyPool: readonlyPool(),
    principal,
    audit: createAuditLogger(this.deps.db, { console: false }),
    channel: "agent",
    agent: "commerceAgent",
    chatId,
  });

  /** Envia uma mensagem de usuário. `script` só é usado no modo mock. */
  async say(text: string, script: ScriptedTurn[] = []) {
    this.turn++;
    const message = { id: `u-${this.deps.chatId}-${this.turn}`, role: "user", parts: [{ type: "text", text }] };
    return this.send(message, script);
  }

  /** Mensagem pendente de aprovação na última resposta, se houver. */
  pendingApproval(): ToolPart | undefined {
    return this.last?.parts.find((p) => isToolUIPart(p) && p.state === "approval-requested") as ToolPart | undefined;
  }

  /**
   * Responde ao pedido de aprovação como o useChat faria.
   * `edit` permite simular um cliente malicioso alterando a parte antes de enviar.
   */
  async answerApproval(approved: boolean, script: ScriptedTurn[] = [], opts: { edit?: (part: ToolPart) => ToolPart; chatId?: string } = {}) {
    if (!this.pendingApproval() || !this.last) throw new Error("nenhuma aprovação pendente");
    // Como a UI: responde a TODOS os pedidos pendentes da mensagem antes de reenviar.
    const parts = this.last.parts.map((p) => {
      if (!isToolUIPart(p) || p.state !== "approval-requested") return p;
      const pending = p as ToolPart;
      const answered = {
        ...pending,
        state: "approval-responded",
        approval: { ...pending.approval!, approved, ...(approved ? {} : { reason: "Rejeitado pelo usuário" }) },
      } as unknown as ToolPart;
      return opts.edit ? opts.edit(answered) : answered;
    });
    const message = { ...this.last, parts };
    return this.send(message, script, { continues: message as UIMessage, chatId: opts.chatId });
  }

  /** Reenvia uma mensagem arbitrária (ex.: replay de uma aprovação já consumida). */
  async resend(message: unknown, script: ScriptedTurn[] = [], chatId?: string) {
    return this.send(message, script, { continues: message as UIMessage, chatId });
  }

  private async send(message: unknown, script: ScriptedTurn[], opts: { continues?: UIMessage; chatId?: string } = {}) {
    const chatId = opts.chatId ?? this.deps.chatId;
    let response: Response;
    try {
      response = await handleChatRequest(this.deps.principal, { id: chatId, message }, { model: this.model(script), context: this.context });
    } catch (error) {
      return { status: 500, error: (error as Error).message, message: undefined };
    }
    if (response.status !== 200) {
      return { status: response.status, error: await response.text(), message: undefined };
    }
    let streamError: string | undefined;
    let reply: UIMessage | undefined;
    try {
      reply = await readChatResponse(response, opts.continues);
    } catch (error) {
      streamError = (error as Error).message;
    }
    // onEnd (persistência + auditoria de pedidos de aprovação) roda após o fim do stream.
    await new Promise((r) => setTimeout(r, 30));
    if (reply && chatId === this.deps.chatId) this.last = reply;
    const errorPart = reply?.parts.find((p) => p.type === "text" && /Não consegui concluir/.test(p.text));
    return { status: 200, error: streamError ?? (errorPart ? "stream-error" : undefined), message: reply };
  }

  /** Histórico persistido (fonte da verdade) desta conversa. */
  async history(): Promise<UIMessage[]> {
    return (await chatRepository.findById(this.deps.db, this.deps.chatId))?.messages ?? [];
  }

  /** Tool calls do histórico persistido, por turno de usuário. */
  async toolCalls(): Promise<ToolCallRecord[]> {
    const records: ToolCallRecord[] = [];
    let turn = 0;
    for (const message of await this.history()) {
      if (message.role === "user") turn++;
      for (const part of message.parts) {
        if (!isToolUIPart(part)) continue;
        const p = part as ToolPart;
        const output = p.output as { ok?: boolean; error?: { code: string; message: string } } | undefined;
        records.push({
          turn,
          name: getToolName(part),
          input: p.input,
          outcome:
            p.state === "output-available"
              ? output?.ok === false ? "error" : "ok"
              : p.state === "output-denied" ? "denied"
              : p.state === "output-error" ? (/unavailable|No such tool|NoSuchTool/i.test(p.errorText ?? "") ? "unavailable" : "error")
              : p.state === "approval-requested" ? "approval-requested"
              : p.state === "approval-responded" ? "approval-responded"
              : "pending",
          error: output?.ok === false ? `${output.error?.code}: ${output.error?.message}` : p.errorText,
        });
      }
    }
    return records;
  }

  /** Texto do assistente por turno de usuário (turno 1 = resposta à 1ª mensagem). */
  async answers(): Promise<string[]> {
    const out: string[] = [];
    for (const message of await this.history()) {
      if (message.role === "user") out.push("");
      else if (out.length) {
        out[out.length - 1] += message.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n");
      }
    }
    return out;
  }
}
