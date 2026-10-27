CREATE FUNCTION bansir.renew_job(job_id uuid,token uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
BEGIN
 UPDATE bansir.jobs SET leased_until=now()+interval '3 minutes' WHERE id=job_id AND lease_token=token AND state='running' AND leased_until>now();
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION bansir.renew_job(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.renew_job(uuid,uuid) TO bansir_worker;

CREATE FUNCTION bansir.fiscal_emitter_active(t uuid,e uuid,u uuid) RETURNS boolean
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
 SELECT bansir.push_recipient_active(t,e,u) AND EXISTS(SELECT 1 FROM bansir.establishment_memberships
 WHERE tenant_id=t AND establishment_id=e AND user_id=u AND (role IN('admin','superadmin') OR 'fiscal'=ANY(allowed_routes)))
$$;
REVOKE ALL ON FUNCTION bansir.fiscal_emitter_active(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.fiscal_emitter_active(uuid,uuid,uuid) TO bansir_worker;
