CREATE FUNCTION bansir.signal_notification_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,bansir AS $$
DECLARE r record;
BEGIN
 IF TG_OP='DELETE' THEN r:=OLD;ELSE r:=NEW;END IF;
 PERFORM pg_notify('bansir_notification_events',json_build_object('tenantId',r.tenant_id,'establishmentId',r.establishment_id,'userId',r.user_id)::text);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION bansir.signal_notification_change() FROM PUBLIC;
CREATE TRIGGER signal_notification_change AFTER INSERT OR UPDATE OR DELETE ON bansir.notifications
 FOR EACH ROW EXECUTE FUNCTION bansir.signal_notification_change();

CREATE FUNCTION bansir.signal_session_revocation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,bansir AS $$
BEGIN
 IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
  PERFORM pg_notify('bansir_notification_events',json_build_object('sessionId',NEW.id)::text);
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION bansir.signal_session_revocation() FROM PUBLIC;
CREATE TRIGGER signal_session_revocation AFTER UPDATE OF revoked_at ON bansir.access_sessions
 FOR EACH ROW EXECUTE FUNCTION bansir.signal_session_revocation();
