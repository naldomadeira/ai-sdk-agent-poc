import type { UIMessage } from "ai";
import type { Queryable } from "../pool";

export interface StoredChat {
  id: string;
  ownerId: string;
  title: string | null;
  messages: UIMessage[];
  updatedAt: Date;
}

interface Row {
  id: string;
  owner_id: string;
  title: string | null;
  messages: UIMessage[];
  updated_at: Date;
}

const toChat = (r: Row): StoredChat => ({
  id: r.id,
  ownerId: r.owner_id,
  title: r.title,
  messages: r.messages,
  updatedAt: r.updated_at,
});

export const chatRepository = {
  async findById(db: Queryable, id: string): Promise<StoredChat | null> {
    const { rows } = await db.query<Row>("SELECT * FROM chats WHERE id = $1", [id]);
    return rows[0] ? toChat(rows[0]) : null;
  },

  async listByOwner(db: Queryable, ownerId: string, limit = 20): Promise<Omit<StoredChat, "messages">[]> {
    const { rows } = await db.query<Row>(
      "SELECT id, owner_id, title, '[]'::jsonb AS messages, updated_at FROM chats WHERE owner_id = $1 ORDER BY updated_at DESC LIMIT $2",
      [ownerId, limit],
    );
    return rows.map(toChat);
  },

  /** Upsert que nunca troca o dono de um chat existente. */
  async save(db: Queryable, chat: { id: string; ownerId: string; title: string | null; messages: UIMessage[] }) {
    const { rowCount } = await db.query(
      `INSERT INTO chats (id, owner_id, title, messages) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET messages = EXCLUDED.messages, updated_at = now(),
         title = coalesce(chats.title, EXCLUDED.title)
       WHERE chats.owner_id = EXCLUDED.owner_id`,
      [chat.id, chat.ownerId, chat.title, JSON.stringify(chat.messages)],
    );
    if (!rowCount) throw new Error(`chat ${chat.id} pertence a outro usuário`);
  },
};
