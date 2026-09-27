import {
  consumeStream,
  createAgentUIStreamResponse,
  createIdGenerator,
  validateUIMessages,
  type InferAgentUIMessage,
  type LanguageModel,
} from "ai";
import { z } from "zod";
import type { CapabilityContext } from "@/capabilities/capability";
import type { Principal } from "@/domain/auth/principal";
import { DomainError } from "@/domain/shared/errors";
import { chatRepository } from "@/infrastructure/db/repositories/chat-repository";
import { createCapabilityContext } from "./capability-context";
import { mergeIncomingMessage, pendingApprovals, titleFrom } from "./chat-memory";
import { COMMERCE_AGENT, createCommerceAgent, type CommerceAgent } from "./commerce-agent";

const bodySchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  message: z.unknown(),
});

const json = (status: number, error: string) => Response.json({ error }, { status });

export interface ChatHandlerOptions {
  model?: LanguageModel;
  context?: (principal: Principal, chatId: string) => CapabilityContext;
}

/**
 * POST /api/chat
 * 1. principal já autenticado pelo chamador
 * 2. carrega o histórico do chat (dono = principal) e incorpora a mensagem nova
 * 3. audita respostas de aprovação
 * 4. roda o commerceAgent em streaming e persiste o histórico ao final
 */
export async function handleChatRequest(principal: Principal, rawBody: unknown, opts: ChatHandlerOptions = {}) {
  const body = bodySchema.safeParse(rawBody);
  if (!body.success) return json(400, "Requisição inválida");
  const chatId = body.data.id;

  const ctx = opts.context?.(principal, chatId) ?? createCapabilityContext(principal, { channel: "agent", agent: COMMERCE_AGENT, chatId });
  const stored = await chatRepository.findById(ctx.app.db, chatId);
  // Chat de outro usuário: 404 (não revela que existe).
  if (stored && stored.ownerId !== principal.id) return json(404, "Chat não encontrado");

  let merged;
  try {
    merged = mergeIncomingMessage(stored?.messages ?? [], body.data.message);
  } catch (error) {
    if (error instanceof DomainError) return json(400, error.message);
    throw error;
  }

  for (const decision of merged.approvals) {
    await ctx.audit.record({
      actorId: principal.id,
      actorRole: principal.role,
      agent: COMMERCE_AGENT,
      channel: ctx.channel,
      chatId,
      capability: decision.toolName,
      event: decision.approved ? "approval_granted" : "approval_denied",
      status: decision.approved ? "ok" : "denied",
      input: decision.input,
      error: decision.reason,
      approvalId: decision.approvalId,
    });
  }

  const agent = createCommerceAgent(ctx, { model: opts.model });
  const messages = await validateUIMessages<InferAgentUIMessage<CommerceAgent>>({ messages: merged.messages, tools: agent.tools });
  // Persiste já a mensagem do usuário / a decisão de aprovação, mesmo que o stream falhe.
  await chatRepository.save(ctx.app.db, { id: chatId, ownerId: principal.id, title: titleFrom(messages), messages });

  return createAgentUIStreamResponse({
    agent,
    uiMessages: messages,
    originalMessages: messages,
    generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
    // Garante que onEnd rode (e o histórico seja salvo) mesmo se o cliente desconectar.
    consumeSseStream: consumeStream,
    // O modelo pode tentar chamar uma tool que o papel do usuário não tem (ela nem foi oferecida).
    // Nada executa — o AI SDK devolve erro ao modelo —, mas a tentativa fica registrada.
    onStepEnd: async (step) => {
      for (const part of step.content) {
        if (part.type !== "tool-error" || part.toolName in agent.tools) continue;
        await ctx.audit.record({
          actorId: principal.id,
          actorRole: principal.role,
          agent: COMMERCE_AGENT,
          channel: ctx.channel,
          chatId,
          capability: part.toolName,
          event: "capability_call",
          status: "forbidden",
          input: part.input,
          error: "TOOL_NOT_AVAILABLE: capability não disponível para o papel do usuário",
        });
      }
    },
    onError: (error) => {
      console.error("commerceAgent stream error", error);
      return "Não consegui concluir a resposta. Tente novamente.";
    },
    onEnd: async ({ messages: finalMessages, responseMessage }) => {
      await chatRepository.save(ctx.app.db, { id: chatId, ownerId: principal.id, title: titleFrom(finalMessages), messages: finalMessages });
      for (const pending of pendingApprovals(responseMessage)) {
        await ctx.audit.record({
          actorId: principal.id,
          actorRole: principal.role,
          agent: COMMERCE_AGENT,
          channel: ctx.channel,
          chatId,
          capability: pending.toolName,
          event: "approval_requested",
          status: "pending",
          input: pending.input,
          approvalId: pending.approvalId,
        });
      }
    },
  });
}
