CREATE TABLE bansir.bridge_credentials(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES bansir.users(id),token_hash text NOT NULL UNIQUE,label text NOT NULL,
 installation_id text,last_machine text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '1 year',revoked_at timestamptz,last_used_at timestamptz,
 PRIMARY KEY(tenant_id,establishment_id,id),FOREIGN KEY(tenant_id,establishment_id) REFERENCES bansir.establishments(tenant_id,id));
CREATE TABLE bansir.bridge_terminals(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),data jsonb NOT NULL,
 PRIMARY KEY(tenant_id,establishment_id,id),FOREIGN KEY(tenant_id,establishment_id) REFERENCES bansir.establishments(tenant_id,id));
DO $$ DECLARE tab text;BEGIN FOREACH tab IN ARRAY ARRAY['bridge_credentials','bridge_terminals'] LOOP
 EXECUTE format('ALTER TABLE bansir.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE bansir.%I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('CREATE POLICY unit_runtime ON bansir.%I TO bansir_runtime USING(bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id))',tab);
END LOOP;END $$;
GRANT SELECT,INSERT ON bansir.bridge_credentials TO bansir_runtime;
GRANT UPDATE(revoked_at) ON bansir.bridge_credentials TO bansir_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON bansir.bridge_terminals TO bansir_runtime;
CREATE FUNCTION bansir.bridge_auth(h text, installation text DEFAULT NULL,machine text DEFAULT '') RETURNS TABLE(id uuid,tenant_id uuid,establishment_id uuid,user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
BEGIN
 RETURN QUERY UPDATE bansir.bridge_credentials b SET last_used_at=now(),installation_id=coalesce(b.installation_id,installation),last_machine=CASE WHEN installation IS NOT NULL THEN left(machine,100) ELSE b.last_machine END
 WHERE b.token_hash=h AND b.revoked_at IS NULL AND b.expires_at>now()
 AND (installation IS NULL OR b.installation_id IS NULL OR b.installation_id=installation)
 AND bansir.push_recipient_active(b.tenant_id,b.establishment_id,b.user_id)
 AND EXISTS(SELECT 1 FROM bansir.establishment_memberships em WHERE em.tenant_id=b.tenant_id AND em.establishment_id=b.establishment_id AND em.user_id=b.user_id AND em.role IN('admin','superadmin'))
 RETURNING b.id,b.tenant_id,b.establishment_id,b.user_id;
END $$;
REVOKE ALL ON FUNCTION bansir.bridge_auth(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.bridge_auth(text,text,text) TO bansir_runtime;
