-- Tabelas da plataforma de agentes: usuários internos, conversas, notificações, workflows e auditoria.
-- Nenhuma delas é legível pela role agent_readonly (ver 003).

CREATE TABLE staff_users (
  id    text PRIMARY KEY,
  name  text NOT NULL,
  role  text NOT NULL CHECK (role IN ('viewer','support','manager'))
);

CREATE TABLE chats (
  id          text PRIMARY KEY,
  owner_id    text        NOT NULL REFERENCES staff_users(id),
  title       text,
  messages    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chats_owner_idx ON chats (owner_id, updated_at DESC);

CREATE TABLE workflow_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow      text        NOT NULL,
  status        text        NOT NULL CHECK (status IN ('awaiting_approval','running','completed','rejected','failed')),
  requested_by  text        NOT NULL REFERENCES staff_users(id),
  approved_by   text        REFERENCES staff_users(id),
  payload       jsonb       NOT NULL,
  result        jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customer_notifications (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id      integer     NOT NULL REFERENCES customers(id),
  order_id         integer     REFERENCES orders(id),
  channel          text        NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
  subject          text        NOT NULL,
  body             text        NOT NULL,
  status           text        NOT NULL DEFAULT 'sent' CHECK (status IN ('sent')),
  sent_by          text        NOT NULL REFERENCES staff_users(id),
  workflow_run_id  uuid        REFERENCES workflow_runs(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_notifications_customer_idx ON customer_notifications (customer_id, created_at DESC);
COMMENT ON TABLE customer_notifications IS 'Notificações enviadas a clientes (outbox simulado; nenhum e-mail real sai).';

CREATE TABLE agent_audit_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  actor_id     text        NOT NULL,
  actor_role   text        NOT NULL,
  agent        text        NOT NULL,
  channel      text        NOT NULL CHECK (channel IN ('agent','mcp','workflow','test')),
  chat_id      text,
  capability   text        NOT NULL,
  event        text        NOT NULL CHECK (event IN
                 ('capability_call','approval_requested','approval_granted','approval_denied')),
  status       text        NOT NULL CHECK (status IN ('ok','error','forbidden','invalid','pending','denied')),
  input        jsonb,
  output       jsonb,
  error        text,
  approval_id  text,
  duration_ms  integer
);
CREATE INDEX agent_audit_log_occurred_idx ON agent_audit_log (occurred_at DESC);
CREATE INDEX agent_audit_log_actor_idx ON agent_audit_log (actor_id, occurred_at DESC);
