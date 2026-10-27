DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='bansir_worker') THEN
  CREATE ROLE bansir_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA bansir TO bansir_worker;
GRANT EXECUTE ON FUNCTION bansir.tenant_id(),bansir.establishment_id() TO bansir_worker;

CREATE TABLE bansir.jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, establishment_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('notification','fiscal')), dedupe_key text NOT NULL,
 payload jsonb NOT NULL, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','done','dead')),
 attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 8 CHECK(max_attempts BETWEEN 1 AND 20),
 available_at timestamptz NOT NULL DEFAULT now(), lease_token uuid, leased_until timestamptz,
 last_error text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 FOREIGN KEY(tenant_id,establishment_id) REFERENCES bansir.establishments(tenant_id,id),
 UNIQUE(tenant_id,establishment_id,kind,dedupe_key)
);
CREATE INDEX jobs_poll ON bansir.jobs(kind,available_at) WHERE state IN ('pending','running');
CREATE TABLE bansir.push_devices (
 tenant_id uuid NOT NULL, establishment_id uuid NOT NULL, user_id uuid NOT NULL, device_id text NOT NULL,
 subscription jsonb NOT NULL, enabled boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,user_id,device_id),
 FOREIGN KEY(tenant_id,establishment_id,user_id) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id)
);
CREATE TABLE bansir.notifications (
 tenant_id uuid NOT NULL, establishment_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL, title text NOT NULL, body text NOT NULL, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,user_id) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id)
);
CREATE TABLE bansir.fiscal_certificates (
 tenant_id uuid NOT NULL, establishment_id uuid NOT NULL, encrypted_bundle text NOT NULL,
 subject text NOT NULL, cnpj text NOT NULL, fingerprint text NOT NULL, valid_from timestamptz NOT NULL,
 valid_until timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id), FOREIGN KEY(tenant_id,establishment_id) REFERENCES bansir.establishments(tenant_id,id)
);
CREATE TABLE bansir.fiscal_settings (
 tenant_id uuid NOT NULL, establishment_id uuid NOT NULL, data jsonb NOT NULL, encrypted_csc text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,establishment_id),
 FOREIGN KEY(tenant_id,establishment_id) REFERENCES bansir.fiscal_certificates(tenant_id,establishment_id)
);
CREATE TABLE bansir.fiscal_documents (
 tenant_id uuid NOT NULL, establishment_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 request_key text NOT NULL, environment integer NOT NULL CHECK(environment IN(1,2)), access_key text NOT NULL CHECK(access_key ~ '^[0-9]{44}$'),
 payload jsonb NOT NULL, status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','submitting','unknown','authorized','rejected','manual_review')),
 configuration_version text NOT NULL, certificate_fingerprint text NOT NULL,
 protocol text, rejection_code text, xml text, s3_key text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,id), UNIQUE(tenant_id,establishment_id,request_key), UNIQUE(environment,access_key),
 FOREIGN KEY(tenant_id,establishment_id) REFERENCES bansir.fiscal_settings(tenant_id,establishment_id)
);

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['jobs','push_devices','notifications','fiscal_certificates','fiscal_settings','fiscal_documents'] LOOP
  EXECUTE format('ALTER TABLE bansir.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE bansir.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY unit_runtime ON bansir.%I TO bansir_runtime USING(bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id))',tab);
  EXECUTE format('CREATE POLICY unit_worker ON bansir.%I TO bansir_worker USING(tenant_id=bansir.tenant_id() AND establishment_id=bansir.establishment_id()) WITH CHECK(tenant_id=bansir.tenant_id() AND establishment_id=bansir.establishment_id())',tab);
 END LOOP;
END $$;
-- User preferences and inbox are private even from other members of the same unit.
CREATE POLICY own_device ON bansir.push_devices AS RESTRICTIVE TO bansir_runtime
 USING(user_id=bansir.actor_id()) WITH CHECK(user_id=bansir.actor_id());
