-- Avisos automáticos de status do pedido da vitrine via WhatsApp (dentro da janela de 24h)
-- e suporte à permissão 'deliveries' para notificações disparadas pelo entregador/gerente de entregas.

CREATE OR REPLACE FUNCTION bansir.meta_sender_active(t uuid,e uuid,u uuid,permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
 SELECT EXISTS(SELECT 1 FROM bansir.establishment_memberships m
 JOIN bansir.tenant_memberships tm ON tm.tenant_id=m.tenant_id AND tm.user_id=m.user_id
 JOIN bansir.users usr ON usr.id=m.user_id
 JOIN bansir.establishments est ON(est.tenant_id,est.id)=(m.tenant_id,m.establishment_id)
 JOIN bansir.tenants tenant ON tenant.id=m.tenant_id
 WHERE m.tenant_id=t AND m.establishment_id=e AND m.user_id=u AND m.active AND tm.active AND usr.active AND est.active AND tenant.active
 AND permission IN('settings','settings-whatsapp','sales','valegas','deliveries')
 AND(m.role IN('admin','superadmin')
 OR(permission IN('settings','settings-whatsapp') AND('settings'=ANY(m.allowed_routes) OR 'settings-whatsapp'=ANY(m.allowed_routes)))
 OR(permission='sales' AND EXISTS(SELECT 1 FROM unnest(m.allowed_routes) route WHERE route='sales' OR starts_with(route,'sales-')))
 OR(permission='deliveries' AND EXISTS(SELECT 1 FROM unnest(m.allowed_routes) route WHERE route IN('deliveries-manage','my-deliveries','sales-manage')))
 OR(permission='valegas' AND('valegas'=ANY(m.allowed_routes) OR 'valegas-issue'=ANY(m.allowed_routes)))))
$$;

CREATE OR REPLACE FUNCTION bansir.enqueue_storefront_whatsapp(t uuid,e uuid,order_id uuid,customer_phone text,body text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
DECLARE
 account bansir.meta_accounts%ROWTYPE;
 cfg bansir.meta_greetings%ROWTYPE;
 has_recent boolean;
BEGIN
 IF coalesce((bansir.tenant_features()->>'whatsapp')::boolean, false) IS NOT TRUE THEN
  RETURN false;
 END IF;
 SELECT * INTO account FROM bansir.meta_accounts WHERE tenant_id=t AND establishment_id=e AND enabled LIMIT 1;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO cfg FROM bansir.meta_greetings WHERE tenant_id=t AND establishment_id=e AND enabled LIMIT 1;
 IF NOT FOUND OR NOT bansir.meta_sender_active(t,e,cfg.sender_user_id,'settings') THEN
  RETURN false;
 END IF;
 SELECT EXISTS(
  SELECT 1 FROM bansir.meta_messages
  WHERE tenant_id=t AND establishment_id=e AND direction='in' AND phone=customer_phone AND received_at>now()-interval '24 hours'
 ) INTO has_recent;
 IF NOT has_recent THEN RETURN false; END IF;
 INSERT INTO bansir.jobs(tenant_id,establishment_id,kind,dedupe_key,payload,max_attempts)
 VALUES(
  t,e,'whatsapp','storefront-new:'||order_id::text,
  jsonb_build_object(
   'userId',cfg.sender_user_id,
   'permission','settings',
   'action','storefront-status',
   'phone',customer_phone,
   'message',body,
   'metaPhoneId',account.phone_number_id,
   'metaWabaId',account.waba_id
  ),5
 ) ON CONFLICT(tenant_id,establishment_id,kind,dedupe_key) DO NOTHING;
 RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION bansir.enqueue_storefront_whatsapp(uuid,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.enqueue_storefront_whatsapp(uuid,uuid,uuid,text,text) TO bansir_storefront;

