import { handleChatRequest } from "@/agents/chat-handler";
import { currentPrincipal } from "@/app/session";

export const maxDuration = 60;

export async function POST(request: Request) {
  const principal = await currentPrincipal();
  if (!principal) return Response.json({ error: "Não autenticado" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  return handleChatRequest(principal, body);
}
