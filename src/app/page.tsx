import Link from "next/link";
import { Chat } from "@/components/chat";
import { can } from "@/domain/auth/principal";
import { appPool } from "@/infrastructure/db/pool";
import { chatRepository } from "@/infrastructure/db/repositories/chat-repository";
import { currentPrincipal } from "./session";

export default async function Home({ searchParams }: PageProps<"/">) {
  const principal = await currentPrincipal();
  if (!principal) return <p className="p-8">Usuário não encontrado. Rode <code>pnpm db:reset</code>.</p>;

  const { c } = await searchParams;
  const requested = typeof c === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(c) ? c : undefined;
  const [chats, stored] = await Promise.all([
    chatRepository.listByOwner(appPool(), principal.id),
    requested ? chatRepository.findById(appPool(), requested) : null,
  ]);
  // Chat de outro usuário não é carregado: começa uma conversa nova.
  const owned = stored && stored.ownerId === principal.id ? stored : null;
  const chatId = owned?.id ?? requested ?? crypto.randomUUID();

  const permissions = (["orders:cancel", "payments:refund", "notifications:send"] as const).filter((p) => can(principal, p));

  return (
    <>
      <aside className="hidden w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-surface p-4 md:flex">
        <Link
          href={`/?c=${crypto.randomUUID()}`}
          className="rounded-md bg-accent px-3 py-2 text-center text-sm font-medium text-surface hover:opacity-90"
        >
          Nova conversa
        </Link>
        <section className="text-xs text-muted">
          <p className="font-medium text-foreground">{principal.name}</p>
          <p>papel: {principal.role}</p>
          <p className="mt-1">pode: leitura{permissions.length ? `, ${permissions.join(", ")}` : ""}</p>
        </section>
        <nav className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Conversas</p>
          {chats.length === 0 && <p className="text-xs text-muted">Nenhuma ainda.</p>}
          {chats.map((chat) => (
            <Link
              key={chat.id}
              href={`/?c=${chat.id}`}
              className={`truncate rounded px-2 py-1 text-sm hover:bg-background ${chat.id === chatId ? "bg-background font-medium" : ""}`}
            >
              {chat.title ?? "Sem título"}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <Chat key={`${principal.id}:${chatId}`} chatId={chatId} initialMessages={owned?.messages ?? []} />
      </main>
    </>
  );
}
