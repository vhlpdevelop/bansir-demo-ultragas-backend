CREATE TABLE bansir.sale_counters (
 tenant_id uuid NOT NULL, establishment_id uuid NOT NULL,last_number bigint NOT NULL DEFAULT 0 CHECK(last_number BETWEEN 0 AND 999999999),
 PRIMARY KEY(tenant_id,establishment_id),FOREIGN KEY(tenant_id,establishment_id) REFERENCES bansir.establishments(tenant_id,id)
);
CREATE TABLE bansir.product_fiscal_profiles (
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,product_id uuid NOT NULL,data jsonb NOT NULL DEFAULT '{}',
 PRIMARY KEY(tenant_id,establishment_id,product_id),FOREIGN KEY(tenant_id,establishment_id,product_id) REFERENCES bansir.products(tenant_id,establishment_id,id)
);
DO $$ DECLARE tab text;BEGIN
 FOREACH tab IN ARRAY ARRAY['sale_counters','product_fiscal_profiles'] LOOP
  EXECUTE format('ALTER TABLE bansir.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE bansir.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY unit_config ON bansir.%I TO bansir_runtime USING(bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id))',tab);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON bansir.sale_counters,bansir.product_fiscal_profiles TO bansir_runtime;
ALTER TABLE bansir.sales ADD COLUMN coupon_number bigint;
CREATE UNIQUE INDEX sale_coupon_unit ON bansir.sales(tenant_id,establishment_id,coupon_number) WHERE coupon_number IS NOT NULL;
ALTER TABLE bansir.sale_items ADD COLUMN fiscal_profile jsonb NOT NULL DEFAULT '{}';
CREATE FUNCTION bansir.assign_sale_coupon() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO bansir.sale_counters(tenant_id,establishment_id) VALUES(NEW.tenant_id,NEW.establishment_id) ON CONFLICT DO NOTHING;
 UPDATE bansir.sale_counters SET last_number=last_number+1 WHERE tenant_id=NEW.tenant_id AND establishment_id=NEW.establishment_id AND last_number<999999999 RETURNING last_number INTO NEW.coupon_number;
 IF NEW.coupon_number IS NULL THEN RAISE EXCEPTION 'Cupom: contador esgotado'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER assign_sale_coupon BEFORE INSERT ON bansir.sales FOR EACH ROW EXECUTE FUNCTION bansir.assign_sale_coupon();
CREATE FUNCTION bansir.snapshot_product_fiscal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.fiscal_profile=coalesce((SELECT data FROM bansir.product_fiscal_profiles WHERE tenant_id=NEW.tenant_id AND establishment_id=NEW.establishment_id AND product_id=NEW.product_id),'{}'::jsonb);
 RETURN NEW;
END $$;
CREATE TRIGGER snapshot_product_fiscal BEFORE INSERT ON bansir.sale_items FOR EACH ROW EXECUTE FUNCTION bansir.snapshot_product_fiscal();
