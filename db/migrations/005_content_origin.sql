-- Proveniência do conteúdo externo (notificações) e decisão de aprovação na auditoria.
--   agent_generated       → texto livre escrito pelo modelo (sempre exige aprovação humana)
--   application_template  → texto renderizado pela aplicação a partir de dados estruturados
-- Linhas antigas assumem agent_generated (o valor conservador).

ALTER TABLE customer_notifications
  ADD COLUMN content_origin text NOT NULL DEFAULT 'agent_generated'
    CHECK (content_origin IN ('agent_generated', 'application_template')),
  ADD COLUMN template_id text;
COMMENT ON COLUMN customer_notifications.content_origin IS
  'agent_generated = texto escrito pelo agente (aprovado por humano); application_template = texto da aplicação.';

ALTER TABLE agent_audit_log
  ADD COLUMN content_origin text CHECK (content_origin IN ('agent_generated', 'application_template')),
  ADD COLUMN approval text CHECK (approval IN ('not_required', 'approved', 'missing'));
