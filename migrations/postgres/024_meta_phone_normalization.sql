CREATE FUNCTION bansir.normalize_meta_message_phone() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
BEGIN
 IF left(NEW.phone,2)='55' AND length(NEW.phone) IN(12,13) THEN NEW.phone:=coalesce(bansir.normalize_customer_phone(NEW.phone),NEW.phone); END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bansir.normalize_meta_message_phone() FROM PUBLIC;
CREATE TRIGGER normalize_meta_phone BEFORE INSERT ON bansir.meta_messages FOR EACH ROW EXECUTE FUNCTION bansir.normalize_meta_message_phone();
UPDATE bansir.meta_messages SET phone=bansir.normalize_customer_phone(phone) WHERE left(phone,2)='55' AND length(phone) IN(12,13) AND bansir.normalize_customer_phone(phone) IS NOT NULL AND phone<>bansir.normalize_customer_phone(phone);
