CREATE TABLE bansir.employees(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),user_id uuid,
 name text NOT NULL,email text NOT NULL,phone text NOT NULL DEFAULT '',pix_key text NOT NULL DEFAULT '',role_title text NOT NULL,
 labor_type text NOT NULL CHECK(labor_type IN('MOD','MOI')),salary_cents bigint NOT NULL CHECK(salary_cents>=0),
 commission_type text NOT NULL CHECK(commission_type IN('percentage','fixed')),commission_value numeric NOT NULL CHECK(commission_value>=0),
 active boolean NOT NULL DEFAULT true,hired_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,id),UNIQUE(tenant_id,establishment_id,user_id),
 FOREIGN KEY(tenant_id,establishment_id) REFERENCES bansir.establishments(tenant_id,id),
 FOREIGN KEY(tenant_id,establishment_id,user_id) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id)
);
CREATE TABLE bansir.financial_entries(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),request_key uuid NOT NULL,request_hash text NOT NULL,
 title text NOT NULL,type text NOT NULL CHECK(type IN('income','expense')),category text NOT NULL,amount_cents bigint NOT NULL CHECK(amount_cents>0 AND amount_cents<=1000000000),
 status text NOT NULL CHECK(status IN('pending','completed','cancelled')),payment_method text NOT NULL,notes text NOT NULL DEFAULT '',seller_name text NOT NULL DEFAULT '',
 date timestamptz NOT NULL DEFAULT now(),due_date date,settled_at timestamptz,created_by uuid NOT NULL,
 PRIMARY KEY(tenant_id,establishment_id,id),UNIQUE(tenant_id,establishment_id,request_key),
 FOREIGN KEY(tenant_id,establishment_id,created_by) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id)
);
CREATE TABLE bansir.pricing_settings(tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,data jsonb NOT NULL,PRIMARY KEY(tenant_id,establishment_id),FOREIGN KEY(tenant_id,establishment_id) REFERENCES bansir.establishments(tenant_id,id));
CREATE TABLE bansir.employee_advances(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),request_key uuid NOT NULL,request_hash text NOT NULL,
 employee_id uuid NOT NULL,entry_id uuid NOT NULL,amount_cents bigint NOT NULL CHECK(amount_cents>0),justification text NOT NULL,notes text NOT NULL DEFAULT '',
 vehicle_id uuid,vehicle_km integer,status text NOT NULL DEFAULT 'EMITIDO' CHECK(status IN('EMITIDO','DESCONTADO','CANCELADO')),issued_by uuid NOT NULL,date timestamptz NOT NULL DEFAULT now(),payroll_reference text,discounted_by uuid,discounted_at timestamptz,
 PRIMARY KEY(tenant_id,establishment_id,id),UNIQUE(tenant_id,establishment_id,request_key),
 FOREIGN KEY(tenant_id,establishment_id,employee_id) REFERENCES bansir.employees(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,entry_id) REFERENCES bansir.financial_entries(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,vehicle_id) REFERENCES bansir.vehicles(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,issued_by) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id),
 FOREIGN KEY(tenant_id,establishment_id,discounted_by) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id)
);
CREATE TABLE bansir.sale_commissions(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,sale_id uuid NOT NULL,employee_id uuid NOT NULL,employee_name text NOT NULL,amount_cents bigint NOT NULL CHECK(amount_cents>=0),
 PRIMARY KEY(tenant_id,establishment_id,sale_id),
 FOREIGN KEY(tenant_id,establishment_id,sale_id) REFERENCES bansir.sales(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,employee_id) REFERENCES bansir.employees(tenant_id,establishment_id,id)
);
DO $$ DECLARE tab text;BEGIN FOREACH tab IN ARRAY ARRAY['employees','financial_entries','pricing_settings','employee_advances','sale_commissions'] LOOP
 EXECUTE format('ALTER TABLE bansir.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE bansir.%I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('CREATE POLICY unit_runtime ON bansir.%I TO bansir_runtime USING(bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id))',tab);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON bansir.%I TO bansir_runtime',tab);
END LOOP;END $$;
CREATE INDEX financial_entries_date ON bansir.financial_entries(tenant_id,establishment_id,date);
CREATE FUNCTION bansir.snapshot_sale_commission() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO bansir.sale_commissions(tenant_id,establishment_id,sale_id,employee_id,employee_name,amount_cents)
 SELECT NEW.tenant_id,NEW.establishment_id,NEW.id,e.id,e.name,CASE WHEN e.commission_type='fixed' THEN round(e.commission_value*100) ELSE round(NEW.total_cents*e.commission_value/100) END
 FROM bansir.employees e WHERE e.tenant_id=NEW.tenant_id AND e.establishment_id=NEW.establishment_id AND e.user_id=NEW.created_by AND e.active;
 RETURN NEW;END $$;
REVOKE ALL ON FUNCTION bansir.snapshot_sale_commission() FROM PUBLIC;
CREATE TRIGGER snapshot_sale_commission AFTER INSERT ON bansir.sales FOR EACH ROW EXECUTE FUNCTION bansir.snapshot_sale_commission();
