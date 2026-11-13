CREATE TABLE bansir.fiscal_inbound_rules (
 tenant_id uuid NOT NULL,
 establishment_id uuid NOT NULL,
 kind text NOT NULL,
 target text NOT NULL,
 PRIMARY KEY (tenant_id, establishment_id, kind, target),
 FOREIGN KEY (tenant_id, establishment_id) REFERENCES bansir.establishments(tenant_id,id),
 CHECK ((kind='hidden' AND target ~ '^[0-9]{44}$') OR (kind='blocked' AND target ~ '^[0-9]{14}$'))
);
ALTER TABLE bansir.fiscal_inbound_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE bansir.fiscal_inbound_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY fiscal_inbound_rules_runtime ON bansir.fiscal_inbound_rules TO bansir_runtime
 USING (tenant_id=bansir.tenant_id() AND establishment_id=bansir.establishment_id())
 WITH CHECK (tenant_id=bansir.tenant_id() AND establishment_id=bansir.establishment_id());
CREATE POLICY fiscal_inbound_rules_worker ON bansir.fiscal_inbound_rules FOR SELECT TO bansir_worker
 USING (tenant_id=bansir.tenant_id() AND establishment_id=bansir.establishment_id());
GRANT SELECT, INSERT, DELETE ON bansir.fiscal_inbound_rules TO bansir_runtime;
GRANT SELECT ON bansir.fiscal_inbound_rules TO bansir_worker;
