-- Preserve access for existing tenants; platform can now explicitly disable delivery operations.
UPDATE bansir.tenant_contracts SET features=features||'{"deliveries":true}'::jsonb WHERE NOT features?'deliveries';
ALTER TABLE bansir.tenant_contracts ALTER COLUMN features SET DEFAULT '{"whatsapp":false,"orderLink":false,"financialIntelligence":false,"deliveries":true}';
CREATE OR REPLACE FUNCTION bansir.tenant_features() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
 SELECT jsonb_build_object(
 'whatsapp',t.active AND coalesce((c.features->>'whatsapp')::boolean,true),
 'orderLink',t.active AND coalesce((c.features->>'orderLink')::boolean,true),
 'financialIntelligence',t.active AND coalesce((c.features->>'financialIntelligence')::boolean,true),
 'deliveries',t.active AND coalesce((c.features->>'deliveries')::boolean,true))
 FROM bansir.tenants t LEFT JOIN bansir.tenant_contracts c ON c.tenant_id=t.id WHERE t.id=bansir.tenant_id()
$$;
CREATE FUNCTION bansir.stop_delivery_on_contract_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
BEGIN
 IF coalesce((NEW.features->>'deliveries')::boolean,true)=false THEN
  UPDATE bansir.driver_work SET active=false,on_duty=false,collector_hash=NULL,gps_state='stopped',latitude=NULL,longitude=NULL,accuracy=NULL,captured_at=NULL,received_at=NULL,point_hash=NULL,ended_at=now(),updated_at=now() WHERE tenant_id=NEW.tenant_id;
 END IF;RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION bansir.stop_delivery_on_contract_change() FROM PUBLIC;
CREATE TRIGGER stop_delivery_on_contract_change AFTER INSERT OR UPDATE OF features ON bansir.tenant_contracts FOR EACH ROW EXECUTE FUNCTION bansir.stop_delivery_on_contract_change();
CREATE INDEX delivery_tasks_driver_completed ON bansir.delivery_tasks(tenant_id,establishment_id,driver_id,delivered_at DESC) WHERE status='delivered';

CREATE OR REPLACE FUNCTION bansir.delivery_accounts() RETURNS TABLE(id uuid,name text,email text,active boolean)
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
 WHERE m.tenant_id=t AND m.establishment_id=e AND(m.role='entregador' OR 'my-deliveries'=ANY(m.allowed_routes) OR 'my-deliveries-history'=ANY(m.allowed_routes));
END $$;

-- Existing driver accounts retain access. Future changes use explicit RBAC switches.
UPDATE bansir.establishment_memberships SET allowed_routes=ARRAY(SELECT DISTINCT unnest(allowed_routes||ARRAY['my-deliveries','my-deliveries-history'])) WHERE role='entregador';
CREATE FUNCTION bansir.stop_driver_on_permission_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
BEGIN
 IF NOT NEW.active OR NOT('my-deliveries'=ANY(NEW.allowed_routes)) THEN
  UPDATE bansir.driver_work SET active=false,on_duty=false,collector_hash=NULL,gps_state='stopped',latitude=NULL,longitude=NULL,accuracy=NULL,captured_at=NULL,received_at=NULL,point_hash=NULL,ended_at=now(),updated_at=now() WHERE tenant_id=NEW.tenant_id AND establishment_id=NEW.establishment_id AND user_id=NEW.user_id;
 END IF;RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION bansir.stop_driver_on_permission_change() FROM PUBLIC;
CREATE TRIGGER stop_driver_on_permission_change AFTER UPDATE OF allowed_routes,active ON bansir.establishment_memberships FOR EACH ROW EXECUTE FUNCTION bansir.stop_driver_on_permission_change();
