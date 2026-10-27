CREATE TABLE bansir.suppliers(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),
 data jsonb NOT NULL,active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,id),FOREIGN KEY(tenant_id,establishment_id) REFERENCES bansir.establishments(tenant_id,id)
);
CREATE UNIQUE INDEX supplier_document ON bansir.suppliers(tenant_id,establishment_id,(data->>'document')) WHERE data->>'document'<>'';
ALTER TABLE bansir.fiscal_certificates ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE bansir.fiscal_certificates ADD COLUMN name text NOT NULL DEFAULT 'Certificado A1';
ALTER TABLE bansir.fiscal_certificates ADD COLUMN expiry_notified_on date;
CREATE TABLE bansir.fiscal_recipients(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,user_id uuid NOT NULL,enabled boolean NOT NULL DEFAULT true,
 PRIMARY KEY(tenant_id,establishment_id,user_id),FOREIGN KEY(tenant_id,establishment_id,user_id) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id)
);
CREATE TABLE bansir.fiscal_monitors(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),cnpj text NOT NULL,uf text NOT NULL,environment integer NOT NULL CHECK(environment IN(1,2)),
 active boolean NOT NULL DEFAULT true,ult_nsu text NOT NULL DEFAULT '000000000000000',max_nsu text NOT NULL DEFAULT '000000000000000',
 next_poll_at timestamptz NOT NULL DEFAULT now(),last_polled_at timestamptz,last_status text,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,id),UNIQUE(tenant_id,establishment_id,cnpj,environment),FOREIGN KEY(tenant_id,establishment_id) REFERENCES bansir.establishments(tenant_id,id)
);
CREATE TABLE bansir.fiscal_inbound(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),monitor_id uuid NOT NULL,access_key text NOT NULL,
 supplier_cnpj text,supplier_name text,number text,issued_at timestamptz,total_cents bigint,status text NOT NULL,items jsonb NOT NULL DEFAULT '[]',encrypted_xml text,science_status text NOT NULL DEFAULT 'pending',science_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,id),UNIQUE(tenant_id,establishment_id,monitor_id,access_key),
 FOREIGN KEY(tenant_id,establishment_id,monitor_id) REFERENCES bansir.fiscal_monitors(tenant_id,establishment_id,id)
);
DO $$ DECLARE tab text; BEGIN FOREACH tab IN ARRAY ARRAY['suppliers','fiscal_recipients','fiscal_monitors','fiscal_inbound'] LOOP
 EXECUTE format('ALTER TABLE bansir.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE bansir.%I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('CREATE POLICY unit_runtime ON bansir.%I TO bansir_runtime USING(bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id))',tab);
 EXECUTE format('CREATE POLICY unit_worker ON bansir.%I TO bansir_worker USING(tenant_id=bansir.tenant_id() AND establishment_id=bansir.establishment_id()) WITH CHECK(tenant_id=bansir.tenant_id() AND establishment_id=bansir.establishment_id())',tab);
END LOOP;END $$;
GRANT SELECT,INSERT,UPDATE ON bansir.suppliers,bansir.fiscal_recipients,bansir.fiscal_monitors TO bansir_runtime;
GRANT SELECT ON bansir.fiscal_inbound TO bansir_runtime;
GRANT SELECT,INSERT,UPDATE ON bansir.suppliers,bansir.fiscal_inbound TO bansir_worker;
GRANT SELECT,UPDATE ON bansir.fiscal_monitors TO bansir_worker;

