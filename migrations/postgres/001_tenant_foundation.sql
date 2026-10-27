CREATE SCHEMA IF NOT EXISTS bansir;
REVOKE ALL ON SCHEMA bansir FROM PUBLIC;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bansir_runtime') THEN
    CREATE ROLE bansir_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

CREATE TABLE bansir.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bansir.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(trim(email))),
  name text NOT NULL,
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  phone text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bansir.tenant_memberships (
  tenant_id uuid NOT NULL REFERENCES bansir.tenants(id),
  user_id uuid NOT NULL REFERENCES bansir.users(id),
  role text NOT NULL CHECK (role IN ('superadmin','admin','gerente_artesao','operador','entregador')),
  allowed_routes text[] NOT NULL DEFAULT ARRAY['products'],
  legacy_user_id text,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, user_id),
  UNIQUE (tenant_id, legacy_user_id)
);
CREATE INDEX memberships_user ON bansir.tenant_memberships(user_id, tenant_id);
CREATE TABLE bansir.establishments (
  tenant_id uuid NOT NULL REFERENCES bansir.tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  document_id text NOT NULL DEFAULT '',
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE bansir.store_settings (
  tenant_id uuid PRIMARY KEY REFERENCES bansir.tenants(id),
  store_name text NOT NULL DEFAULT '',
  pix_key text NOT NULL DEFAULT '',
  document_id text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  merchant_city text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bansir.categories (
  tenant_id uuid NOT NULL REFERENCES bansir.tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  description text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '#000fff',
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, name)
);
CREATE TABLE bansir.products (
  tenant_id uuid NOT NULL REFERENCES bansir.tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  legacy_id text,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  barcode text NOT NULL CHECK (length(trim(barcode)) > 0),
  category text NOT NULL DEFAULT 'Gás de Cozinha',
  price_cents bigint NOT NULL CHECK (price_cents > 0 AND price_cents <= 1000000000),
  cost_cents bigint NOT NULL DEFAULT 0 CHECK (cost_cents >= 0 AND cost_cents <= 1000000000),
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  sku text NOT NULL DEFAULT '',
  unit text NOT NULL DEFAULT 'UN',
  brand text NOT NULL DEFAULT '',
  specs text NOT NULL DEFAULT '',
  ncm text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, barcode),
  UNIQUE (tenant_id, legacy_id)
);
CREATE INDEX products_catalog ON bansir.products(tenant_id, active, name);
CREATE TABLE bansir.stock_movements (
  tenant_id uuid NOT NULL REFERENCES bansir.tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  type text NOT NULL CHECK (type IN ('in','out')),
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  reason text NOT NULL,
  user_id uuid NOT NULL REFERENCES bansir.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES bansir.products(tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES bansir.tenant_memberships(tenant_id, user_id)
);
CREATE INDEX stock_history ON bansir.stock_movements(tenant_id, created_at DESC);
CREATE TABLE bansir.foundation_imports (
  tenant_id uuid PRIMARY KEY REFERENCES bansir.tenants(id),
  source_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION bansir.actor_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;
CREATE FUNCTION bansir.tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

ALTER TABLE bansir.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE bansir.tenant_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY own_memberships ON bansir.tenant_memberships
  USING (user_id = bansir.actor_id());
ALTER TABLE bansir.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE bansir.tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY member_tenants ON bansir.tenants USING (
  EXISTS (SELECT 1 FROM bansir.tenant_memberships m
    WHERE m.tenant_id = id AND m.user_id = bansir.actor_id() AND m.active)
);

CREATE FUNCTION bansir.can_access_tenant(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT target = bansir.tenant_id() AND EXISTS (
    SELECT 1 FROM bansir.tenant_memberships m JOIN bansir.tenants t ON t.id = m.tenant_id
    JOIN bansir.users u ON u.id = m.user_id
    WHERE m.tenant_id = target AND m.user_id = bansir.actor_id() AND m.active AND t.active AND u.active
  )
$$;
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['establishments','store_settings','categories','products','stock_movements','foundation_imports'] LOOP
    EXECUTE format('ALTER TABLE bansir.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE bansir.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON bansir.%I USING (bansir.can_access_tenant(tenant_id)) WITH CHECK (bansir.can_access_tenant(tenant_id))', table_name);
  END LOOP;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA bansir FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA bansir FROM PUBLIC;
GRANT USAGE ON SCHEMA bansir TO bansir_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA bansir TO bansir_runtime;
-- Identities are global; there is no HTTP endpoint to enumerate them. Memberships
-- and tenants are read-only for runtime. Provisioning uses a separate credential.
GRANT SELECT ON bansir.users, bansir.tenants, bansir.tenant_memberships TO bansir_runtime;
GRANT SELECT, INSERT, UPDATE ON bansir.products, bansir.store_settings TO bansir_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON bansir.categories TO bansir_runtime;
GRANT SELECT, INSERT ON bansir.stock_movements TO bansir_runtime;
GRANT SELECT ON bansir.establishments TO bansir_runtime;
