DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='bansir_storefront') THEN
  CREATE ROLE bansir_storefront NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
 END IF;
END $$;
GRANT bansir_storefront TO bansir_runtime;
-- Older unit policies predate public checkout; restrict them to the authenticated runtime group.
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['store_settings','categories','products','stock_movements'] LOOP
  EXECUTE format('ALTER POLICY establishment_isolation ON bansir.%I TO bansir_runtime',tab);
 END LOOP;
END $$;
GRANT USAGE ON SCHEMA bansir TO bansir_storefront;
GRANT EXECUTE ON FUNCTION bansir.tenant_id(),bansir.establishment_id() TO bansir_storefront;
CREATE TABLE bansir.storefronts (
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,slug text NOT NULL UNIQUE CHECK(slug~'^[a-z0-9][a-z0-9-]{2,62}$'),
 enabled boolean NOT NULL DEFAULT false,config jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id),FOREIGN KEY(tenant_id,establishment_id) REFERENCES bansir.establishments(tenant_id,id)
);
CREATE TABLE bansir.checkout_sessions (
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),token_hash text NOT NULL CHECK(token_hash~'^[a-f0-9]{64}$'),
 phone text NOT NULL CHECK(phone~'^55[0-9]{10,11}$'),customer_id uuid,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '2 hours',
 PRIMARY KEY(tenant_id,establishment_id,id),UNIQUE(token_hash),
 FOREIGN KEY(tenant_id,establishment_id) REFERENCES bansir.storefronts(tenant_id,establishment_id),
 FOREIGN KEY(tenant_id,establishment_id,customer_id) REFERENCES bansir.customers(tenant_id,establishment_id,id)
);
CREATE TABLE bansir.storefront_orders (
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),checkout_session_id uuid NOT NULL,
 request_key uuid NOT NULL,request_hash text NOT NULL,phone text NOT NULL,customer_id uuid,
 customer_name text NOT NULL,delivery_address text NOT NULL,fulfillment text NOT NULL CHECK(fulfillment IN('pickup','delivery')),
 zone_id text NOT NULL,items jsonb NOT NULL,subtotal_cents bigint NOT NULL CHECK(subtotal_cents>0),shipping_cents bigint NOT NULL CHECK(shipping_cents>=0),
 total_cents bigint NOT NULL CHECK(total_cents=subtotal_cents+shipping_cents AND total_cents<=1000000000),
 status text NOT NULL DEFAULT 'new' CHECK(status IN('new','accepted','rejected','cancelled')),sale_id uuid,
 accepted_by uuid,rejection_reason text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,id),UNIQUE(tenant_id,establishment_id,checkout_session_id,request_key),
 UNIQUE(tenant_id,establishment_id,sale_id),
 FOREIGN KEY(tenant_id,establishment_id,checkout_session_id) REFERENCES bansir.checkout_sessions(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,customer_id) REFERENCES bansir.customers(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,sale_id) REFERENCES bansir.sales(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,accepted_by) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id)
);
CREATE INDEX storefront_order_queue ON bansir.storefront_orders(tenant_id,establishment_id,status,created_at DESC);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['storefronts','checkout_sessions','storefront_orders'] LOOP
  EXECUTE format('ALTER TABLE bansir.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE bansir.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY unit_storefront ON bansir.%I TO bansir_runtime USING(bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id))',tab);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON bansir.storefronts,bansir.storefront_orders TO bansir_runtime;
GRANT SELECT ON bansir.checkout_sessions TO bansir_runtime;

