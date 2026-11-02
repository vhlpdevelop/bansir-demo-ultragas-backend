ALTER TABLE bansir.fiscal_issuance_items ALTER COLUMN source_id DROP NOT NULL;
ALTER TABLE bansir.fiscal_issuance_items ADD COLUMN sale_id uuid,ADD COLUMN model text NOT NULL DEFAULT '55' CHECK(model IN('55','65')),ADD COLUMN stage int NOT NULL DEFAULT 0 CHECK(stage IN(0,1));
ALTER TABLE bansir.fiscal_issuance_items ADD FOREIGN KEY(tenant_id,establishment_id,sale_id) REFERENCES bansir.sales(tenant_id,establishment_id,id);
CREATE UNIQUE INDEX fiscal_receipt_model_once ON bansir.fiscal_issuance_items(tenant_id,establishment_id,sale_id,model) WHERE document_id IS NOT NULL;
