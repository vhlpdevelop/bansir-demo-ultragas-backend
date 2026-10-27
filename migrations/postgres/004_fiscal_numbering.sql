CREATE TABLE bansir.fiscal_numbering (
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,environment integer NOT NULL CHECK(environment IN(1,2)),
 series integer NOT NULL CHECK(series BETWEEN 1 AND 889),last_number integer NOT NULL CHECK(last_number BETWEEN 0 AND 999999999),
 PRIMARY KEY(tenant_id,establishment_id,environment,series),
 FOREIGN KEY(tenant_id,establishment_id) REFERENCES bansir.fiscal_settings(tenant_id,establishment_id)
);
ALTER TABLE bansir.fiscal_numbering ENABLE ROW LEVEL SECURITY;
ALTER TABLE bansir.fiscal_numbering FORCE ROW LEVEL SECURITY;
CREATE POLICY unit_numbering ON bansir.fiscal_numbering TO bansir_runtime
 USING(bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id));
GRANT SELECT,INSERT,UPDATE ON bansir.fiscal_numbering TO bansir_runtime;
