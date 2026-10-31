CREATE TABLE bansir.pdv_terminal_smartpos(
 terminal_id uuid NOT NULL,tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,provider text NOT NULL CHECK(provider IN('pagbank','mercadopago','caixa')),
 token_hash text NOT NULL UNIQUE,paired_at timestamptz NOT NULL DEFAULT now(),last_seen_at timestamptz,diagnostics jsonb NOT NULL DEFAULT '{}',
 UNIQUE(terminal_id,provider),FOREIGN KEY(tenant_id,establishment_id,terminal_id) REFERENCES bansir.pdv_terminals(tenant_id,establishment_id,id)
);
-- The migration owner must see every unit while copying legacy credentials.
ALTER TABLE bansir.pdv_terminals NO FORCE ROW LEVEL SECURITY;
INSERT INTO bansir.pdv_terminal_smartpos(terminal_id,tenant_id,establishment_id,provider,token_hash,paired_at,last_seen_at,diagnostics)
 SELECT id,tenant_id,establishment_id,'pagbank',smartpos_hash,coalesce(paired_at,created_at),smartpos_last_seen_at,smartpos_metadata FROM bansir.pdv_terminals WHERE smartpos_hash IS NOT NULL;
DO $$ BEGIN IF (SELECT count(*) FROM bansir.pdv_terminals WHERE smartpos_hash IS NOT NULL)<>(SELECT count(*) FROM bansir.pdv_terminal_smartpos WHERE provider='pagbank') THEN RAISE EXCEPTION 'Incomplete legacy SmartPOS migration';END IF;END $$;
-- Old activation digests cannot be converted to HMAC without the plaintext.
UPDATE bansir.pdv_terminals SET activation_hash=NULL,activation_expires_at=NULL;
ALTER TABLE bansir.pdv_terminals FORCE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX pdv_activation_scope ON bansir.pdv_terminals(tenant_id,establishment_id,activation_hash) WHERE activation_hash IS NOT NULL;
ALTER TABLE bansir.pdv_terminal_events ALTER COLUMN terminal_id DROP NOT NULL;
ALTER TABLE bansir.pdv_terminal_events ADD COLUMN provider text,ADD COLUMN client_type text;
ALTER TABLE bansir.pdv_terminal_events DROP CONSTRAINT pdv_terminal_events_event_check;
ALTER TABLE bansir.pdv_terminal_events ADD CHECK(event IN('created','activation_issued','recovery_issued','paired','enabled','disabled','provider_revoked','pair_failed'));
CREATE TABLE bansir.pdv_pair_attempts(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,scope text NOT NULL CHECK(scope IN('user','unit')),subject uuid NOT NULL,
 failures integer NOT NULL,blocked_until timestamptz,window_start timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,establishment_id,scope,subject)
);
DO $$ DECLARE tab text;BEGIN
 FOREACH tab IN ARRAY ARRAY['pdv_terminal_smartpos','pdv_pair_attempts'] LOOP
  EXECUTE format('ALTER TABLE bansir.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE bansir.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY terminal_provider_unit ON bansir.%I TO bansir_runtime USING(bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id))',tab);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON bansir.pdv_terminal_smartpos TO bansir_runtime;
GRANT SELECT,INSERT,UPDATE ON bansir.pdv_pair_attempts TO bansir_runtime;
