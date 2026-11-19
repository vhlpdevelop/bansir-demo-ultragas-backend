CREATE OR REPLACE FUNCTION bansir.storefront_phone_allowed(t uuid, e uuid, customer_phone text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, bansir AS $$
 SELECT count(*) FILTER (WHERE o.created_at > now() - interval '15 minutes') < 5
    AND count(*) FILTER (WHERE o.status = 'new' AND o.created_at > now() - interval '2 hours') < 3
 FROM bansir.storefront_orders o
 JOIN bansir.checkout_sessions s ON s.id = o.checkout_session_id
 WHERE o.tenant_id = t
   AND o.establishment_id = e
   AND s.phone = customer_phone
   AND o.created_at > now() - interval '2 hours';
$$;

REVOKE ALL ON FUNCTION bansir.storefront_phone_allowed(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.storefront_phone_allowed(uuid, uuid, text) TO bansir_storefront;
