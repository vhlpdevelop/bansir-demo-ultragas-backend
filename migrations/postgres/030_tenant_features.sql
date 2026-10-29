-- Only exposes contract switches for the transaction's current tenant.
CREATE FUNCTION bansir.tenant_features() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
 SELECT jsonb_build_object(
 'whatsapp',t.active AND coalesce((c.features->>'whatsapp')::boolean,true),
 'orderLink',t.active AND coalesce((c.features->>'orderLink')::boolean,true),
 'financialIntelligence',t.active AND coalesce((c.features->>'financialIntelligence')::boolean,true))
 FROM bansir.tenants t LEFT JOIN bansir.tenant_contracts c ON c.tenant_id=t.id WHERE t.id=bansir.tenant_id()
$$;
REVOKE ALL ON FUNCTION bansir.tenant_features() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.tenant_features() TO bansir_runtime,bansir_worker,bansir_storefront;

ALTER FUNCTION bansir.meta_ingest(text,text,text,text,text,text,text,timestamptz) RENAME TO meta_ingest_before_contract;
REVOKE ALL ON FUNCTION bansir.meta_ingest_before_contract(text,text,text,text,text,text,text,timestamptz) FROM PUBLIC,bansir_runtime,bansir_worker;
CREATE FUNCTION bansir.meta_ingest(pid text,waba text,mid text,dir text,contact text,txt text,st text,event_at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM bansir.meta_accounts a JOIN bansir.tenants t ON t.id=a.tenant_id
 LEFT JOIN bansir.tenant_contracts c ON c.tenant_id=t.id
 WHERE a.phone_number_id=pid AND a.waba_id=waba AND t.active AND coalesce((c.features->>'whatsapp')::boolean,true)) THEN RETURN; END IF;
 PERFORM bansir.meta_ingest_before_contract(pid,waba,mid,dir,contact,txt,st,event_at);
END $$;
REVOKE ALL ON FUNCTION bansir.meta_ingest(text,text,text,text,text,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.meta_ingest(text,text,text,text,text,text,text,timestamptz) TO bansir_runtime,bansir_worker;
