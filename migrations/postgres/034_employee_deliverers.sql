ALTER TABLE bansir.deliverers ADD COLUMN employee_id uuid;
ALTER TABLE bansir.deliverers ADD CONSTRAINT deliverer_employee_fk FOREIGN KEY(tenant_id,establishment_id,employee_id) REFERENCES bansir.employees(tenant_id,establishment_id,id);
ALTER TABLE bansir.deliverers ADD CONSTRAINT deliverer_employee_unique UNIQUE(tenant_id,establishment_id,employee_id);
CREATE FUNCTION bansir.sync_employee_deliverer() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bansir AS $$
BEGIN
 IF lower(trim(NEW.role_title))='entregador' THEN
  INSERT INTO bansir.deliverers(tenant_id,establishment_id,employee_id,name,phone,active)
  VALUES(NEW.tenant_id,NEW.establishment_id,NEW.id,NEW.name,coalesce(bansir.normalize_customer_phone(NEW.phone),regexp_replace(NEW.phone,'\D','','g')),NEW.active)
  ON CONFLICT(tenant_id,establishment_id,employee_id) DO UPDATE SET name=excluded.name,phone=excluded.phone,active=excluded.active;
 ELSE
  UPDATE bansir.deliverers SET active=false WHERE tenant_id=NEW.tenant_id AND establishment_id=NEW.establishment_id AND employee_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bansir.sync_employee_deliverer() FROM PUBLIC;
CREATE TRIGGER employee_delivery_sync AFTER INSERT OR UPDATE OF name,phone,role_title,active ON bansir.employees FOR EACH ROW EXECUTE FUNCTION bansir.sync_employee_deliverer();
INSERT INTO bansir.deliverers(tenant_id,establishment_id,employee_id,name,phone,active)
SELECT tenant_id,establishment_id,id,name,coalesce(bansir.normalize_customer_phone(phone),regexp_replace(phone,'\D','','g')),active FROM bansir.employees WHERE lower(trim(role_title))='entregador';
