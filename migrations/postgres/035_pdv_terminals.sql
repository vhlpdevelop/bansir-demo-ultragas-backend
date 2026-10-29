CREATE TABLE bansir.pdv_terminals (
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),active boolean NOT NULL DEFAULT true,
 device_hash text UNIQUE,activation_hash text,activation_expires_at timestamptz,activation_recovery boolean NOT NULL DEFAULT false,paired_at timestamptz,
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,created_by) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id)
);
CREATE UNIQUE INDEX pdv_terminal_name ON bansir.pdv_terminals(tenant_id,establishment_id,lower(name));
CREATE TABLE bansir.pdv_terminal_events (
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),terminal_id uuid NOT NULL,
 user_id uuid NOT NULL,event text NOT NULL CHECK(event IN('created','activation_issued','recovery_issued','paired','enabled','disabled')),reason text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,terminal_id) REFERENCES bansir.pdv_terminals(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,user_id) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id)
);
ALTER TABLE bansir.cash_sessions ADD COLUMN terminal_id uuid,ADD COLUMN terminal_name text;
ALTER TABLE bansir.cash_sessions ADD CONSTRAINT cash_terminal_fk FOREIGN KEY(tenant_id,establishment_id,terminal_id) REFERENCES bansir.pdv_terminals(tenant_id,establishment_id,id);
ALTER TABLE bansir.cash_sessions ADD CONSTRAINT cash_terminal_snapshot CHECK((terminal_id IS NULL AND terminal_name IS NULL) OR (terminal_id IS NOT NULL AND terminal_name IS NOT NULL));
CREATE UNIQUE INDEX one_open_cash_per_terminal ON bansir.cash_sessions(tenant_id,establishment_id,terminal_id) WHERE closed_at IS NULL AND terminal_id IS NOT NULL;
-- Historical cash sessions remain unidentified: never invent a terminal for old sales.
CREATE FUNCTION bansir.preserve_cash_origin() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bansir AS $$
BEGIN
 IF (NEW.tenant_id,NEW.establishment_id,NEW.user_id,NEW.terminal_id,NEW.terminal_name,NEW.opened_at) IS DISTINCT FROM (OLD.tenant_id,OLD.establishment_id,OLD.user_id,OLD.terminal_id,OLD.terminal_name,OLD.opened_at) THEN
  RAISE EXCEPTION 'Cash origin is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bansir.preserve_cash_origin() FROM PUBLIC;
CREATE TRIGGER preserve_cash_origin BEFORE UPDATE ON bansir.cash_sessions FOR EACH ROW EXECUTE FUNCTION bansir.preserve_cash_origin();
DO $$ DECLARE tab text;BEGIN
 FOREACH tab IN ARRAY ARRAY['pdv_terminals','pdv_terminal_events'] LOOP
  EXECUTE format('ALTER TABLE bansir.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE bansir.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY unit_terminals ON bansir.%I TO bansir_runtime USING(bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id))',tab);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON bansir.pdv_terminals TO bansir_runtime;
GRANT SELECT,INSERT ON bansir.pdv_terminal_events TO bansir_runtime;
