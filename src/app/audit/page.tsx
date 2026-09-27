import { appPool } from "@/infrastructure/db/pool";
import { recentAuditEntries } from "@/observability/audit-log";
import { currentPrincipal } from "../session";

const STATUS_TONE: Record<string, string> = {
  ok: "text-accent",
  pending: "text-warn",
  denied: "text-danger",
  forbidden: "text-danger",
  invalid: "text-danger",
  error: "text-danger",
};

export default async function AuditPage() {
  const principal = await currentPrincipal();
  if (!principal) return null;
  const entries = await recentAuditEntries(appPool(), 200);

  return (
    <main className="flex-1 overflow-auto p-6">
      <h1 className="text-lg font-semibold">Auditoria do agente</h1>
      <p className="mb-4 text-sm text-muted">
        Toda invocação de capability (qualquer canal) e toda decisão de aprovação. Últimos {entries.length} eventos.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border text-muted">
            <tr>
              {["quando", "usuário", "agente / canal", "capability", "evento", "status", "aprovação", "conteúdo", "input", "resultado / erro", "ms"].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-border align-top last:border-0">
                <td className="whitespace-nowrap px-3 py-2 text-muted">
                  {e.occurred_at.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                </td>
                <td className="px-3 py-2">{e.actor_id}<span className="text-muted"> ({e.actor_role})</span></td>
                <td className="px-3 py-2">{e.agent}<span className="text-muted"> / {e.channel}</span></td>
                <td className="px-3 py-2 font-mono">{e.capability}</td>
                <td className="px-3 py-2">{e.event}</td>
                <td className={`px-3 py-2 font-medium ${STATUS_TONE[e.status] ?? ""}`}>{e.status}</td>
                <td className="px-3 py-2 text-muted">{e.approval ?? "—"}</td>
                <td className="px-3 py-2 text-muted">{e.content_origin === "agent_generated" ? "gerado pelo agente" : e.content_origin === "application_template" ? "template da aplicação" : "—"}</td>
                <td className="max-w-xs px-3 py-2"><Json value={e.input} /></td>
                <td className="max-w-xs px-3 py-2">{e.error ? <span className="text-danger">{e.error}</span> : <Json value={e.output} />}</td>
                <td className="px-3 py-2 text-muted">{e.duration_ms ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>;
  const text = JSON.stringify(value);
  return (
    <details>
      <summary className="cursor-pointer truncate font-mono">{text.slice(0, 60)}{text.length > 60 ? "…" : ""}</summary>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
