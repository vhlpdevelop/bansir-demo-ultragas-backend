-- Keep 016/017 immutable; correct integration in a forward migration.
GRANT DELETE ON bansir.vehicles TO bansir_runtime;
ALTER TABLE bansir.vouchers ADD COLUMN request_key uuid;
ALTER TABLE bansir.vouchers ADD COLUMN request_hash text;
ALTER TABLE bansir.vouchers ADD COLUMN sale_id uuid;
ALTER TABLE bansir.vouchers ADD CONSTRAINT voucher_sale_fk FOREIGN KEY(tenant_id,establishment_id,sale_id) REFERENCES bansir.sales(tenant_id,establishment_id,id);
CREATE UNIQUE INDEX voucher_request ON bansir.vouchers(tenant_id,establishment_id,request_key) WHERE request_key IS NOT NULL;
CREATE UNIQUE INDEX voucher_sale ON bansir.vouchers(tenant_id,establishment_id,sale_id) WHERE sale_id IS NOT NULL;
CREATE FUNCTION bansir.cancel_sale_voucher() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 UPDATE bansir.vouchers SET status='CANCELLED' WHERE tenant_id=NEW.tenant_id AND establishment_id=NEW.establishment_id AND sale_id=NEW.sale_id;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bansir.cancel_sale_voucher() FROM PUBLIC;
CREATE TRIGGER cancel_sale_voucher AFTER INSERT ON bansir.sale_cancellations FOR EACH ROW EXECUTE FUNCTION bansir.cancel_sale_voucher();
CREATE TABLE bansir.meta_accounts(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,phone_number_id text NOT NULL UNIQUE,waba_id text NOT NULL,encrypted_token text NOT NULL,enabled boolean NOT NULL DEFAULT true,
 display_phone text NOT NULL DEFAULT '',template_language text NOT NULL DEFAULT 'pt_BR',voucher_template text NOT NULL DEFAULT '',delivery_template text NOT NULL DEFAULT '',updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id),FOREIGN KEY(tenant_id,establishment_id) REFERENCES bansir.establishments(tenant_id,id)
);
CREATE TABLE bansir.meta_messages(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,message_id text NOT NULL,direction text NOT NULL CHECK(direction IN('in','out')),phone text NOT NULL,body text NOT NULL DEFAULT '',status text NOT NULL,job_id uuid,received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,message_id),FOREIGN KEY(tenant_id,establishment_id) REFERENCES bansir.establishments(tenant_id,id)
);
DO $$ DECLARE tab text;BEGIN FOREACH tab IN ARRAY ARRAY['meta_accounts','meta_messages'] LOOP
 EXECUTE format('ALTER TABLE bansir.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE bansir.%I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('CREATE POLICY unit_runtime ON bansir.%I TO bansir_runtime USING(bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id))',tab);
 EXECUTE format('CREATE POLICY unit_worker ON bansir.%I TO bansir_worker USING(tenant_id=bansir.tenant_id() AND establishment_id=bansir.establishment_id()) WITH CHECK(tenant_id=bansir.tenant_id() AND establishment_id=bansir.establishment_id())',tab);
 END LOOP;END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON bansir.meta_accounts TO bansir_runtime;
