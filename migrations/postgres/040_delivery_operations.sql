ALTER TABLE bansir.deliverers ADD COLUMN user_id uuid;
ALTER TABLE bansir.deliverers ADD CONSTRAINT deliverer_account_fk FOREIGN KEY(tenant_id,establishment_id,user_id) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id);
CREATE UNIQUE INDEX deliverer_account_unique ON bansir.deliverers(tenant_id,establishment_id,user_id) WHERE user_id IS NOT NULL;
CREATE FUNCTION bansir.delivery_accounts() RETURNS TABLE(id uuid,name text,email text,active boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
DECLARE t uuid:=bansir.tenant_id();e uuid:=bansir.establishment_id();
BEGIN
 IF NOT bansir.can_access_establishment(t,e) OR NOT EXISTS(SELECT 1 FROM bansir.establishment_memberships m
  WHERE m.tenant_id=t AND m.establishment_id=e AND m.user_id=bansir.actor_id() AND m.active AND
  (m.role IN('admin','superadmin') OR 'deliveries-manage'=ANY(m.allowed_routes) OR 'sales-manage'=ANY(m.allowed_routes)
   OR ('dashboard'=ANY(m.allowed_routes) AND 'delivery-monitor'=ANY(m.allowed_routes)))) THEN
  RAISE EXCEPTION 'Delivery access denied' USING ERRCODE='42501';
 END IF;
 RETURN QUERY SELECT u.id,u.name,u.email,(u.active AND m.active AND tm.active) FROM bansir.establishment_memberships m
 JOIN bansir.users u ON u.id=m.user_id JOIN bansir.tenant_memberships tm ON(tm.tenant_id,tm.user_id)=(m.tenant_id,m.user_id)
 WHERE m.tenant_id=t AND m.establishment_id=e AND(m.role='entregador' OR 'my-deliveries'=ANY(m.allowed_routes));
END $$;
REVOKE ALL ON FUNCTION bansir.delivery_accounts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.delivery_accounts() TO bansir_runtime;
ALTER TABLE bansir.storefront_orders ADD COLUMN delivery_location jsonb;
GRANT INSERT(delivery_location) ON bansir.storefront_orders TO bansir_storefront;
CREATE TABLE bansir.delivery_tasks(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,sale_id uuid NOT NULL,driver_id uuid,
 status text NOT NULL CHECK(status IN('unverified','pending','assigned','en_route','delivered','failed','cancelled')),
 address text NOT NULL,latitude double precision,longitude double precision,accuracy double precision,
 destination_source text NOT NULL DEFAULT 'address',version integer NOT NULL DEFAULT 1,
 departed_at timestamptz,delivered_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,sale_id),
 FOREIGN KEY(tenant_id,establishment_id,sale_id) REFERENCES bansir.sales(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,driver_id) REFERENCES bansir.deliverers(tenant_id,establishment_id,id),
 CHECK((latitude IS NULL)=(longitude IS NULL)),CHECK(latitude BETWEEN -90 AND 90),CHECK(longitude BETWEEN -180 AND 180)
);
CREATE TABLE bansir.driver_work(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,driver_id uuid NOT NULL,
 on_duty boolean NOT NULL DEFAULT false,active boolean NOT NULL DEFAULT false,user_id uuid NOT NULL,session_id uuid NOT NULL REFERENCES bansir.access_sessions(id),collector_hash text,started_at timestamptz,ended_at timestamptz,
 gps_state text NOT NULL DEFAULT 'stopped' CHECK(gps_state IN('waiting','ok','denied','unavailable','timeout','background','stopped')),
 latitude double precision,longitude double precision,accuracy double precision,captured_at timestamptz,received_at timestamptz,
 sequence integer NOT NULL DEFAULT 0,point_hash text,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,driver_id),
 FOREIGN KEY(tenant_id,establishment_id,driver_id) REFERENCES bansir.deliverers(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,user_id) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id),
 CHECK(latitude BETWEEN -90 AND 90),CHECK(longitude BETWEEN -180 AND 180),CHECK(accuracy>=0),CHECK((latitude IS NULL)=(longitude IS NULL))
);
-- Operational audit contains status/reason, never coordinates or location history.
CREATE TABLE bansir.delivery_events(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),sale_id uuid,user_id uuid NOT NULL,
 request_key uuid NOT NULL,request_hash text NOT NULL,action text NOT NULL,reason text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,id),UNIQUE(tenant_id,establishment_id,request_key),
 FOREIGN KEY(tenant_id,establishment_id,sale_id) REFERENCES bansir.delivery_tasks(tenant_id,establishment_id,sale_id),
 FOREIGN KEY(tenant_id,establishment_id,user_id) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id)
);
DO $$ DECLARE tab text;BEGIN
 FOREACH tab IN ARRAY ARRAY['delivery_tasks','driver_work','delivery_events'] LOOP
  EXECUTE format('ALTER TABLE bansir.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE bansir.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY delivery_unit ON bansir.%I TO bansir_runtime USING(bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id))',tab);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON bansir.delivery_tasks,bansir.driver_work TO bansir_runtime;
