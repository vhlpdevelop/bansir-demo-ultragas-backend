CREATE TABLE bansir.vouchers (
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),
 code text NOT NULL,customer_name text NOT NULL,customer_phone text NOT NULL,items jsonb NOT NULL,
 total_cents bigint NOT NULL CHECK(total_cents>=0),status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','REDEEMED','CANCELLED')),
 issued_by uuid NOT NULL,issued_by_name text NOT NULL DEFAULT '',redeemed_by uuid,redeemed_by_name text NOT NULL DEFAULT '',
 issued_at timestamptz NOT NULL DEFAULT now(),redeemed_at timestamptz,source text NOT NULL DEFAULT 'MANUAL' CHECK(source IN('PDV','MANUAL')),
 PRIMARY KEY(tenant_id,establishment_id,id),UNIQUE(tenant_id,establishment_id,code),
 FOREIGN KEY(tenant_id,establishment_id) REFERENCES bansir.establishments(tenant_id,id),
 FOREIGN KEY(tenant_id,establishment_id,issued_by) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id),
 FOREIGN KEY(tenant_id,establishment_id,redeemed_by) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id)
);
CREATE INDEX vouchers_recent ON bansir.vouchers(tenant_id,establishment_id,issued_at DESC);
CREATE TABLE bansir.vehicles (
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),
 code text NOT NULL,name text NOT NULL,plate text NOT NULL DEFAULT '',brand text NOT NULL DEFAULT '',year integer,
 type text NOT NULL DEFAULT 'CAMINHÃO' CHECK(type IN('CARRO','CAMINHÃO','MOTO','OUTROS')),
 status text NOT NULL DEFAULT 'ATIVO' CHECK(status IN('ATIVO','MANUTENÇÃO','VENDIDO')),
 purchase_cents bigint NOT NULL DEFAULT 0 CHECK(purchase_cents>=0),notes text NOT NULL DEFAULT '',current_km integer NOT NULL DEFAULT 0 CHECK(current_km>=0),
 last_km_update timestamptz,maintenance_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,id),UNIQUE(tenant_id,establishment_id,code),
 FOREIGN KEY(tenant_id,establishment_id) REFERENCES bansir.establishments(tenant_id,id)
);
CREATE UNIQUE INDEX vehicles_plate_unique ON bansir.vehicles(tenant_id,establishment_id,upper(plate)) WHERE plate<>'';
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['vouchers','vehicles'] LOOP
  EXECUTE format('ALTER TABLE bansir.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE bansir.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY unit_runtime ON bansir.%I TO bansir_runtime USING(bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id))',tab);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON bansir.vouchers,bansir.vehicles TO bansir_runtime;
