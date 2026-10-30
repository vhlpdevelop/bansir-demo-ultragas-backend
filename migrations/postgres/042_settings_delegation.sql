ALTER TABLE bansir.store_settings ADD COLUMN contact text NOT NULL DEFAULT '';
-- Revalidate delegated WhatsApp senders without granting other configuration modules access.
CREATE OR REPLACE FUNCTION bansir.meta_sender_active(t uuid,e uuid,u uuid,permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
 SELECT EXISTS(SELECT 1 FROM bansir.establishment_memberships m
 JOIN bansir.tenant_memberships tm ON tm.tenant_id=m.tenant_id AND tm.user_id=m.user_id
 JOIN bansir.users usr ON usr.id=m.user_id
 JOIN bansir.establishments est ON(est.tenant_id,est.id)=(m.tenant_id,m.establishment_id)
 JOIN bansir.tenants tenant ON tenant.id=m.tenant_id
 WHERE m.tenant_id=t AND m.establishment_id=e AND m.user_id=u AND m.active AND tm.active AND usr.active AND est.active AND tenant.active
 AND permission IN('settings','settings-whatsapp','sales','valegas')
 AND(m.role IN('admin','superadmin')
 OR(permission IN('settings','settings-whatsapp') AND('settings'=ANY(m.allowed_routes) OR 'settings-whatsapp'=ANY(m.allowed_routes)))
 OR(permission='sales' AND EXISTS(SELECT 1 FROM unnest(m.allowed_routes) route WHERE route='sales' OR starts_with(route,'sales-')))
 OR(permission='valegas' AND('valegas'=ANY(m.allowed_routes) OR 'valegas-issue'=ANY(m.allowed_routes)))))
$$;
