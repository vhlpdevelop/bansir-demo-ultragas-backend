ALTER TABLE bansir.deliverers ADD COLUMN map_color_index integer;
WITH numbered AS(SELECT tenant_id,establishment_id,id,row_number() OVER(PARTITION BY tenant_id,establishment_id ORDER BY id)::integer AS n FROM bansir.deliverers) UPDATE bansir.deliverers d SET map_color_index=n.n FROM numbered n WHERE(d.tenant_id,d.establishment_id,d.id)=(n.tenant_id,n.establishment_id,n.id);
ALTER TABLE bansir.deliverers ALTER COLUMN map_color_index SET NOT NULL;
CREATE UNIQUE INDEX deliverer_map_color ON bansir.deliverers(tenant_id,establishment_id,map_color_index);
CREATE FUNCTION bansir.set_deliverer_color() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bansir AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('delivery-color:'||NEW.tenant_id::text||':'||NEW.establishment_id::text,0));
 SELECT coalesce(max(map_color_index),0)+1 INTO NEW.map_color_index FROM bansir.deliverers WHERE tenant_id=NEW.tenant_id AND establishment_id=NEW.establishment_id;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bansir.set_deliverer_color() FROM PUBLIC;
CREATE TRIGGER set_deliverer_color BEFORE INSERT ON bansir.deliverers FOR EACH ROW EXECUTE FUNCTION bansir.set_deliverer_color();
ALTER TABLE bansir.delivery_tasks ADD COLUMN route_order integer CHECK(route_order>0);
WITH numbered AS(SELECT tenant_id,establishment_id,sale_id,row_number() OVER(PARTITION BY tenant_id,establishment_id,driver_id ORDER BY (status='en_route') DESC,created_at,sale_id)::integer AS n FROM bansir.delivery_tasks WHERE driver_id IS NOT NULL AND status IN('assigned','en_route')) UPDATE bansir.delivery_tasks t SET route_order=n.n FROM numbered n WHERE(t.tenant_id,t.establishment_id,t.sale_id)=(n.tenant_id,n.establishment_id,n.sale_id);
CREATE FUNCTION bansir.set_delivery_route_order() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bansir AS $$
BEGIN
 IF NEW.driver_id IS NULL THEN NEW.route_order=NULL;RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND NEW.driver_id IS NOT DISTINCT FROM OLD.driver_id AND NEW.route_order IS NOT NULL THEN RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('delivery-routes:'||NEW.tenant_id::text||':'||NEW.establishment_id::text,0));
 SELECT coalesce(max(route_order),0)+1 INTO NEW.route_order FROM bansir.delivery_tasks WHERE tenant_id=NEW.tenant_id AND establishment_id=NEW.establishment_id AND driver_id=NEW.driver_id AND status IN('assigned','en_route');RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bansir.set_delivery_route_order() FROM PUBLIC;
CREATE TRIGGER set_delivery_route_order BEFORE INSERT OR UPDATE OF driver_id,route_order ON bansir.delivery_tasks FOR EACH ROW EXECUTE FUNCTION bansir.set_delivery_route_order();

CREATE OR REPLACE FUNCTION bansir.delivery_accounts() RETURNS TABLE(id uuid,name text,email text,active boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
DECLARE t uuid:=bansir.tenant_id();e uuid:=bansir.establishment_id();
BEGIN
 IF NOT bansir.can_access_establishment(t,e) OR NOT EXISTS(SELECT 1 FROM bansir.establishment_memberships m
  WHERE m.tenant_id=t AND m.establishment_id=e AND m.user_id=bansir.actor_id() AND m.active AND
  (m.role IN('admin','superadmin') OR 'deliveries-manage'=ANY(m.allowed_routes) OR 'sales-manage'=ANY(m.allowed_routes) OR 'sales'=ANY(m.allowed_routes)
   OR ('dashboard'=ANY(m.allowed_routes) AND 'delivery-monitor'=ANY(m.allowed_routes)))) THEN
  RAISE EXCEPTION 'Delivery access denied' USING ERRCODE='42501';
 END IF;
 RETURN QUERY SELECT u.id,u.name,u.email,(u.active AND m.active AND tm.active) FROM bansir.establishment_memberships m
 JOIN bansir.users u ON u.id=m.user_id JOIN bansir.tenant_memberships tm ON(tm.tenant_id,tm.user_id)=(m.tenant_id,m.user_id)
 WHERE m.tenant_id=t AND m.establishment_id=e AND(m.role='entregador' OR 'my-deliveries'=ANY(m.allowed_routes) OR 'my-deliveries-history'=ANY(m.allowed_routes));
END $$;

