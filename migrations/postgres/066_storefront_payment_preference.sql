ALTER TABLE bansir.storefront_orders ADD COLUMN preferred_payment text
 CHECK (preferred_payment IN ('cash','pix','credit_card','debit_card'));
GRANT INSERT(preferred_payment) ON bansir.storefront_orders TO bansir_storefront;
GRANT INSERT(tenant_id,establishment_id,monitor_id,access_key,supplier_cnpj,supplier_name,number,issued_at,total_cents,status,items,encrypted_xml),
 UPDATE(supplier_cnpj,supplier_name,number,issued_at,total_cents,status,items,encrypted_xml)
 ON bansir.fiscal_inbound TO bansir_runtime;
