import { getToolName, type ChatAddToolApproveResponseFunction, type ToolUIPart, type DynamicToolUIPart } from "ai";

const LABELS: Record<string, string> = {
  inspectSchema: "Inspecionar schema",
  queryDatabase: "Consulta SQL (somente leitura)",
  cancelOrder: "Cancelar pedido",
  refundPayment: "Reembolsar pagamento",
  sendCustomerNotification: "Notificar cliente",
  prepareLateOrderNotifications: "Workflow: preparar notificações de atraso",
  sendPreparedNotifications: "Workflow: enviar notificações preparadas",
};

type Result = { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } };

const brl = (cents: unknown) =>
  typeof cents === "number" ? (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "total";

/** Resumo legível do que será aprovado — o humano precisa entender a ação, não o JSON. */
function describeApproval(name: string, input: Record<string, unknown>) {
  if (name === "refundPayment") return `Reembolsar ${brl(input.amountCents)} do pedido #${input.orderId}. Motivo: ${input.reason}`;
  if (name === "sendPreparedNotifications") return `Enviar as notificações preparadas (execução ${String(input.runId).slice(0, 8)}…)`;
  if (name === "sendCustomerNotification") {
    return `Enviar e-mail escrito pelo agente ao cliente #${input.customerId}${input.orderId ? ` sobre o pedido #${input.orderId}` : ""}. Revise o texto:`;
  }
  return JSON.stringify(input);
}

export function ToolPart({
  part,
  onApproval,
}: {
  part: ToolUIPart | DynamicToolUIPart;
  onApproval: ChatAddToolApproveResponseFunction;
}) {
  const name = getToolName(part);
  const input = (part.input ?? {}) as Record<string, unknown>;
  const output = part.state === "output-available" ? (part.output as Result) : undefined;

  const tone =
    part.state === "approval-requested"
      ? "border-warn bg-warn-soft"
      : part.state === "output-denied" || part.state === "output-error" || output?.ok === false
        ? "border-danger/40 bg-danger-soft"
        : "border-border bg-surface";

  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${tone}`}>
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-muted">{name}</span>
        <span className="font-medium">{LABELS[name] ?? name}</span>
        <span className="ml-auto text-xs text-muted">{stateLabel(part.state, output)}</span>
      </div>

      {name === "queryDatabase" && typeof input.sql === "string" && (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-background p-2 font-mono text-xs">{input.sql}</pre>
      )}

      {part.state === "approval-requested" && (
        <div className="mt-2 flex flex-col gap-2">
          <p>{describeApproval(name, input)}</p>
          {name === "sendCustomerNotification" && (
            // O humano aprova exatamente o texto que o cliente vai receber.
            <blockquote className="rounded border border-border bg-surface p-2 text-sm">
              <p className="font-medium">{String(input.subject ?? "")}</p>
              <p className="mt-1 whitespace-pre-wrap">{String(input.body ?? "")}</p>
            </blockquote>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => onApproval({ id: part.approval.id, approved: true })}
              className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-surface"
            >
              Aprovar
            </button>
            <button
              onClick={() => onApproval({ id: part.approval.id, approved: false, reason: "Rejeitado pelo usuário" })}
              className="rounded-md border border-border bg-surface px-3 py-1 text-xs"
            >
              Rejeitar
            </button>
          </div>
        </div>
      )}

      {output && !output.ok && <p className="mt-1 text-danger">{output.error.message}</p>}
      {part.state === "output-error" && <p className="mt-1 text-danger">{part.errorText}</p>}

      {/* Texto da aplicação, direto do resultado da tool: não depende do modelo repetir. */}
      {output?.ok && name === "prepareLateOrderNotifications" && (
        <WorkflowNotice data={output.data as { notice?: string; reusedExistingRun?: boolean; preparedByCurrentUser?: boolean; requestedBy?: string }} />
      )}
      {output?.ok && name === "sendCustomerNotification" && (
        <p className="mt-1 text-xs text-muted">
          {(output.data as { contentOrigin?: string }).contentOrigin === "application_template"
            ? `Texto padrão da aplicação (${(output.data as { templateId?: string }).templateId}), sem aprovação`
            : "Texto escrito pelo agente, enviado após aprovação humana"}
        </p>
      )}

      {output?.ok && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-muted">resultado</summary>
          <pre className="mt-1 max-h-64 overflow-auto rounded bg-background p-2 font-mono text-xs">
            {JSON.stringify(output.data, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function stateLabel(state: string, output?: Result) {
  switch (state) {
    case "input-streaming":
    case "input-available":
      return "executando…";
    case "approval-requested":
      return "aguardando aprovação";
    case "approval-responded":
      return "resposta enviada";
    case "output-denied":
      return "rejeitado";
    case "output-error":
      return "erro";
    case "output-available":
      return output?.ok === false ? `recusado (${output.error.code})` : "ok";
    default:
      return state;
  }
}

function WorkflowNotice({ data }: { data: { notice?: string; reusedExistingRun?: boolean; preparedByCurrentUser?: boolean; requestedBy?: string } }) {
  if (!data.notice) return null;
  const foreign = data.reusedExistingRun && !data.preparedByCurrentUser;
  return (
    <p className={`mt-2 rounded px-2 py-1 text-xs ${foreign ? "bg-warn-soft text-warn" : "bg-background text-muted"}`}>
      {foreign && <strong>Execução de {data.requestedBy}. </strong>}
      {data.notice}
    </p>
  );
}
