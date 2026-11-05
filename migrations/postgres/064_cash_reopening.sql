ALTER TABLE bansir.cash_sessions ADD COLUMN reopen_version integer NOT NULL DEFAULT 0;

CREATE TABLE bansir.cash_reopen_codes (
 tenant_id uuid NOT NULL, establishment_id uuid NOT NULL, terminal_id uuid NOT NULL,
 issuer_id uuid NOT NULL, digest text NOT NULL, expires_at timestamptz NOT NULL,
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
 PRIMARY KEY (tenant_id, establishment_id, terminal_id),
 FOREIGN KEY (tenant_id, establishment_id, terminal_id) REFERENCES bansir.pdv_terminals(tenant_id, establishment_id, id)
);

CREATE TABLE bansir.cash_reopenings (
 tenant_id uuid NOT NULL, establishment_id uuid NOT NULL, cash_id uuid NOT NULL,
 request_key uuid NOT NULL, operator_id uuid NOT NULL, approver_id uuid NOT NULL,
 previous_close jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (tenant_id, establishment_id, request_key),
 FOREIGN KEY (tenant_id, establishment_id, cash_id) REFERENCES bansir.cash_sessions(tenant_id, establishment_id, id)
);

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['cash_reopen_codes','cash_reopenings'] LOOP
  EXECUTE format('ALTER TABLE bansir.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE bansir.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY reopen_unit ON bansir.%I TO bansir_runtime USING (bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK (bansir.can_access_establishment(tenant_id,establishment_id))',tab);
 END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON bansir.cash_reopen_codes TO bansir_runtime;
GRANT SELECT, INSERT ON bansir.cash_reopenings TO bansir_runtime;