CREATE POLICY own_notification ON bansir.notifications AS RESTRICTIVE TO bansir_runtime
 USING(user_id=bansir.actor_id()) WITH CHECK(user_id=bansir.actor_id());
GRANT SELECT,INSERT ON bansir.jobs,bansir.notifications,bansir.fiscal_documents TO bansir_runtime;
GRANT UPDATE(read_at) ON bansir.notifications TO bansir_runtime;
GRANT SELECT,INSERT,UPDATE ON bansir.push_devices,bansir.fiscal_certificates,bansir.fiscal_settings TO bansir_runtime;
GRANT SELECT ON bansir.jobs,bansir.push_devices,bansir.fiscal_certificates,bansir.fiscal_settings TO bansir_worker;
GRANT SELECT,UPDATE ON bansir.fiscal_documents TO bansir_worker;
GRANT UPDATE(enabled) ON bansir.push_devices TO bansir_worker;

-- Only these functions can cross unit boundaries to claim/finish a lease. PUBLIC cannot execute them.
CREATE FUNCTION bansir.claim_job(job_kind text) RETURNS SETOF bansir.jobs
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
 WITH candidate AS (
  SELECT id FROM bansir.jobs WHERE kind=job_kind AND attempts<max_attempts AND
   ((state='pending' AND available_at<=now()) OR (state='running' AND leased_until<now()))
  ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1
 ) UPDATE bansir.jobs j SET state='running',attempts=attempts+1,lease_token=gen_random_uuid(),leased_until=now()+interval '3 minutes'
 FROM candidate c WHERE j.id=c.id RETURNING j.*
$$;
CREATE FUNCTION bansir.finish_job(job_id uuid, token uuid, outcome text, error_code text DEFAULT NULL) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
BEGIN
 IF outcome NOT IN('done','retry','dead') THEN RAISE EXCEPTION 'Invalid outcome'; END IF;
 UPDATE bansir.jobs SET state=CASE WHEN outcome='retry' AND attempts<max_attempts THEN 'pending' WHEN outcome='done' THEN 'done' ELSE 'dead' END,
  available_at=now()+make_interval(secs=>least(3600,power(2,attempts)::integer*5)),
  last_error=left(error_code,80),completed_at=CASE WHEN outcome='done' THEN now() ELSE NULL END,
  leased_until=NULL,lease_token=NULL
 WHERE id=job_id AND state='running' AND lease_token=token AND leased_until>now();
 RETURN FOUND;
END $$;
-- An exhausted expired lease must remain visible for operator reconciliation.
CREATE FUNCTION bansir.reap_jobs() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
 UPDATE bansir.jobs SET state='dead',last_error='LEASE_EXHAUSTED' WHERE state='running' AND leased_until<now() AND attempts>=max_attempts
$$;
REVOKE ALL ON FUNCTION bansir.claim_job(text),bansir.finish_job(uuid,uuid,text,text),bansir.reap_jobs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.claim_job(text),bansir.finish_job(uuid,uuid,text,text),bansir.reap_jobs() TO bansir_worker;

-- Recheck active membership immediately before delivery, without exposing global user records to workers.
CREATE FUNCTION bansir.push_recipient_active(t uuid,e uuid,u uuid) RETURNS boolean
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
 SELECT EXISTS(SELECT 1 FROM bansir.establishment_memberships em JOIN bansir.tenant_memberships tm USING(tenant_id,user_id)
 JOIN bansir.users usr ON usr.id=em.user_id JOIN bansir.tenants ten ON ten.id=em.tenant_id
 JOIN bansir.establishments est ON est.tenant_id=em.tenant_id AND est.id=em.establishment_id
 WHERE em.tenant_id=t AND em.establishment_id=e AND em.user_id=u AND em.active AND tm.active AND usr.active AND ten.active AND est.active)
$$;
REVOKE ALL ON FUNCTION bansir.push_recipient_active(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.push_recipient_active(uuid,uuid,uuid) TO bansir_worker;
