ALTER TABLE bansir.products ADD COLUMN fulfillment_pricing jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(fulfillment_pricing)='object');
ALTER TABLE bansir.products ADD COLUMN gas_do_povo boolean NOT NULL DEFAULT false;
ALTER TABLE bansir.products ADD COLUMN gas_do_povo_delivery boolean NOT NULL DEFAULT false;
ALTER TABLE bansir.storefront_orders ADD COLUMN pricing_context jsonb NOT NULL DEFAULT '{}';
GRANT SELECT(fulfillment_pricing,gas_do_povo,gas_do_povo_delivery) ON bansir.products TO bansir_storefront;
GRANT INSERT(pricing_context) ON bansir.storefront_orders TO bansir_storefront;

CREATE FUNCTION bansir.guard_product_delivery_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed boolean; BEGIN
 changed:=NEW.fulfillment_pricing<>'{}'::jsonb OR NEW.gas_do_povo OR NEW.gas_do_povo_delivery;
 IF TG_OP='UPDATE' THEN changed:=(OLD.fulfillment_pricing,OLD.gas_do_povo,OLD.gas_do_povo_delivery) IS DISTINCT FROM (NEW.fulfillment_pricing,NEW.gas_do_povo,NEW.gas_do_povo_delivery); END IF;
 IF changed AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND(rolsuper OR rolbypassrls)) AND NOT EXISTS(SELECT 1 FROM bansir.establishments WHERE tenant_id=NEW.tenant_id AND id=NEW.establishment_id AND owner_user_id=bansir.actor_id()) THEN
  RAISE EXCEPTION 'Somente o dono pode configurar preços de entrega e Gás do Povo' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bansir.guard_product_delivery_owner() FROM PUBLIC;
CREATE TRIGGER product_delivery_owner BEFORE INSERT OR UPDATE ON bansir.products FOR EACH ROW EXECUTE FUNCTION bansir.guard_product_delivery_owner();

-- Reuse the existing owner guard for the calendar that controls promotions.
CREATE FUNCTION bansir.guard_storefront_timezone_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND coalesce(OLD.config->>'timeZone','America/Cuiaba') IS DISTINCT FROM coalesce(NEW.config->>'timeZone','America/Cuiaba') AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND(rolsuper OR rolbypassrls)) AND NOT EXISTS(SELECT 1 FROM bansir.establishments WHERE tenant_id=NEW.tenant_id AND id=NEW.establishment_id AND owner_user_id=bansir.actor_id()) THEN
  RAISE EXCEPTION 'Somente o dono pode configurar o fuso das promoções' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bansir.guard_storefront_timezone_owner() FROM PUBLIC;
CREATE TRIGGER storefront_timezone_owner BEFORE UPDATE ON bansir.storefronts FOR EACH ROW EXECUTE FUNCTION bansir.guard_storefront_timezone_owner();
