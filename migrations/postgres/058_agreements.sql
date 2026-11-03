CREATE TABLE bansir.agreements(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),
 request_key uuid NOT NULL,request_hash text NOT NULL,name text NOT NULL,payer_customer_id uuid NOT NULL,
 contact text NOT NULL DEFAULT '',cut_day integer NOT NULL CHECK(cut_day BETWEEN 1 AND 31),due_day integer NOT NULL CHECK(due_day BETWEEN 1 AND 31),
 limit_cents bigint CHECK(limit_cents BETWEEN 0 AND 1000000000),block_overdue boolean NOT NULL DEFAULT true,active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,id),UNIQUE(tenant_id,establishment_id,request_key),
 FOREIGN KEY(tenant_id,establishment_id,payer_customer_id) REFERENCES bansir.customers(tenant_id,establishment_id,id));
CREATE TABLE bansir.agreement_members(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,agreement_id uuid NOT NULL,customer_id uuid NOT NULL,
 active boolean NOT NULL DEFAULT true,limit_cents bigint CHECK(limit_cents BETWEEN 0 AND 1000000000),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,agreement_id,customer_id),
 FOREIGN KEY(tenant_id,establishment_id,agreement_id) REFERENCES bansir.agreements(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,customer_id) REFERENCES bansir.customers(tenant_id,establishment_id,id));
CREATE UNIQUE INDEX one_current_agreement ON bansir.agreement_members(tenant_id,establishment_id,customer_id) WHERE active;
CREATE TABLE bansir.sale_agreements(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,sale_id uuid NOT NULL,agreement_id uuid NOT NULL,customer_id uuid NOT NULL,
 period_end date NOT NULL,due_date date NOT NULL,snapshot jsonb NOT NULL,
 PRIMARY KEY(tenant_id,establishment_id,sale_id),
 FOREIGN KEY(tenant_id,establishment_id,sale_id) REFERENCES bansir.sales(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,agreement_id,customer_id) REFERENCES bansir.agreement_members(tenant_id,establishment_id,agreement_id,customer_id));
CREATE INDEX agreement_period_sales ON bansir.sale_agreements(tenant_id,establishment_id,agreement_id,period_end);
CREATE TABLE bansir.agreement_cycles(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,agreement_id uuid NOT NULL,period_end date NOT NULL,
 request_key uuid NOT NULL,request_hash text NOT NULL,snapshot jsonb NOT NULL,closed_by uuid NOT NULL,closed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,agreement_id,period_end),UNIQUE(tenant_id,establishment_id,request_key),
 FOREIGN KEY(tenant_id,establishment_id,agreement_id) REFERENCES bansir.agreements(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,closed_by) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id));
CREATE TABLE bansir.agreement_receipts(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),agreement_id uuid NOT NULL,
 request_key uuid NOT NULL,request_hash text NOT NULL,amount_cents bigint NOT NULL CHECK(amount_cents>0),method text NOT NULL,
 received_by uuid NOT NULL,cash_session_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,id),UNIQUE(tenant_id,establishment_id,request_key),
 FOREIGN KEY(tenant_id,establishment_id,agreement_id) REFERENCES bansir.agreements(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,received_by) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id),
 FOREIGN KEY(tenant_id,establishment_id,cash_session_id) REFERENCES bansir.cash_sessions(tenant_id,establishment_id,id));
CREATE TABLE bansir.agreement_allocations(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,receipt_id uuid NOT NULL,payment_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,establishment_id,receipt_id,payment_id),UNIQUE(tenant_id,establishment_id,payment_id),
 FOREIGN KEY(tenant_id,establishment_id,receipt_id) REFERENCES bansir.agreement_receipts(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,payment_id) REFERENCES bansir.sale_payments(tenant_id,establishment_id,id));
CREATE TABLE bansir.agreement_audit(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),agreement_id uuid NOT NULL,user_id uuid NOT NULL,
 request_key uuid NOT NULL,request_hash text NOT NULL,action text NOT NULL,details jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,id),UNIQUE(tenant_id,establishment_id,request_key),
 FOREIGN KEY(tenant_id,establishment_id,agreement_id) REFERENCES bansir.agreements(tenant_id,establishment_id,id));
DO $$ DECLARE tab text;BEGIN FOREACH tab IN ARRAY ARRAY['agreements','agreement_members','sale_agreements','agreement_cycles','agreement_receipts','agreement_allocations','agreement_audit'] LOOP
 EXECUTE format('ALTER TABLE bansir.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE bansir.%I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('CREATE POLICY agreement_unit ON bansir.%I TO bansir_runtime USING(bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id))',tab);
 EXECUTE format('GRANT SELECT,INSERT ON bansir.%I TO bansir_runtime',tab);
 END LOOP;END $$;
GRANT UPDATE ON bansir.agreements,bansir.agreement_members TO bansir_runtime;
CREATE OR REPLACE FUNCTION bansir.tenant_features() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
 SELECT jsonb_build_object('whatsapp',t.active AND coalesce((c.features->>'whatsapp')::boolean,true),
 'orderLink',t.active AND coalesce((c.features->>'orderLink')::boolean,true),
 'financialIntelligence',t.active AND coalesce((c.features->>'financialIntelligence')::boolean,true),
 'deliveries',t.active AND coalesce((c.features->>'deliveries')::boolean,true),
 'agreements',t.active AND coalesce((c.features->>'agreements')::boolean,true))
 FROM bansir.tenants t LEFT JOIN bansir.tenant_contracts c ON c.tenant_id=t.id WHERE t.id=bansir.tenant_id()
