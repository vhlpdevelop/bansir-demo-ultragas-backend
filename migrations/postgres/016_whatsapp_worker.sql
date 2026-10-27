-- WhatsApp sessions and outbound jobs are added as a new migration. Never edit
-- an already-applied migration: deployments may have recorded its checksum.
ALTER TABLE bansir.jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE bansir.jobs ADD CONSTRAINT jobs_kind_check CHECK(kind IN ('notification','fiscal','whatsapp'));

CREATE TABLE bansir.whatsapp_sessions (
 tenant_id uuid NOT NULL,
 establishment_id uuid NOT NULL,
 requested boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'DISCONNECTED' CHECK(status IN ('DISCONNECTED','SYNCING','WAITING_QR','CONNECTED','ERROR')),
 qr_code_url text,
 phone text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id),
 FOREIGN KEY(tenant_id,establishment_id) REFERENCES bansir.establishments(tenant_id,id)
);
ALTER TABLE bansir.whatsapp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bansir.whatsapp_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_runtime ON bansir.whatsapp_sessions TO bansir_runtime
 USING(bansir.can_access_establishment(tenant_id,establishment_id))
 WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id));
CREATE POLICY whatsapp_worker ON bansir.whatsapp_sessions TO bansir_worker
 USING(tenant_id=bansir.tenant_id() AND establishment_id=bansir.establishment_id())
 WITH CHECK(tenant_id=bansir.tenant_id() AND establishment_id=bansir.establishment_id());
GRANT SELECT,INSERT,UPDATE ON bansir.whatsapp_sessions TO bansir_runtime;
GRANT SELECT,UPDATE ON bansir.whatsapp_sessions TO bansir_worker;

CREATE FUNCTION bansir.list_requested_whatsapp_sessions() RETURNS TABLE(tenant_id uuid,establishment_id uuid)
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
 SELECT s.tenant_id,s.establishment_id FROM bansir.whatsapp_sessions AS s WHERE s.requested
$$;
REVOKE ALL ON FUNCTION bansir.list_requested_whatsapp_sessions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.list_requested_whatsapp_sessions() TO bansir_worker;