CREATE FUNCTION bansir.storefront_enabled(t uuid,e uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
 SELECT EXISTS(SELECT 1 FROM bansir.storefronts sf JOIN bansir.tenants ten ON ten.id=sf.tenant_id JOIN bansir.establishments est ON(est.tenant_id,est.id)=(sf.tenant_id,sf.establishment_id)
 WHERE sf.tenant_id=t AND sf.establishment_id=e AND sf.enabled AND ten.active AND est.active)
$$;
CREATE FUNCTION bansir.checkout_scope(t uuid,e uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,bansir AS $$
 SELECT current_setting('app.public_checkout',true)='true' AND t=bansir.tenant_id() AND e=bansir.establishment_id() AND bansir.storefront_enabled(t,e)
$$;
REVOKE ALL ON FUNCTION bansir.storefront_enabled(uuid,uuid),bansir.checkout_scope(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.storefront_enabled(uuid,uuid),bansir.checkout_scope(uuid,uuid) TO bansir_storefront;
CREATE POLICY enabled_storefront ON bansir.storefronts TO bansir_storefront USING(bansir.storefront_enabled(tenant_id,establishment_id));
GRANT SELECT(tenant_id,establishment_id,slug,config,enabled,updated_at) ON bansir.storefronts TO bansir_storefront;
CREATE POLICY public_catalog ON bansir.products TO bansir_storefront USING(active AND bansir.checkout_scope(tenant_id,establishment_id));
GRANT SELECT(id,name,price_cents,stock,unit,brand,category,active,tenant_id,establishment_id) ON bansir.products TO bansir_storefront;
CREATE POLICY private_checkout_session ON bansir.checkout_sessions TO bansir_storefront
 USING(bansir.checkout_scope(tenant_id,establishment_id) AND token_hash=current_setting('app.checkout_hash',true) AND expires_at>now())
 WITH CHECK(bansir.checkout_scope(tenant_id,establishment_id) AND token_hash=current_setting('app.checkout_hash',true));
GRANT INSERT(tenant_id,establishment_id,token_hash,phone) ON bansir.checkout_sessions TO bansir_storefront;
GRANT SELECT(id,tenant_id,establishment_id,phone,token_hash,expires_at) ON bansir.checkout_sessions TO bansir_storefront;
CREATE POLICY private_checkout_order ON bansir.storefront_orders TO bansir_storefront
 USING(bansir.checkout_scope(tenant_id,establishment_id) AND EXISTS(SELECT 1 FROM bansir.checkout_sessions s WHERE s.id=checkout_session_id))
 WITH CHECK(bansir.checkout_scope(tenant_id,establishment_id) AND EXISTS(SELECT 1 FROM bansir.checkout_sessions s WHERE s.id=checkout_session_id));
GRANT INSERT(tenant_id,establishment_id,checkout_session_id,request_key,request_hash,customer_name,delivery_address,fulfillment,zone_id,items,subtotal_cents,shipping_cents,total_cents) ON bansir.storefront_orders TO bansir_storefront;
GRANT SELECT(id,tenant_id,establishment_id,checkout_session_id,request_key,request_hash,status,total_cents,shipping_cents,created_at) ON bansir.storefront_orders TO bansir_storefront;

-- Resolve customers internally. The checkout role never receives SELECT on customer records.
CREATE FUNCTION bansir.checkout_customer_snapshot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
DECLARE candidate uuid; matches integer; BEGIN
 SELECT count(*),(array_agg(id))[1] INTO matches,candidate FROM bansir.customers WHERE tenant_id=NEW.tenant_id AND establishment_id=NEW.establishment_id AND active
 AND (CASE WHEN length(regexp_replace(phone,'[^0-9]','','g')) IN(10,11) THEN '55'||regexp_replace(phone,'[^0-9]','','g') ELSE regexp_replace(phone,'[^0-9]','','g') END)=NEW.phone;
 NEW.customer_id=CASE WHEN matches=1 THEN candidate ELSE NULL END;RETURN NEW;
END $$;
CREATE TRIGGER resolve_checkout_customer BEFORE INSERT ON bansir.checkout_sessions FOR EACH ROW EXECUTE FUNCTION bansir.checkout_customer_snapshot();
CREATE FUNCTION bansir.checkout_order_snapshot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
BEGIN
 SELECT phone,customer_id INTO NEW.phone,NEW.customer_id FROM bansir.checkout_sessions WHERE (tenant_id,establishment_id,id)=(NEW.tenant_id,NEW.establishment_id,NEW.checkout_session_id) AND expires_at>now();
 IF NEW.phone IS NULL THEN RAISE EXCEPTION 'Checkout expired' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER resolve_order_customer BEFORE INSERT ON bansir.storefront_orders FOR EACH ROW EXECUTE FUNCTION bansir.checkout_order_snapshot();
REVOKE ALL ON FUNCTION bansir.checkout_customer_snapshot(),bansir.checkout_order_snapshot() FROM PUBLIC;
ALTER TABLE bansir.sales DROP CONSTRAINT sales_payment_term_check;
ALTER TABLE bansir.sales ADD CHECK(payment_term IN('immediate','pickup','delivery','credit'));