$$;

CREATE OR REPLACE FUNCTION bansir.platform_command(session_hash text,operation text,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
DECLARE a bansir.platform_admins; target uuid; result jsonb;
BEGIN
 SELECT u.* INTO a FROM bansir.platform_sessions s JOIN bansir.platform_admins u ON u.id=s.admin_id
 WHERE s.token_hash=session_hash AND s.expires_at>now() AND u.active FOR UPDATE OF u;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sessão administrativa expirada.' USING ERRCODE='28000'; END IF;
 IF operation='logout' THEN DELETE FROM bansir.platform_sessions WHERE token_hash=session_hash; RETURN 'true'; END IF;
 IF operation='me' THEN RETURN jsonb_build_object('name',a.name,'email',a.email,'mustChangePassword',a.must_change_password); END IF;
 IF operation='password-hash' THEN RETURN to_jsonb(a.password_hash); END IF;
 IF operation='password' THEN
  IF a.password_hash IS DISTINCT FROM payload->>'expectedHash' THEN RAISE EXCEPTION 'Senha alterada. Entre novamente.' USING ERRCODE='28000'; END IF;
  UPDATE bansir.platform_admins SET password_hash=payload->>'newHash',must_change_password=false WHERE id=a.id;
  DELETE FROM bansir.platform_sessions WHERE admin_id=a.id;
  INSERT INTO bansir.platform_audit(admin_id,action) VALUES(a.id,'password_changed');
  RETURN 'true';
 END IF;
 IF a.must_change_password THEN RAISE EXCEPTION 'Troque sua senha inicial antes de continuar.' USING ERRCODE='42501'; END IF;
 IF operation='overview' THEN
  RETURN jsonb_build_object(
   'tenants',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.name),'[]') FROM (
    SELECT t.id,t.name,t.slug,t.active,t.plan_code,p.name AS plan_name,p.max_establishments,
     (SELECT count(*) FROM bansir.establishments e WHERE e.tenant_id=t.id AND e.active) AS establishments,
     c.monthly_cents,c.next_due,c.features,c.notes,c.updated_at
    FROM bansir.tenants t JOIN bansir.plans p ON p.code=t.plan_code LEFT JOIN bansir.tenant_contracts c ON c.tenant_id=t.id
   )r),
   'plans',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.name),'[]') FROM bansir.plans p WHERE p.active),
   'invoices',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.due_date,i.id),'[]') FROM bansir.platform_invoices i),
   'audit',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id DESC),'[]') FROM (
    SELECT l.id,l.action,l.target_id,l.details,l.created_at,u.name AS admin_name FROM bansir.platform_audit l
    JOIN bansir.platform_admins u ON u.id=l.admin_id ORDER BY l.id DESC LIMIT 50)r));
 END IF;
 target:=(payload->>'tenantId')::uuid;
 PERFORM 1 FROM bansir.tenants WHERE id=target FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Empresa não encontrada.' USING ERRCODE='P0002'; END IF;
 IF operation='tenant' THEN
  IF NOT EXISTS(SELECT 1 FROM bansir.plans WHERE code=payload->>'planCode' AND active AND max_establishments >=
   (SELECT count(*) FROM bansir.establishments WHERE tenant_id=target AND active)) THEN
   RAISE EXCEPTION 'Plano incompatível com as unidades ativas.' USING ERRCODE='22023'; END IF;
  UPDATE bansir.tenants SET active=(payload->>'active')::boolean,plan_code=payload->>'planCode' WHERE id=target;
  INSERT INTO bansir.tenant_contracts(tenant_id,monthly_cents,next_due,features,notes)
   VALUES(target,(payload->>'monthlyCents')::integer,(payload->>'nextDue')::date,payload->'features',payload->>'notes')
   ON CONFLICT(tenant_id) DO UPDATE SET monthly_cents=excluded.monthly_cents,next_due=excluded.next_due,
    features=tenant_contracts.features||excluded.features,notes=excluded.notes,updated_at=now();
  -- Suspension closes old sessions, including when the company is reactivated later.
  IF NOT (payload->>'active')::boolean THEN UPDATE bansir.access_sessions SET revoked_at=now() WHERE tenant_id=target AND revoked_at IS NULL; END IF;
 ELSIF operation='invoice' THEN
  INSERT INTO bansir.platform_invoices(tenant_id,reference,due_date,amount_cents)
   VALUES(target,payload->>'reference',(payload->>'dueDate')::date,(payload->>'amountCents')::integer)
   RETURNING to_jsonb(platform_invoices) INTO result;
 ELSIF operation='paid' THEN
  UPDATE bansir.platform_invoices SET paid_at=now() WHERE id=(payload->>'invoiceId')::uuid AND tenant_id=target AND paid_at IS NULL
   RETURNING to_jsonb(platform_invoices) INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cobrança já paga ou inexistente.' USING ERRCODE='22023'; END IF;
 ELSE RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023'; END IF;
 INSERT INTO bansir.platform_audit(admin_id,action,target_id,details) VALUES(a.id,operation,target,payload);
 RETURN coalesce(result,'true'::jsonb);
END $$;
