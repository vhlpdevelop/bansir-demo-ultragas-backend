CREATE TABLE bansir.rejected_fiscal_attempts(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,sale_id uuid NOT NULL,document_id uuid NOT NULL,
 replacement_document_id uuid NOT NULL,user_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,document_id),
 FOREIGN KEY(tenant_id,establishment_id,sale_id) REFERENCES bansir.sales(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,document_id) REFERENCES bansir.fiscal_documents(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,replacement_document_id) REFERENCES bansir.fiscal_documents(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,user_id) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id));
ALTER TABLE bansir.rejected_fiscal_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bansir.rejected_fiscal_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY rejected_attempt_unit ON bansir.rejected_fiscal_attempts TO bansir_runtime USING(bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id));
GRANT SELECT,INSERT ON bansir.rejected_fiscal_attempts TO bansir_runtime;
GRANT UPDATE(document_id) ON bansir.sale_fiscal_links TO bansir_runtime;
