# AI SDK Agent Architecture POC

> **Experiment, not a library.** This is a proof of concept for exploring an architecture. It is not a
> production-ready framework, package or template, and it has known limitations (listed below).

A Next.js + [Vercel AI SDK](https://ai-sdk.dev) experiment that investigates how an AI agent can
**operate a real application** — query data, take business actions, respect authorization, ask for human
approval, keep conversational context, run workflows and leave an audit trail — **without turning every
repository/service method into a tool**.

The demo domain is a small e-commerce back office (customers, products, orders, order items, payments)
operated by `commerceAgent`.

## The problem

The naive way to give an agent access to an application is one tool per method:
`getOrdersByCustomer`, `getOrdersToday`, `getPendingOrders`, `getTopCustomers`, `updateOrder`,
`updatePayment`… That approach:

- grows with the number of tables and queries, not with the business;
- still can't answer questions nobody anticipated ("late orders by city");
- pushes business rules into the model when generic write tools (`updateOrder`) are exposed;
- scatters validation, authorization and logging across dozens of tools.

**Question explored:** what is the minimal set of capabilities that lets an agent be *useful* and *safe*?

## Architecture

```text
User  (Next.js chat UI · approval cards · /audit)
  ↓
AI SDK Agent  (ToolLoopAgent, created per request for the authenticated user)
  ↓
Capability Registry / Executor  (invokeCapability: validate → authorize → require approval → audit)
  ├── Read capabilities    inspectSchema, queryDatabase
  ├── Domain actions       cancelOrder, refundPayment, sendCustomerNotification
  └── Workflows            prepareLateOrderNotifications, sendPreparedNotifications
        ↓
Application Domain  (use cases: authorization + business rules + transactions)
        ↓
Database  (PostgreSQL; read capabilities use a separate read-only role)
```

**Principle:** *the AI decides **what** to do; the application decides **whether** it may be done.*

The same registry is also served over **MCP** (`src/mcp/server.ts`), so another agent or client gets the
same capabilities with the same validation, authorization and audit — no extra code per capability.

### Capabilities

| Capability | Kind | Permission | Human approval | What it does |
| --- | --- | --- | --- | --- |
| `inspectSchema` | generic read | `data:read` | — | Lists readable tables/views, columns, FKs and business docs (`COMMENT ON`) |
| `queryDatabase` | generic read | `data:read` | — | Runs one read-only `SELECT` with timeout and row limit |
| `cancelOrder` | domain action | `orders:cancel` | — | Cancels an order that hasn't shipped |
| `refundPayment` | domain action | `payments:refund` | **required** | Full or partial refund |
| `sendCustomerNotification` | domain action | `notifications:send` | — | Emails a customer (simulated, rate-limited) |
| `prepareLateOrderNotifications` | workflow | `workflows:late-orders` | — | Finds late orders, groups by customer, drafts notifications (sends nothing) |
| `sendPreparedNotifications` | workflow | `workflows:late-orders` | **required** | Sends the prepared drafts, once |

### Three kinds of capability

- **Generic read capability** — a small, fixed pair (`inspectSchema` + `queryDatabase`) that answers
  open-ended questions. It does not grow with the domain. It is only acceptable because the *database*
  enforces read-only access, not the prompt. Recurring business definitions ("late", "spent") live in SQL
  views so the model doesn't reinvent them.
- **Semantic domain action** — one capability per business verb that changes state. It is a thin adapter
  (Zod schema + permission + approval flag) that delegates to a use case where the rules live. There are
  no generic write tools.
- **Workflow** — a deterministic, multi-step process (fixed criteria, template text, persisted state,
  approval gate, idempotent execution). The agent triggers and explains it; the LLM does not drive the
  steps. *Agent = decision/reasoning. Workflow = deterministic process.*

The full reasoning — including when to promote a generic read to a specific read capability — is in
[`specs/architecture.md`](./specs/architecture.md).

## Security model

Nothing below depends on the system prompt. Removing the prompt entirely opens no hole.

- **Permission filtering** — the agent only receives the tools the authenticated user's role allows
  (a viewer literally has no `cancelOrder` tool).
- **Authorization in the use case** — use cases call `assertCan(...)` again (defense in depth), so any
  channel (web agent, MCP, future API) is covered.
- **Identity from the server** — the principal comes from the server-side session; it is never a tool
  parameter the model could fill in.
- **Read-only database access** — `queryDatabase` has four independent layers: static SQL validation,
  a Postgres role (`agent_readonly`) with `SELECT` grants on business tables only, a `BEGIN READ ONLY`
  transaction with `statement_timeout`, and an outer `LIMIT`.
- **Human approval** — capabilities flagged `approval: "required"` map to AI SDK v7 `toolApproval`
  (`user-approval`). The executor fails closed: an approval-required capability without approval evidence
  never runs. Approval does not replace permission.
- **Signed approvals** — approvals are HMAC-signed (`experimental_toolApprovalSecret`), binding tool name,
  call id and input. Tampering with the input after the request is rejected (covered by a test).
- **Server-owned history** — the client sends only the new message; the server accepts only a new user
  message or an approval response for a tool call it issued. Injected assistant messages are rejected.
- **Audit** — every capability call (any channel) and every approval request/grant/denial is stored in
  `agent_audit_log` (user, role, agent, channel, capability, input, result, error, approval id, duration,
  timestamp) and shown at `/audit`.
- **No secrets in code** — configuration is validated from environment variables; `.env*` files are
  git-ignored except `.env.example`, which contains only local Docker defaults.

## Running locally

Requirements: Node 22+, pnpm, Docker, and an API key for Anthropic (or an Anthropic-compatible gateway).

```bash
pnpm install
cp .env.example .env.local   # set ANTHROPIC_API_KEY and TOOL_APPROVAL_SECRET (openssl rand -hex 32)
pnpm db:up                   # PostgreSQL on localhost:5467
pnpm db:reset                # migrations + read-only role + deterministic seed
pnpm dev                     # http://localhost:3467
```

Switch the simulated user in the header:

| User | Role | Can |
| --- | --- | --- |
| Ana | manager | read, cancel, refund (with approval), notify, workflow |
| Bruno | support | read, cancel, notify, workflow |
| Carla | viewer | read only |

Try:

| Prompt | Demonstrates |
| --- | --- |
| Quais são os 5 clientes que mais gastaram este mês? | generic read + semantic view |
| Mostre os pedidos do João. → Qual deles foi o mais caro? | conversational memory |
| Cancele o pedido #123. | domain action + business rule |
| Reembolse o pedido #123. (as Ana) | human approval |
| Encontre pedidos atrasados e prepare notificações. | workflow + approval |
| Cancele o pedido #127. (as Carla) | permission filtering |

The UI and the demo data are in Portuguese (pt-BR); so are code comments and the `specs/` folder.

### Scripts

| Script | Purpose |
| --- | --- |
| `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` | checks (`pnpm check` runs all four) |
| `pnpm db:up` · `db:down` · `db:migrate` · `db:seed` · `db:reset` | database |
| `pnpm smoke [scenario...]` | scenarios against the running server **with the real model** (costs tokens) |
| `pnpm mcp` | MCP stdio server (for MCP clients, invoke `tsx` directly — see `scripts/mcp-server.ts`) |

## Tests

Current status: **98/98 tests passing**, `lint` ✓, `typecheck` ✓, `build` ✓.

Automated tests **never call a real LLM**. They run against a dedicated Postgres database
(`commerce_test`) and use the AI SDK's `MockLanguageModelV4` with scripted turns to drive the real agent
loop. Coverage includes:

- domain rules and authorization matrix;
- repositories and use cases (transactions, concurrency locks, business errors);
- SQL guard and database capabilities (writes rejected, grants enforced, timeout, row limit, audit);
- action capabilities (delegation, structured errors, approval evidence, permission);
- agent approval flow (pause, approve, reject, **tampered approval rejected by signature**);
- conversational memory end to end through the HTTP handler and the UI stream;
- the workflow (determinism, idempotency, rate-limit skip);
- the MCP adapter (tool listing per role, shared validation and audit).

In addition, **manual smoke tests with a real model** (Claude Haiku 4.5) were run through the real HTTP
route (`pnpm smoke`) and in the browser, covering all six scenarios above, including clicking
**Approve** on a refund in the UI.

## Findings from real-model testing

The real model surfaced four problems. All of them were **agent behavior** issues — the quality of
answers — not security failures: in every case the backend rules held. They were addressed in the agent
instructions, which only shape the experience; security remains in the backend.

1. **Asked "which João?" instead of searching.** An instruction to ask when ambiguous made the model
   over-cautious. Fix: search customers by name (`ILIKE`) first and ask only if there is more than one
   match.
2. **Claimed it would perform an action it had no capability for.** As a viewer, it replied "I'll cancel
   the order" — though the tool didn't exist, so nothing could happen. Fix: the prompt now lists, derived
   from the registry, which actions the user's role does not allow, and the agent says so.
3. **Guessed column names before reading the schema.** It recovered on its own thanks to structured SQL
   errors, but wasted a round-trip. Fix: call `inspectSchema` before the first query in a conversation.
4. **Invented a refund timeline** ("5 to 10 business days") not backed by any tool. Fix: an explicit rule
   not to invent policies, deadlines or data.

Takeaway: **treat the model as untrusted for authorization.** Its output is useful for choosing and
explaining actions, never for deciding whether they are allowed.

## Current limitations

- **Authentication is a user selector** (cookie) — a stand-in for real auth. Authorization is real;
  identity is simulated.
- **Requester and approver can be the same person.** There is no four-eyes rule yet for high-value refunds.
- **MCP does not expose approval-required actions** (`refundPayment`, `sendPreparedNotifications`),
  because there is no human approval channel for MCP clients yet.
- **No row-level security (RLS)** for customer-facing scenarios. Generic read access is designed for
  internal staff; a customer-facing agent needs RLS or specific read capabilities.
- **No advanced observability** — no OpenTelemetry traces, token/latency metrics or dashboards; only the
  audit table and structured console logs.
- **No conversation compaction** — long chats grow without bound.
- **Workflows are not durable** — no retries, scheduling or long waits.
- **The real model can behave incorrectly** (see findings above) and must be treated as unreliable for
  anything security-related.

## Project layout

```text
db/migrations/         schema, semantic views, read-only role grants
src/
  domain/              pure business rules
  application/         use cases (authorization + rules + transactions)
  infrastructure/db/   pool, migrations, seed, repositories
  capabilities/        capability contract, executor, registry, read/actions/workflows
  workflows/           deterministic processes
  agents/              commerceAgent, AI SDK adapter, memory, chat handler
  mcp/                 MCP adapter
  observability/       audit log
  app/, components/    Next.js UI (chat, approvals, /audit)
tests/                 unit + integration (mock model)
specs/                 roadmap, architecture, ADRs (planning source of truth)
```

## Stack

Next.js 16 · React 19 · AI SDK 7 · `@ai-sdk/anthropic` · Zod 4 · PostgreSQL 17 · `pg` · Vitest 5 ·
Tailwind CSS 4 · `@modelcontextprotocol/sdk`

## License

[MIT](./LICENSE) — for the POC code. Use it to learn from or as a starting point, at your own risk.
