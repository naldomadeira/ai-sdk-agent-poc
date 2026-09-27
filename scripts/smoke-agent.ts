/**
 * Smoke test contra o servidor real (LLM real — consome tokens):
 *   pnpm dev   # em outro terminal
 *   pnpm smoke [cenário...]
 * Cenários: consulta, memoria, acao, aprovacao, workflow, viewer
 * Passa pela rota HTTP de verdade (cookie de usuário, SSE, persistência, aprovação).
 */
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";

const BASE = process.env.SMOKE_URL ?? "http://localhost:3467";

type Part = UIMessage["parts"][number];
type ToolPart = Extract<Part, { toolCallId: string }> & { state: string; approval?: { id: string } };

async function send(user: string, chatId: string, message: unknown, continues?: UIMessage): Promise<UIMessage | undefined> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `poc_user=${user}` },
    body: JSON.stringify({ id: chatId, message }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const chunks = res.body!.pipeThrough(new TextDecoderStream()).pipeThrough(
    new TransformStream<string, UIMessageChunk>({
      transform(text, controller) {
        for (const line of text.split("\n")) {
          if (line.startsWith("data: ") && line !== "data: [DONE]") controller.enqueue(JSON.parse(line.slice(6)));
        }
      },
    }),
  );
  let last: UIMessage | undefined;
  // Continuação (após aprovação): os chunks se aplicam sobre a mensagem existente, como no useChat.
  for await (const m of readUIMessageStream({ stream: chunks, message: continues })) last = m;
  return last;
}

function print(message: UIMessage | undefined) {
  for (const part of message?.parts ?? []) {
    if (part.type === "text") console.log(`  🤖 ${part.text.replaceAll("\n", "\n     ")}`);
    else if ("toolCallId" in part) {
      const p = part as ToolPart & { input?: unknown; output?: { ok: boolean; error?: { message: string } } };
      const outcome = p.output ? (p.output.ok ? "ok" : `recusado: ${p.output.error?.message}`) : p.state;
      console.log(`  🔧 ${part.type.replace("tool-", "")} ${JSON.stringify(p.input).slice(0, 160)} → ${outcome}`);
    }
  }
}

async function ask(user: string, chatId: string, text: string, opts: { approve?: boolean } = {}) {
  console.log(`\n👤 [${user}] ${text}`);
  let reply = await send(user, chatId, { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] });
  print(reply);

  const pending = reply?.parts.find((p) => "toolCallId" in p && (p as ToolPart).state === "approval-requested") as ToolPart | undefined;
  if (pending && opts.approve !== undefined) {
    console.log(`  👤 ${opts.approve ? "APROVA" : "REJEITA"} ${pending.type}`);
    const answered = {
      ...reply!,
      parts: reply!.parts.map((p) =>
        p === pending ? { ...pending, state: "approval-responded", approval: { ...pending.approval, approved: opts.approve } } : p,
      ),
    };
    const before = answered.parts.length;
    reply = await send(user, chatId, answered, answered as UIMessage);
    print(reply && { ...reply, parts: reply.parts.slice(before) });
  }
  return reply;
}

const scenarios: Record<string, () => Promise<unknown>> = {
  consulta: () => ask("u_carla", `smoke-${Date.now()}-q`, "Quais são os 5 clientes que mais gastaram este mês?"),
  memoria: async () => {
    const chat = `smoke-${Date.now()}-m`;
    await ask("u_bruno", chat, "Mostre os pedidos do João.");
    await ask("u_bruno", chat, "Qual deles foi o mais caro?");
  },
  acao: () => ask("u_bruno", `smoke-${Date.now()}-a`, "Cancele o pedido #123. Motivo: cliente desistiu da compra."),
  aprovacao: () => ask("u_ana", `smoke-${Date.now()}-r`, "Reembolse o pedido #123. Motivo: pedido cancelado.", { approve: true }),
  workflow: async () => {
    const chat = `smoke-${Date.now()}-w`;
    await ask("u_bruno", chat, "Encontre pedidos atrasados e prepare notificações.");
    await ask("u_bruno", chat, "Pode enviar.", { approve: true });
  },
  viewer: () => ask("u_carla", `smoke-${Date.now()}-v`, "Cancele o pedido #127, o cliente pediu."),
};

async function main() {
  const selected = process.argv.slice(2);
  for (const name of selected.length ? selected : Object.keys(scenarios)) {
    const run = scenarios[name];
    if (!run) throw new Error(`cenário desconhecido: ${name}`);
    console.log(`\n━━━ ${name} ━━━`);
    await run();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
