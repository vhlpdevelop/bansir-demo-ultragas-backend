CREATE TABLE bansir.deliverers (
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),
 name text NOT NULL,phone text NOT NULL DEFAULT '',active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,id),FOREIGN KEY(tenant_id,establishment_id) REFERENCES bansir.establishments(tenant_id,id)
);
ALTER TABLE bansir.deliverers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bansir.deliverers FORCE ROW LEVEL SECURITY;
CREATE POLICY deliverer_unit ON bansir.deliverers TO bansir_runtime USING(bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id));
GRANT SELECT,INSERT,UPDATE ON bansir.deliverers TO bansir_runtime;
ALTER TABLE bansir.sales ADD COLUMN delivery_employee_id uuid;
ALTER TABLE bansir.sales ADD COLUMN delivery_employee_name text NOT NULL DEFAULT '';
ALTER TABLE bansir.sales ADD COLUMN delivery_employee_phone text NOT NULL DEFAULT '';
ALTER TABLE bansir.sales ADD FOREIGN KEY(tenant_id,establishment_id,delivery_employee_id) REFERENCES bansir.deliverers(tenant_id,establishment_id,id);
CREATE INDEX customer_phone_lookup ON bansir.customers(tenant_id,establishment_id,
 (CASE WHEN length(regexp_replace(phone,'[^0-9]','','g')) IN(10,11) THEN '55'||regexp_replace(phone,'[^0-9]','','g') ELSE regexp_replace(phone,'[^0-9]','','g') END)) WHERE active;
CREATE TABLE bansir.customer_imports (
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),request_key uuid NOT NULL,
 source_sha256 text NOT NULL,request_hash text NOT NULL,created_by uuid NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,id),UNIQUE(tenant_id,establishment_id,request_key),
 FOREIGN KEY(tenant_id,establishment_id,created_by) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id)
);
ALTER TABLE bansir.customer_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE bansir.customer_imports FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_import_unit ON bansir.customer_imports TO bansir_runtime USING(bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id));
GRANT SELECT,INSERT ON bansir.customer_imports TO bansir_runtime;
