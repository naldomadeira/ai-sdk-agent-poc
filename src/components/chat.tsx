"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ToolPart } from "./tool-part";

const SCENARIOS = [
  "Quais são os 5 clientes que mais gastaram este mês?",
  "Quais pedidos existem hoje?",
  "Quais pedidos estão atrasados?",
  "Mostre os pedidos do João.",
  "Qual deles foi o mais caro?",
  "Cancele o pedido #123.",
  "Reembolse o pedido #123.",
  "Encontre pedidos atrasados e prepare notificações.",
];

export function Chat({ chatId, initialMessages }: { chatId: string; initialMessages: UIMessage[] }) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, addToolApprovalResponse, status, error, stop } = useChat({
    id: chatId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      // Só a última mensagem vai para o servidor: o histórico (memória) vive no banco.
      prepareSendMessagesRequest: ({ id, messages }) => ({ body: { id, message: messages.at(-1) } }),
    }),
    // Após Aprovar/Rejeitar, reenvia automaticamente para o agente continuar.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: () => {
      // Mantém a URL apontando para esta conversa e atualiza a lista lateral.
      if (!window.location.search.includes(chatId)) window.history.replaceState(null, "", `/?c=${chatId}`);
      router.refresh();
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const busy = status === "submitted" || status === "streaming";
  const submit = (text: string) => {
    if (!text.trim() || busy) return;
    sendMessage({ text });
    setInput("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-6">
              <p className="mb-3 text-sm text-muted">Cenários da POC:</p>
              <div className="flex flex-wrap gap-2">
                {SCENARIOS.map((s) => (
                  <button key={s} onClick={() => submit(s)} className="rounded-full border border-border bg-surface px-3 py-1 text-sm hover:border-accent">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex flex-col gap-2"}>
              {message.parts.map((part, i) => {
                if (part.type === "text") {
                  return message.role === "user" ? (
                    <p key={i} className="max-w-[80%] rounded-2xl bg-accent px-4 py-2 text-sm text-surface">
                      {part.text}
                    </p>
                  ) : (
                    <div key={i} className="prose-agent text-sm leading-relaxed">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
                    </div>
                  );
                }
                if (isToolUIPart(part)) {
                  return <ToolPart key={part.toolCallId} part={part} onApproval={addToolApprovalResponse} />;
                }
                return null;
              })}
            </div>
          ))}

          {status === "submitted" && <p className="text-sm text-muted">pensando…</p>}
          {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">Erro: {error.message}</p>}
          <div ref={bottomRef} />
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="border-t border-border bg-surface px-4 py-3"
      >
        <div className="mx-auto flex max-w-3xl gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pergunte sobre pedidos, clientes, pagamentos… ou peça uma ação"
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
          {busy ? (
            <button type="button" onClick={stop} className="rounded-md border border-border px-4 py-2 text-sm">
              Parar
            </button>
          ) : (
            <button type="submit" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-surface disabled:opacity-50" disabled={!input.trim()}>
              Enviar
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
