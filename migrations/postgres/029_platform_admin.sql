-- Platform identities are deliberately independent from tenant users/RBAC.
CREATE TABLE bansir.platform_admins (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL,
 name text NOT NULL, password_hash text NOT NULL, active boolean NOT NULL DEFAULT true,
 must_change_password boolean NOT NULL DEFAULT true
);
CREATE TABLE bansir.platform_sessions (
 token_hash text PRIMARY KEY, admin_id uuid NOT NULL REFERENCES bansir.platform_admins(id),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '2 hours'
);
CREATE TABLE bansir.tenant_contracts (
 tenant_id uuid PRIMARY KEY REFERENCES bansir.tenants(id),
 monthly_cents integer NOT NULL DEFAULT 0 CHECK(monthly_cents>=0),
 next_due date, features jsonb NOT NULL DEFAULT '{"whatsapp":false,"orderLink":false,"financialIntelligence":false}',
 notes text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bansir.platform_invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES bansir.tenants(id),
 reference text NOT NULL CHECK(length(reference)>0), due_date date NOT NULL,
 amount_cents integer NOT NULL CHECK(amount_cents>0), paid_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,reference)
);
CREATE TABLE bansir.platform_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, admin_id uuid NOT NULL REFERENCES bansir.platform_admins(id),
 action text NOT NULL, target_id uuid, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON bansir.platform_admins,bansir.platform_sessions,bansir.tenant_contracts,bansir.platform_invoices,bansir.platform_audit FROM PUBLIC,bansir_runtime,bansir_worker;

CREATE FUNCTION bansir.platform_login(mail text) RETURNS TABLE(id uuid,password_hash text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
 SELECT id,password_hash FROM bansir.platform_admins WHERE email=mail AND active
$$;
CREATE FUNCTION bansir.platform_open_session(target uuid,expected_hash text,session_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
DECLARE a bansir.platform_admins;
BEGIN
 SELECT * INTO a FROM bansir.platform_admins WHERE id=target AND active AND password_hash=expected_hash FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 DELETE FROM bansir.platform_sessions WHERE expires_at<=now();
 INSERT INTO bansir.platform_sessions(token_hash,admin_id) VALUES(session_hash,a.id);
 INSERT INTO bansir.platform_audit(admin_id,action) VALUES(a.id,'login');
 RETURN jsonb_build_object('name',a.name,'email',a.email,'mustChangePassword',a.must_change_password);
END $$;

CREATE FUNCTION bansir.platform_command(session_hash text,operation text,payload jsonb) RETURNS jsonb
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
    features=excluded.features,notes=excluded.notes,updated_at=now();
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
REVOKE ALL ON FUNCTION bansir.platform_login(text),bansir.platform_open_session(uuid,text,text),bansir.platform_command(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.platform_login(text),bansir.platform_open_session(uuid,text,text),bansir.platform_command(text,text,jsonb) TO bansir_runtime;
