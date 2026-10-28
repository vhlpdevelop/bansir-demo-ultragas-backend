-- Dedicated SQS cell worker uses the same verified, scoped ingest function.
GRANT EXECUTE ON FUNCTION bansir.meta_ingest(text,text,text,text,text,text,text,timestamptz) TO bansir_worker;
CREATE FUNCTION bansir.meta_cell_receiver(pid text,waba text) RETURNS TABLE(tenant_id uuid,establishment_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
 SELECT r.tenant_id,r.establishment_id FROM bansir.meta_receiver(pid) r JOIN bansir.meta_accounts a ON(a.tenant_id,a.establishment_id)=(r.tenant_id,r.establishment_id) WHERE a.waba_id=waba AND a.phone_number_id=pid
$$;
REVOKE ALL ON FUNCTION bansir.meta_cell_receiver(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.meta_cell_receiver(text,text) TO bansir_worker;
