ALTER TABLE bansir.sales ADD COLUMN revision integer NOT NULL DEFAULT 0;
CREATE TABLE bansir.sale_revisions(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,sale_id uuid NOT NULL,revision integer NOT NULL,
 request_key uuid NOT NULL,request_hash text NOT NULL,user_id uuid NOT NULL,reason text NOT NULL,
 before_data jsonb NOT NULL,after_data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,sale_id,revision),UNIQUE(tenant_id,establishment_id,request_key),
 FOREIGN KEY(tenant_id,establishment_id,sale_id) REFERENCES bansir.sales(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,user_id) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id));
ALTER TABLE bansir.sale_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bansir.sale_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY sale_revision_unit ON bansir.sale_revisions TO bansir_runtime USING(bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id));
GRANT SELECT,INSERT ON bansir.sale_revisions TO bansir_runtime;
GRANT UPDATE(customer_name,customer_document,customer_phone,customer_snapshot,delivery_address,revision) ON bansir.sales TO bansir_runtime;
GRANT UPDATE(ncm,fiscal_profile) ON bansir.sale_items TO bansir_runtime;