GRANT SELECT,INSERT ON bansir.delivery_events TO bansir_runtime;
CREATE INDEX delivery_tasks_driver ON bansir.delivery_tasks(tenant_id,establishment_id,driver_id,status);
INSERT INTO bansir.delivery_tasks(tenant_id,establishment_id,sale_id,driver_id,status,address)
 SELECT tenant_id,establishment_id,id,delivery_employee_id,'unverified',delivery_address FROM bansir.sales WHERE delivery_mode='delivery';
CREATE FUNCTION bansir.create_delivery_task() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bansir AS $$
BEGIN
 IF NEW.delivery_mode='delivery' THEN
  INSERT INTO bansir.delivery_tasks(tenant_id,establishment_id,sale_id,driver_id,status,address)
   VALUES(NEW.tenant_id,NEW.establishment_id,NEW.id,NEW.delivery_employee_id,CASE WHEN NEW.delivery_employee_id IS NULL THEN 'pending' ELSE 'assigned' END,NEW.delivery_address);
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bansir.create_delivery_task() FROM PUBLIC;
CREATE TRIGGER create_delivery_task AFTER INSERT ON bansir.sales FOR EACH ROW EXECUTE FUNCTION bansir.create_delivery_task();
CREATE FUNCTION bansir.cancel_delivery_task() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bansir AS $$
BEGIN
 UPDATE bansir.delivery_tasks SET status='cancelled',version=version+1,updated_at=now()
 WHERE(tenant_id,establishment_id,sale_id)=(NEW.tenant_id,NEW.establishment_id,NEW.sale_id) AND status<>'cancelled';RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bansir.cancel_delivery_task() FROM PUBLIC;
CREATE TRIGGER cancel_delivery_task AFTER INSERT ON bansir.sale_cancellations FOR EACH ROW EXECUTE FUNCTION bansir.cancel_delivery_task();
UPDATE bansir.delivery_tasks d SET status='cancelled' WHERE EXISTS(SELECT 1 FROM bansir.sale_cancellations x WHERE(x.tenant_id,x.establishment_id,x.sale_id)=(d.tenant_id,d.establishment_id,d.sale_id));
CREATE FUNCTION bansir.signal_delivery_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bansir AS $$
BEGIN
 PERFORM pg_notify('bansir_notification_events',json_build_object('delivery',true,'tenantId',NEW.tenant_id,'establishmentId',NEW.establishment_id)::text);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION bansir.signal_delivery_change() FROM PUBLIC;
CREATE TRIGGER signal_delivery_task AFTER INSERT OR UPDATE ON bansir.delivery_tasks FOR EACH ROW EXECUTE FUNCTION bansir.signal_delivery_change();
CREATE TRIGGER signal_driver_work AFTER INSERT OR UPDATE ON bansir.driver_work FOR EACH ROW EXECUTE FUNCTION bansir.signal_delivery_change();

CREATE FUNCTION bansir.stop_driver_on_session_end() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bansir AS $$
BEGIN
 IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
  UPDATE bansir.driver_work SET active=false,gps_state='stopped',latitude=NULL,longitude=NULL,accuracy=NULL,captured_at=NULL,received_at=NULL,point_hash=NULL,updated_at=now() WHERE session_id=NEW.id;
 END IF;RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION bansir.stop_driver_on_session_end() FROM PUBLIC;
CREATE TRIGGER stop_driver_on_session_end AFTER UPDATE OF revoked_at ON bansir.access_sessions FOR EACH ROW EXECUTE FUNCTION bansir.stop_driver_on_session_end();
