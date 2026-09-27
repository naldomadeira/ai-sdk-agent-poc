-- Aprovações humanas são de uso único. A assinatura HMAC do AI SDK garante que a aprovação
-- corresponde à tool/input aprovados, mas não impede reapresentá-la (achado do EVAL-10).
-- invokeCapability grava aqui antes de executar; a PK torna o consumo atômico.
-- Tabela da plataforma: sem GRANT para agent_readonly.

CREATE TABLE consumed_approvals (
  approval_id  text PRIMARY KEY,
  capability   text        NOT NULL,
  consumed_by  text        NOT NULL REFERENCES staff_users(id),
  consumed_at  timestamptz NOT NULL DEFAULT now()
);
