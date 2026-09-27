import type { AppContext } from "@/application/context";
import { capabilities } from "@/capabilities/registry";
import { chatRepository, type StoredChat } from "@/infrastructure/db/repositories/chat-repository";
import { reconcilePendingApprovals, type PendingApprovalResolver } from "./chat-memory";

export function pendingApprovalResolver(app: AppContext): PendingApprovalResolver {
  return async (toolName, input) => {
    const capability = capabilities.find((c) => c.name === toolName);
    return capability?.pendingApprovalStatus ? capability.pendingApprovalStatus(input, app) : null;
  };
}

/** Reconcilia aprovações pendentes do chat com o estado real e persiste se algo mudou. */
export async function reconcileStoredChat(app: AppContext, chat: StoredChat): Promise<StoredChat> {
  const { messages, changed } = await reconcilePendingApprovals(chat.messages, pendingApprovalResolver(app));
  if (!changed) return chat;
  await chatRepository.save(app.db, { id: chat.id, ownerId: chat.ownerId, title: chat.title, messages });
  return { ...chat, messages };
}
