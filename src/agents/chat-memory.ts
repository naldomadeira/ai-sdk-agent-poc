import { isToolUIPart, getToolName, type UIMessage } from "ai";
import { z } from "zod";
import { invalidInput } from "@/domain/shared/errors";

/**
 * Memória de conversa = histórico persistido no servidor (tabela chats).
 *
 * O cliente envia só a mensagem nova. O servidor é a fonte da verdade do histórico:
 * - mensagem de usuário nova → anexada;
 * - mensagem de assistente → só é aceita para registrar respostas de aprovação em tool
 *   calls que o próprio servidor emitiu. Qualquer outro conteúdo vindo do cliente é ignorado,
 *   então o cliente não consegue forjar resultados de tools nem reescrever o histórico.
 */

export interface ApprovalDecision {
  approvalId: string;
  approved: boolean;
  reason?: string;
  toolName: string;
  toolCallId: string;
  input: unknown;
}

const incomingSchema = z.object({
  id: z.string().min(1).max(100),
  role: z.enum(["user", "assistant"]),
  parts: z.array(z.record(z.string(), z.unknown())).max(200),
});

export function mergeIncomingMessage(
  stored: UIMessage[],
  raw: unknown,
): { messages: UIMessage[]; approvals: ApprovalDecision[] } {
  const parsed = incomingSchema.safeParse(raw);
  if (!parsed.success) throw invalidInput("Mensagem inválida");
  const incoming = raw as UIMessage;

  if (incoming.role === "user") {
    if (stored.some((m) => m.id === incoming.id)) return { messages: stored, approvals: [] };
    // Da mensagem do usuário só aceitamos texto.
    const parts = incoming.parts.filter((p) => p.type === "text").map((p) => ({ type: "text" as const, text: String((p as { text: unknown }).text).slice(0, 8_000) }));
    if (!parts.length) throw invalidInput("Mensagem de usuário sem texto");
    // Seguir conversando sem responder a uma aprovação pendente = rejeição implícita.
    const approvals: ApprovalDecision[] = [];
    const resolved = stored.map((m) => {
      if (m.role !== "assistant") return m;
      return {
        ...m,
        parts: m.parts.map((part) => {
          if (!isToolUIPart(part) || part.state !== "approval-requested") return part;
          const reason = "Usuário continuou a conversa sem aprovar";
          approvals.push({ approvalId: part.approval.id, approved: false, reason, toolName: getToolName(part), toolCallId: part.toolCallId, input: part.input });
          return { ...part, state: "approval-responded" as const, approval: { ...part.approval, approved: false, reason } };
        }),
      } as UIMessage;
    });
    return { messages: [...resolved, { id: incoming.id, role: "user", parts }], approvals };
  }

  const index = stored.findIndex((m) => m.id === incoming.id && m.role === "assistant");
  if (index === -1) throw invalidInput("Mensagem de assistente desconhecida");

  const approvals: ApprovalDecision[] = [];
  const target = stored[index];
  const parts = target.parts.map((part) => {
    if (!isToolUIPart(part) || part.state !== "approval-requested") return part;
    const answer = incoming.parts.find(
      (p) => isToolUIPart(p) && p.toolCallId === part.toolCallId && p.state === "approval-responded" && p.approval.id === part.approval.id,
    );
    if (!answer || !isToolUIPart(answer) || answer.state !== "approval-responded") return part;

    const approved = answer.approval.approved === true;
    const reason = typeof answer.approval.reason === "string" ? answer.approval.reason.slice(0, 500) : undefined;
    approvals.push({ approvalId: part.approval.id, approved, reason, toolName: getToolName(part), toolCallId: part.toolCallId, input: part.input });
    return { ...part, state: "approval-responded" as const, approval: { ...part.approval, approved, reason } };
  });

  const messages = [...stored];
  messages[index] = { ...target, parts } as UIMessage;
  return { messages, approvals };
}

/** Pedidos de aprovação emitidos numa resposta (para auditoria). */
export function pendingApprovals(message: UIMessage) {
  return message.parts.filter(isToolUIPart).flatMap((part) =>
    part.state === "approval-requested"
      ? [{ approvalId: part.approval.id, toolName: getToolName(part), toolCallId: part.toolCallId, input: part.input }]
      : [],
  );
}

export function titleFrom(messages: UIMessage[]): string | null {
  const first = messages.find((m) => m.role === "user")?.parts.find((p) => p.type === "text");
  return first && "text" in first ? first.text.slice(0, 80) : null;
}
