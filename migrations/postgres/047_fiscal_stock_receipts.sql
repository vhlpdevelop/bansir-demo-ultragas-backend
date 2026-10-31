CREATE TABLE bansir.fiscal_stock_receipts(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,access_key text NOT NULL,document_id uuid NOT NULL,
 request_hash text NOT NULL,created_by uuid NOT NULL,physically_checked boolean NOT NULL CHECK(physically_checked),
 result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,establishment_id,access_key),
 FOREIGN KEY(tenant_id,establishment_id,document_id) REFERENCES bansir.fiscal_inbound(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,created_by) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id)
);
CREATE TABLE bansir.supplier_product_links(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,supplier_cnpj text NOT NULL,supplier_code text NOT NULL,product_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,establishment_id,supplier_cnpj,supplier_code),
 FOREIGN KEY(tenant_id,establishment_id,product_id) REFERENCES bansir.products(tenant_id,establishment_id,id)
);
DO $$ DECLARE tab text;BEGIN
 FOREACH tab IN ARRAY ARRAY['fiscal_stock_receipts','supplier_product_links'] LOOP
  EXECUTE format('ALTER TABLE bansir.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE bansir.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY fiscal_stock_unit ON bansir.%I TO bansir_runtime USING(bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id))',tab);
 END LOOP;
END $$;
GRANT SELECT,INSERT ON bansir.fiscal_stock_receipts TO bansir_runtime;
GRANT SELECT,INSERT,UPDATE ON bansir.supplier_product_links TO bansir_runtime;
-- Allow row locking while a receipt commits; no fiscal content is editable by this route.
GRANT UPDATE(updated_at) ON bansir.fiscal_inbound TO bansir_runtime;
