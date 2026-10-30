ALTER TABLE bansir.deliverers ADD COLUMN map_color text
 CHECK(map_color IS NULL OR map_color ~ '^#[0-9a-fA-F]{6}$');
CREATE UNIQUE INDEX deliverer_custom_map_color ON bansir.deliverers(tenant_id,establishment_id,lower(map_color)) WHERE map_color IS NOT NULL;
CREATE TRIGGER signal_driver_color AFTER UPDATE OF map_color ON bansir.deliverers FOR EACH ROW WHEN (OLD.map_color IS DISTINCT FROM NEW.map_color) EXECUTE FUNCTION bansir.signal_delivery_change();