CREATE FUNCTION bansir.notify_fiscal(event_key text,event_title text,event_body text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
DECLARE t uuid:=bansir.tenant_id();e uuid:=bansir.establishment_id();r record;n uuid;j uuid;
BEGIN
 IF NOT pg_has_role(session_user,'bansir_worker','MEMBER') AND NOT bansir.can_access_establishment(t,e) THEN RAISE EXCEPTION 'Scope denied' USING ERRCODE='42501';END IF;
 FOR r IN SELECT em.user_id FROM bansir.establishment_memberships em JOIN bansir.users u ON u.id=em.user_id JOIN bansir.tenant_memberships tm ON tm.tenant_id=em.tenant_id AND tm.user_id=em.user_id
 LEFT JOIN bansir.fiscal_recipients p ON(p.tenant_id,p.establishment_id,p.user_id)=(em.tenant_id,em.establishment_id,em.user_id)
 WHERE em.tenant_id=t AND em.establishment_id=e AND em.active AND u.active AND tm.active AND coalesce(p.enabled,true)
 AND(em.role IN('admin','superadmin') OR 'fiscal-notify'=ANY(em.allowed_routes)) LOOP
  n:=gen_random_uuid();j:=NULL;
  INSERT INTO bansir.jobs(tenant_id,establishment_id,kind,dedupe_key,payload) VALUES(t,e,'notification','fiscal:'||event_key||':'||r.user_id,jsonb_build_object('category','fiscal','notificationId',n,'userId',r.user_id,'title',event_title,'body',event_body)) ON CONFLICT DO NOTHING RETURNING id INTO j;
  IF j IS NOT NULL THEN INSERT INTO bansir.notifications(tenant_id,establishment_id,id,user_id,title,body) VALUES(t,e,n,r.user_id,event_title,event_body);END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION bansir.notify_fiscal(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.notify_fiscal(text,text,text) TO bansir_worker;

CREATE FUNCTION bansir.schedule_fiscal_monitors() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
DECLARE m record; BEGIN
 FOR m IN SELECT c.* FROM bansir.fiscal_certificates c JOIN bansir.tenants t ON t.id=c.tenant_id JOIN bansir.establishments e ON(e.tenant_id,e.id)=(c.tenant_id,c.establishment_id)
 WHERE c.active AND t.active AND e.active AND c.valid_until<now()+interval '30 days' AND c.expiry_notified_on IS DISTINCT FROM current_date FOR UPDATE OF c SKIP LOCKED LOOP
  PERFORM set_config('app.tenant_id',m.tenant_id::text,true),set_config('app.establishment_id',m.establishment_id::text,true);
  PERFORM bansir.notify_fiscal('certificate:'||m.fingerprint||':'||current_date,'Certificado A1 precisa de atenção','Confira a validade do certificado nas configurações fiscais da loja.');
  UPDATE bansir.fiscal_certificates SET expiry_notified_on=current_date WHERE tenant_id=m.tenant_id AND establishment_id=m.establishment_id;
 END LOOP;
 FOR m IN SELECT fm.* FROM bansir.fiscal_monitors fm JOIN bansir.tenants t ON t.id=fm.tenant_id JOIN bansir.establishments e ON(e.tenant_id,e.id)=(fm.tenant_id,fm.establishment_id)
 WHERE fm.active AND t.active AND e.active AND fm.next_poll_at<=now() ORDER BY fm.next_poll_at LIMIT 10 FOR UPDATE OF fm SKIP LOCKED LOOP
  IF EXISTS(SELECT 1 FROM bansir.jobs WHERE tenant_id=m.tenant_id AND establishment_id=m.establishment_id AND kind='fiscal' AND payload->>'monitorId'=m.id::text AND state IN('pending','running')) THEN CONTINUE;END IF;
  INSERT INTO bansir.jobs(tenant_id,establishment_id,kind,dedupe_key,payload,max_attempts) VALUES(m.tenant_id,m.establishment_id,'fiscal','inbound:'||gen_random_uuid(),jsonb_build_object('action','inbound','monitorId',m.id),1);
  UPDATE bansir.fiscal_monitors SET next_poll_at=now()+interval '65 minutes' WHERE id=m.id;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION bansir.schedule_fiscal_monitors() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.schedule_fiscal_monitors() TO bansir_worker;
CREATE FUNCTION bansir.fiscal_recipient_allowed(t uuid,e uuid,u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
 SELECT EXISTS(SELECT 1 FROM bansir.establishment_memberships em JOIN bansir.users usr ON usr.id=em.user_id JOIN bansir.tenant_memberships tm ON tm.tenant_id=em.tenant_id AND tm.user_id=em.user_id
 LEFT JOIN bansir.fiscal_recipients p ON(p.tenant_id,p.establishment_id,p.user_id)=(em.tenant_id,em.establishment_id,em.user_id)
 WHERE em.tenant_id=t AND em.establishment_id=e AND em.user_id=u AND em.active AND tm.active AND usr.active AND coalesce(p.enabled,true) AND(em.role IN('admin','superadmin') OR 'fiscal-notify'=ANY(em.allowed_routes)))
$$;
REVOKE ALL ON FUNCTION bansir.fiscal_recipient_allowed(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.fiscal_recipient_allowed(uuid,uuid,uuid) TO bansir_worker;
CREATE FUNCTION bansir.fiscal_manifest_active(t uuid,e uuid,u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
 SELECT bansir.push_recipient_active(t,e,u) AND EXISTS(SELECT 1 FROM bansir.establishment_memberships WHERE tenant_id=t AND establishment_id=e AND user_id=u AND(role IN('admin','superadmin') OR 'fiscal-manifest'=ANY(allowed_routes)))
$$;
REVOKE ALL ON FUNCTION bansir.fiscal_manifest_active(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.fiscal_manifest_active(uuid,uuid,uuid) TO bansir_worker;
