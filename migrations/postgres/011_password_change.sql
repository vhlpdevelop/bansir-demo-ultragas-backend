ALTER TABLE bansir.users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE bansir.tenants ADD COLUMN legal_name text NOT NULL DEFAULT '';
ALTER TABLE bansir.establishments ADD COLUMN legal_name text NOT NULL DEFAULT '';
CREATE FUNCTION bansir.lock_own_password() RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
 SELECT password_hash FROM bansir.users WHERE id=bansir.actor_id() AND active FOR UPDATE
$$;
REVOKE ALL ON FUNCTION bansir.lock_own_password() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.lock_own_password() TO bansir_runtime;
CREATE FUNCTION bansir.change_own_password(previous_hash text,new_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
DECLARE actor uuid:=bansir.actor_id();
BEGIN
 IF new_hash !~ '^\$2[aby]\$12\$[./A-Za-z0-9]{53}$' THEN RAISE EXCEPTION 'Invalid password hash'; END IF;
 UPDATE bansir.users SET password_hash=new_hash,must_change_password=false
  WHERE id=actor AND active AND password_hash=previous_hash;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE bansir.access_sessions SET revoked_at=now() WHERE user_id=actor AND revoked_at IS NULL;
 UPDATE bansir.selection_requests SET consumed_at=now() WHERE user_id=actor AND consumed_at IS NULL;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION bansir.change_own_password(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.change_own_password(text,text) TO bansir_runtime;
