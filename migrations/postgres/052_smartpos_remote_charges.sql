CREATE TABLE bansir.pdv_smartpos_codes(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,terminal_id uuid NOT NULL,provider text NOT NULL CHECK(provider IN('pagbank','mercadopago','caixa')),code_hash text NOT NULL,expires_at timestamptz NOT NULL,created_by uuid NOT NULL,
 PRIMARY KEY(tenant_id,establishment_id,terminal_id,provider),UNIQUE(tenant_id,establishment_id,code_hash),FOREIGN KEY(tenant_id,establishment_id,terminal_id) REFERENCES bansir.pdv_terminals(tenant_id,establishment_id,id)
);
CREATE TABLE bansir.smartpos_charges(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),request_key uuid NOT NULL,request_hash text NOT NULL,
 sale_id uuid NOT NULL,cash_session_id uuid NOT NULL,terminal_id uuid NOT NULL,provider text NOT NULL CHECK(provider IN('pagbank','mercadopago','caixa')),device_hash text NOT NULL,requested_by uuid NOT NULL,
 amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN 1 AND 1000000000),method text NOT NULL CHECK(method IN('credit_card','debit_card')),installments int NOT NULL CHECK(installments BETWEEN 1 AND 24),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','executing','unknown','approved','approved_review','declined','cancelled','expired')),
 claim_request_key uuid,claimed_by uuid,result_by uuid,claimed_at timestamptz,expires_at timestamptz NOT NULL DEFAULT now()+interval '2 minutes',result_hash text,result jsonb,provider_transaction_id text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,id),UNIQUE(tenant_id,establishment_id,request_key),
 FOREIGN KEY(tenant_id,establishment_id,sale_id) REFERENCES bansir.sales(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,terminal_id) REFERENCES bansir.pdv_terminals(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,cash_session_id) REFERENCES bansir.cash_sessions(tenant_id,establishment_id,id)
);
CREATE UNIQUE INDEX smartpos_live_sale ON bansir.smartpos_charges(tenant_id,establishment_id,sale_id) WHERE status IN('queued','executing','unknown','approved_review');
CREATE UNIQUE INDEX smartpos_live_device ON bansir.smartpos_charges(tenant_id,establishment_id,device_hash) WHERE status IN('queued','executing','unknown','approved_review');
CREATE UNIQUE INDEX smartpos_provider_transaction ON bansir.smartpos_charges(tenant_id,provider,provider_transaction_id) WHERE provider_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX smartpos_claim_request ON bansir.smartpos_charges(tenant_id,establishment_id,device_hash,claim_request_key) WHERE claim_request_key IS NOT NULL;
DO $$ DECLARE tab text;BEGIN
 FOREACH tab IN ARRAY ARRAY['pdv_smartpos_codes','smartpos_charges'] LOOP
  EXECUTE format('ALTER TABLE bansir.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE bansir.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY unit_smartpos ON bansir.%I TO bansir_runtime USING(bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id))',tab);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON bansir.pdv_smartpos_codes TO bansir_runtime;
GRANT SELECT,INSERT,UPDATE ON bansir.smartpos_charges TO bansir_runtime;

ALTER TABLE bansir.sale_payments ADD COLUMN smartpos_charge_id uuid,ADD COLUMN acquirer_data jsonb;
ALTER TABLE bansir.sale_payments ADD FOREIGN KEY(tenant_id,establishment_id,smartpos_charge_id) REFERENCES bansir.smartpos_charges(tenant_id,establishment_id,id);
CREATE UNIQUE INDEX smartpos_payment_once ON bansir.sale_payments(tenant_id,establishment_id,smartpos_charge_id) WHERE smartpos_charge_id IS NOT NULL;
