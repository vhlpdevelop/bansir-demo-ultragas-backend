-- Establishments are the operational boundary. The original company role is
-- retained for migration history; runtime permissions come from the unit link.
CREATE TABLE bansir.plans (
  code text PRIMARY KEY,
  name text NOT NULL,
  max_establishments integer NOT NULL CHECK (max_establishments > 0),
  active boolean NOT NULL DEFAULT true
);
-- Technical migration entitlement, not a commercial plan or invented pricing.
INSERT INTO bansir.plans VALUES ('migration-single', 'Migração inicial: um estabelecimento', 1, true);
ALTER TABLE bansir.tenants ADD COLUMN plan_code text NOT NULL DEFAULT 'migration-single' REFERENCES bansir.plans(code);
ALTER TABLE bansir.establishments ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE bansir.establishments ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM bansir.establishments GROUP BY tenant_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Atribua explicitamente os dados e limites dos tenants com várias unidades antes desta migração';
  END IF;
END $$;
INSERT INTO bansir.establishments(tenant_id,name)
  SELECT t.id,t.name FROM bansir.tenants t WHERE NOT EXISTS (
    SELECT 1 FROM bansir.establishments e WHERE e.tenant_id=t.id
  );
CREATE TABLE bansir.establishment_memberships (
  tenant_id uuid NOT NULL,
  establishment_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('superadmin','admin','gerente_artesao','operador','entregador')),
  allowed_routes text[] NOT NULL DEFAULT ARRAY['products'],
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id,establishment_id,user_id),
  FOREIGN KEY (tenant_id,establishment_id) REFERENCES bansir.establishments(tenant_id,id),
  FOREIGN KEY (tenant_id,user_id) REFERENCES bansir.tenant_memberships(tenant_id,user_id)
);
INSERT INTO bansir.establishment_memberships(tenant_id,establishment_id,user_id,role,allowed_routes,active)
  SELECT m.tenant_id,e.id,m.user_id,m.role,m.allowed_routes,m.active
  FROM bansir.tenant_memberships m JOIN bansir.establishments e ON e.tenant_id=m.tenant_id;
ALTER TABLE bansir.establishment_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE bansir.establishment_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY own_establishment_links ON bansir.establishment_memberships USING (user_id=bansir.actor_id());

CREATE FUNCTION bansir.establishment_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.establishment_id',true),'')::uuid
$$;
CREATE FUNCTION bansir.can_access_establishment(target_tenant uuid,target_unit uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT bansir.can_access_tenant(target_tenant) AND target_unit=bansir.establishment_id()
    AND EXISTS (SELECT 1 FROM bansir.establishment_memberships m
      JOIN bansir.establishments e ON e.tenant_id=m.tenant_id AND e.id=m.establishment_id
      WHERE m.tenant_id=target_tenant AND m.establishment_id=target_unit
        AND m.user_id=bansir.actor_id() AND m.active AND e.active)
$$;
DROP POLICY tenant_isolation ON bansir.establishments;
CREATE POLICY accessible_establishments ON bansir.establishments USING (
  EXISTS (SELECT 1 FROM bansir.establishment_memberships m
    WHERE m.tenant_id=establishments.tenant_id AND m.establishment_id=establishments.id
      AND m.user_id=bansir.actor_id() AND m.active)
);

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['store_settings','categories','products','stock_movements'] LOOP
    EXECUTE format('ALTER TABLE bansir.%I ADD COLUMN establishment_id uuid',table_name);
    EXECUTE format('UPDATE bansir.%I d SET establishment_id=e.id FROM bansir.establishments e WHERE e.tenant_id=d.tenant_id',table_name);
    EXECUTE format('ALTER TABLE bansir.%I ALTER COLUMN establishment_id SET NOT NULL',table_name);
    EXECUTE format('ALTER TABLE bansir.%I ADD FOREIGN KEY (tenant_id,establishment_id) REFERENCES bansir.establishments(tenant_id,id)',table_name);
    EXECUTE format('DROP POLICY tenant_isolation ON bansir.%I',table_name);
    EXECUTE format('CREATE POLICY establishment_isolation ON bansir.%I USING (bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK (bansir.can_access_establishment(tenant_id,establishment_id))',table_name);
  END LOOP;
END $$;
ALTER TABLE bansir.store_settings DROP CONSTRAINT store_settings_pkey;
ALTER TABLE bansir.store_settings ADD PRIMARY KEY (tenant_id,establishment_id);
ALTER TABLE bansir.categories DROP CONSTRAINT categories_tenant_id_name_key;
ALTER TABLE bansir.categories ADD UNIQUE (tenant_id,establishment_id,name);
ALTER TABLE bansir.products DROP CONSTRAINT products_tenant_id_barcode_key;
ALTER TABLE bansir.products DROP CONSTRAINT products_tenant_id_legacy_id_key;
ALTER TABLE bansir.products ADD UNIQUE (tenant_id,establishment_id,barcode);
ALTER TABLE bansir.products ADD UNIQUE (tenant_id,establishment_id,legacy_id);
ALTER TABLE bansir.products ADD UNIQUE (tenant_id,establishment_id,id);
ALTER TABLE bansir.stock_movements ADD FOREIGN KEY (tenant_id,establishment_id,product_id)
  REFERENCES bansir.products(tenant_id,establishment_id,id);
ALTER TABLE bansir.stock_movements ADD FOREIGN KEY (tenant_id,establishment_id,user_id)
  REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id);
