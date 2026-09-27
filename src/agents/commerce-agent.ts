import { isStepCount, ToolLoopAgent, type LanguageModel } from "ai";
import { env } from "@/config/env";
import { capabilitiesFor, type CapabilityContext } from "@/capabilities/capability";
import { capabilities } from "@/capabilities/registry";
import { toAiSdkTools } from "./ai-sdk-tools";
import { commerceModel } from "./model";

export const COMMERCE_AGENT = "commerceAgent";

/**
 * Instruções orientam o raciocínio. Nenhuma regra crítica depende delas:
 * permissão, aprovação, somente-leitura e regras de negócio são impostas pelo código.
 */
function instructions(ctx: CapabilityContext) {
  const now = ctx.app.now();
  const today = now.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "full", timeStyle: "short" });
  // Derivado do registry: o agente sabe o que o papel NÃO permite e diz isso, em vez de prometer.
  const allowed = new Set(capabilitiesFor(capabilities, ctx.principal).map((c) => c.name));
  const unavailable = capabilities.filter((c) => !allowed.has(c.name)).map((c) => c.name);
  return `Você é o commerceAgent, assistente de operações de um e-commerce. Responda em português do Brasil.

Contexto:
- Usuário: ${ctx.principal.name} (papel: ${ctx.principal.role}).
- Ações que o papel deste usuário NÃO permite: ${unavailable.length ? unavailable.join(", ") : "nenhuma"}.
  Se ele pedir uma delas, diga que o papel dele não permite e sugira quem pode (suporte/gerente). Não prometa executar.
- Agora: ${today} (fuso America/Sao_Paulo; o banco usa o mesmo fuso, então now() e current_date já estão corretos).

Como trabalhar:
- Para perguntas sobre dados: na primeira consulta da conversa chame inspectSchema (não adivinhe nomes de
  colunas) e depois queryDatabase. Não invente números.
- Valores *_cents estão em centavos: apresente em reais (R$ 1.234,56).
- "Atrasado" e "quanto gastou" já têm definição nas views late_orders e customer_spending; use-as.
- Para agir (cancelar, reembolsar, notificar), use as tools de negócio. Nunca diga que uma ação foi feita
  sem um resultado ok: true da tool.
- Se uma tool devolver ok: false, explique o motivo ao usuário em linguagem simples. Não tente contornar.
- Clientes citados pelo nome ("o João"): procure em customers com ILIKE ('%joão%'). Se houver um único
  resultado, siga com ele; só pergunte se houver mais de um.
- Referências a mensagens anteriores ("qual deles", "esse pedido", "o mais caro") se resolvem pelo
  histórico da conversa, incluindo os resultados de tools já obtidos.
- Para notificar clientes com pedidos atrasados, use o workflow: prepareLateOrderNotifications, mostre os
  rascunhos e só então sendPreparedNotifications.
- Não invente prazos, políticas ou dados que não vieram de uma tool.
- Seja conciso: tabelas curtas em markdown quando houver listas.`;
}

export interface CommerceAgentOptions {
  /** Injetável para testes (MockLanguageModelV4). */
  model?: LanguageModel;
}

/**
 * Criado por request: as tools ficam presas ao principal autenticado dessa request,
 * então não existe parâmetro que o modelo possa preencher para agir como outro usuário.
 */
export function createCommerceAgent(ctx: CapabilityContext, opts: CommerceAgentOptions = {}) {
  const { tools, toolApproval } = toAiSdkTools(capabilities, ctx);
  return new ToolLoopAgent({
    id: COMMERCE_AGENT,
    model: opts.model ?? commerceModel(),
    instructions: instructions(ctx),
    tools,
    toolApproval,
    experimental_toolApprovalSecret: env().TOOL_APPROVAL_SECRET,
    stopWhen: isStepCount(12),
  });
}

export type CommerceAgent = ReturnType<typeof createCommerceAgent>;