GRANT SELECT ON bansir.meta_messages TO bansir_runtime;
GRANT SELECT ON bansir.meta_accounts TO bansir_worker;
GRANT SELECT,INSERT,UPDATE ON bansir.meta_messages TO bansir_worker;
-- Verified webhooks enter only through this narrowly scoped worker function.
CREATE FUNCTION bansir.meta_receiver(phone_id text) RETURNS TABLE(tenant_id uuid,establishment_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
 SELECT a.tenant_id,a.establishment_id FROM bansir.meta_accounts a JOIN bansir.establishments e ON(e.tenant_id,e.id)=(a.tenant_id,a.establishment_id) JOIN bansir.tenants t ON t.id=a.tenant_id WHERE a.enabled AND e.active AND t.active AND a.phone_number_id=phone_id
$$;
REVOKE ALL ON FUNCTION bansir.meta_receiver(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.meta_receiver(text) TO bansir_worker;

CREATE TABLE bansir.meta_contacts(tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,phone text NOT NULL,opt_in boolean NOT NULL DEFAULT false,consent_by uuid NOT NULL,consent_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,establishment_id,phone),FOREIGN KEY(tenant_id,establishment_id,consent_by) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id));
ALTER TABLE bansir.meta_contacts ENABLE ROW LEVEL SECURITY;ALTER TABLE bansir.meta_contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY unit_runtime ON bansir.meta_contacts TO bansir_runtime USING(bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id));
CREATE POLICY unit_worker ON bansir.meta_contacts TO bansir_worker USING(tenant_id=bansir.tenant_id() AND establishment_id=bansir.establishment_id());
GRANT SELECT,INSERT,UPDATE ON bansir.meta_contacts TO bansir_runtime;GRANT SELECT ON bansir.meta_contacts TO bansir_worker;
CREATE FUNCTION bansir.meta_ingest(pid text,waba text,mid text,dir text,contact text,txt text,st text,event_at timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$ DECLARE a record;BEGIN
 SELECT ma.* INTO a FROM bansir.meta_accounts ma JOIN bansir.establishments e ON(e.tenant_id,e.id)=(ma.tenant_id,ma.establishment_id) JOIN bansir.tenants t ON t.id=ma.tenant_id WHERE ma.phone_number_id=pid AND ma.waba_id=waba AND ma.enabled AND e.active AND t.active;
 IF NOT FOUND THEN RETURN;END IF;
 IF dir NOT IN('in','out') OR length(mid)>300 OR length(contact)>20 OR length(txt)>4000 OR length(st)>30 OR event_at>now()+interval '5 minutes' THEN RAISE EXCEPTION 'Invalid webhook';END IF;
 INSERT INTO bansir.meta_messages(tenant_id,establishment_id,message_id,direction,phone,body,status,received_at) VALUES(a.tenant_id,a.establishment_id,mid,dir,contact,txt,st,event_at)
 ON CONFLICT(tenant_id,establishment_id,message_id) DO UPDATE SET status=CASE WHEN bansir.meta_messages.status='read' OR (bansir.meta_messages.status='delivered' AND EXCLUDED.status='sent') THEN bansir.meta_messages.status ELSE EXCLUDED.status END,received_at=greatest(bansir.meta_messages.received_at,EXCLUDED.received_at) WHERE bansir.meta_messages.direction=EXCLUDED.direction;
END $$;
REVOKE ALL ON FUNCTION bansir.meta_ingest(text,text,text,text,text,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.meta_ingest(text,text,text,text,text,text,text,timestamptz) TO bansir_runtime;

CREATE FUNCTION bansir.meta_sender_active(t uuid,e uuid,u uuid,permission text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
 SELECT EXISTS(SELECT 1 FROM bansir.establishment_memberships m JOIN bansir.tenant_memberships tm ON tm.tenant_id=m.tenant_id AND tm.user_id=m.user_id JOIN bansir.users usr ON usr.id=m.user_id JOIN bansir.establishments est ON(est.tenant_id,est.id)=(m.tenant_id,m.establishment_id) JOIN bansir.tenants tenant ON tenant.id=m.tenant_id WHERE m.tenant_id=t AND m.establishment_id=e AND m.user_id=u AND m.active AND tm.active AND usr.active AND est.active AND tenant.active AND(permission IN('settings','sales','valegas')) AND(m.role IN('admin','superadmin') OR EXISTS(SELECT 1 FROM unnest(m.allowed_routes) AS route WHERE route=permission OR (permission='valegas' AND route='valegas-issue') OR (permission<>'valegas' AND starts_with(route,permission||'-')))))
$$;
REVOKE ALL ON FUNCTION bansir.meta_sender_active(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.meta_sender_active(uuid,uuid,uuid,text) TO bansir_worker;