CREATE INDEX products_unit_catalog ON bansir.products(tenant_id,establishment_id,active,name);
CREATE INDEX stock_unit_history ON bansir.stock_movements(tenant_id,establishment_id,created_at DESC);

CREATE TABLE bansir.access_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  establishment_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  FOREIGN KEY (tenant_id,establishment_id,user_id) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id)
);
CREATE INDEX access_sessions_user ON bansir.access_sessions(user_id,expires_at);
CREATE TABLE bansir.selection_requests (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES bansir.users(id),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['access_sessions','selection_requests'] LOOP
    EXECUTE format('ALTER TABLE bansir.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE bansir.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY own_sessions ON bansir.%I USING (user_id=bansir.actor_id()) WITH CHECK (user_id=bansir.actor_id())',table_name);
  END LOOP;
END $$;

CREATE FUNCTION bansir.enforce_establishment_limit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed integer; BEGIN
  IF TG_OP='UPDATE' AND NEW.tenant_id<>OLD.tenant_id THEN
    RAISE EXCEPTION 'Não é permitido transferir um estabelecimento entre empresas' USING ERRCODE='23514';
  END IF;
  -- Serializes simultaneous creations for this tenant, including admin scripts.
  PERFORM 1 FROM bansir.tenants WHERE id=NEW.tenant_id FOR UPDATE;
  SELECT p.max_establishments INTO allowed FROM bansir.plans p
    JOIN bansir.tenants t ON t.plan_code=p.code WHERE t.id=NEW.tenant_id AND p.active;
  IF allowed IS NULL OR (SELECT count(*) FROM bansir.establishments WHERE tenant_id=NEW.tenant_id)>=allowed THEN
    RAISE EXCEPTION 'Limite de estabelecimentos do plano atingido' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER establishment_capacity BEFORE INSERT OR UPDATE OF tenant_id ON bansir.establishments
  FOR EACH ROW EXECUTE FUNCTION bansir.enforce_establishment_limit();
CREATE FUNCTION bansir.validate_tenant_plan() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed integer; BEGIN
  SELECT max_establishments INTO allowed FROM bansir.plans WHERE code=NEW.plan_code AND active;
  IF allowed IS NULL OR (SELECT count(*) FROM bansir.establishments WHERE tenant_id=NEW.id)>allowed THEN
    RAISE EXCEPTION 'Plano não comporta os estabelecimentos existentes' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tenant_plan_capacity BEFORE INSERT OR UPDATE OF plan_code ON bansir.tenants
  FOR EACH ROW EXECUTE FUNCTION bansir.validate_tenant_plan();
-- Limits are versioned: changing a company's plan validates its actual units.
CREATE FUNCTION bansir.immutable_plan_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.max_establishments<>OLD.max_establishments THEN
    RAISE EXCEPTION 'Crie uma nova revisão de plano para alterar a capacidade' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER plan_capacity_version BEFORE UPDATE OF max_establishments ON bansir.plans
  FOR EACH ROW EXECUTE FUNCTION bansir.immutable_plan_capacity();

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA bansir FROM PUBLIC;
REVOKE ALL ON bansir.plans,bansir.establishment_memberships,bansir.access_sessions,bansir.selection_requests FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.establishment_id(),bansir.can_access_establishment(uuid,uuid) TO bansir_runtime;
GRANT SELECT ON bansir.establishment_memberships TO bansir_runtime;
GRANT SELECT,INSERT ON bansir.access_sessions,bansir.selection_requests TO bansir_runtime;
GRANT UPDATE(revoked_at) ON bansir.access_sessions TO bansir_runtime;
GRANT UPDATE(consumed_at) ON bansir.selection_requests TO bansir_runtime;
