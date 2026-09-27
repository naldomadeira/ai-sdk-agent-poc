-- A role agent_readonly é criada pelo runner de migrations (a senha vem de DATABASE_READONLY_URL).
-- Aqui ficam só os GRANTs: SELECT no domínio de e-commerce e nada mais.
-- É a última linha de defesa de queryDatabase: mesmo que a validação de SQL falhe,
-- o Postgres recusa qualquer escrita e qualquer leitura fora desta lista.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM agent_readonly;
REVOKE CREATE ON SCHEMA public FROM agent_readonly;
GRANT USAGE ON SCHEMA public TO agent_readonly;

GRANT SELECT ON customers, products, orders, order_items, payments,
                customer_notifications, late_orders, customer_spending
  TO agent_readonly;

-- Explícito: nada de staff_users, chats, workflow_runs nem agent_audit_log.
