-- Signals carry scope only. PostgreSQL delivers NOTIFY after commit.
CREATE FUNCTION bansir.signal_order_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,bansir AS $$
BEGIN
 PERFORM pg_notify('bansir_notification_events',json_build_object('orders',true,'tenantId',NEW.tenant_id,'establishmentId',NEW.establishment_id)::text);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION bansir.signal_order_change() FROM PUBLIC;
CREATE TRIGGER signal_storefront_order AFTER INSERT OR UPDATE ON bansir.storefront_orders FOR EACH ROW EXECUTE FUNCTION bansir.signal_order_change();
CREATE TRIGGER signal_storefront_location AFTER UPDATE ON bansir.storefronts FOR EACH ROW EXECUTE FUNCTION bansir.signal_order_change();
CREATE TRIGGER signal_storefront_conversation AFTER INSERT OR UPDATE ON bansir.meta_messages FOR EACH ROW EXECUTE FUNCTION bansir.signal_order_change();
