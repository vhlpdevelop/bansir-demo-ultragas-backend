ALTER TABLE bansir.establishments ADD COLUMN owner_user_id uuid;
-- Runtime inherits the checkout group for SET ROLE. Public storefront discovery must
-- apply only after explicitly entering that role, never during private unit queries.
ALTER POLICY enabled_storefront ON bansir.storefronts USING(current_user='bansir_storefront' AND bansir.storefront_enabled(tenant_id,establishment_id));
ALTER TABLE bansir.establishments ADD CONSTRAINT establishment_owner_membership FOREIGN KEY(tenant_id,id,owner_user_id)
 REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id) DEFERRABLE INITIALLY DEFERRED;
-- Existing administrators are not silently promoted to owners. Assign explicitly through provisioning.
ALTER TABLE bansir.customers ADD COLUMN source_code text NOT NULL DEFAULT '';
ALTER TABLE bansir.customers ADD COLUMN import_metadata jsonb NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX customers_source_code ON bansir.customers(tenant_id,establishment_id,source_code) WHERE source_code<>'';
CREATE TABLE bansir.product_imports (
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,request_key uuid NOT NULL,
 source_sha256 text NOT NULL,request_hash text NOT NULL,created_by uuid NOT NULL REFERENCES bansir.users(id),
 result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,request_key),
 FOREIGN KEY(tenant_id,establishment_id) REFERENCES bansir.establishments(tenant_id,id)
);
ALTER TABLE bansir.product_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE bansir.product_imports FORCE ROW LEVEL SECURITY;
CREATE POLICY establishment_isolation ON bansir.product_imports TO bansir_runtime
 USING(bansir.can_access_establishment(tenant_id,establishment_id))
 WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id));
GRANT SELECT,INSERT ON bansir.product_imports TO bansir_runtime;

CREATE FUNCTION bansir.guard_shipping_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed boolean;
BEGIN
 changed := TG_OP='INSERT';
 IF TG_OP='UPDATE' THEN
  changed := (coalesce(OLD.config->'shippingMode','"regions"'::jsonb),coalesce(OLD.config->'fixedShippingCents','0'::jsonb),OLD.config->'zones',OLD.config->'allowPickup')
    IS DISTINCT FROM (coalesce(NEW.config->'shippingMode','"regions"'::jsonb),coalesce(NEW.config->'fixedShippingCents','0'::jsonb),NEW.config->'zones',NEW.config->'allowPickup');
 END IF;
 IF changed AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  IF NOT EXISTS(SELECT 1 FROM bansir.establishments e WHERE e.tenant_id=NEW.tenant_id AND e.id=NEW.establishment_id AND e.owner_user_id=bansir.actor_id()) THEN
   RAISE EXCEPTION 'Somente o dono pode configurar o frete' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bansir.guard_shipping_owner() FROM PUBLIC;
CREATE TRIGGER storefront_shipping_owner BEFORE INSERT OR UPDATE ON bansir.storefronts FOR EACH ROW EXECUTE FUNCTION bansir.guard_shipping_owner();
