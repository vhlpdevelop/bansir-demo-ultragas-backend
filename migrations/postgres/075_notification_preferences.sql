CREATE TABLE bansir.notification_preferences (
 tenant_id uuid NOT NULL,
 establishment_id uuid NOT NULL,
 user_id uuid NOT NULL,
 disabled text[] NOT NULL DEFAULT '{}',
 PRIMARY KEY (tenant_id, establishment_id, user_id)
);
ALTER TABLE bansir.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE bansir.notification_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_preferences_self ON bansir.notification_preferences TO bansir_runtime
 USING (tenant_id=bansir.tenant_id() AND establishment_id=bansir.establishment_id() AND user_id=bansir.actor_id())
 WITH CHECK (tenant_id=bansir.tenant_id() AND establishment_id=bansir.establishment_id() AND user_id=bansir.actor_id());
CREATE POLICY notification_preferences_worker ON bansir.notification_preferences FOR SELECT TO bansir_worker
 USING (tenant_id=bansir.tenant_id() AND establishment_id=bansir.establishment_id());
GRANT SELECT, INSERT, UPDATE ON bansir.notification_preferences TO bansir_runtime;
GRANT SELECT ON bansir.notification_preferences TO bansir_worker;
CREATE TRIGGER signal_notification_preference_change
 AFTER INSERT OR UPDATE ON bansir.notification_preferences
 FOR EACH ROW EXECUTE FUNCTION bansir.signal_notification_change();

CREATE FUNCTION bansir.notification_category(title text) RETURNS text
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE
  WHEN title='Venda registrada' THEN 'sales'
  WHEN title='Estoque baixo' THEN 'stock'
  WHEN title LIKE '%SmartPOS%' THEN 'smartpos'
  WHEN title LIKE 'Contas a pagar%' THEN 'payables'
  WHEN title LIKE 'Contas a receber%' THEN 'receivables'
  WHEN title LIKE 'Convênio:%' THEN 'agreements'
  WHEN title LIKE 'Manutenção da frota%' THEN 'fleet'
  WHEN title LIKE '%nota de fornecedor%' OR title LIKE 'NF-e de fornecedor%' THEN 'fiscal-inbound'
  WHEN title LIKE '%fiscal%' THEN 'fiscal-outbound'
  ELSE 'other'
 END
$$;
REVOKE ALL ON FUNCTION bansir.notification_category(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.notification_category(text) TO bansir_runtime, bansir_worker;
