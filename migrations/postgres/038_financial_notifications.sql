CREATE FUNCTION bansir.financial_recipient_allowed(t uuid,e uuid,u uuid,part text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
 SELECT part IN('income','expense') AND bansir.push_recipient_active(t,e,u) AND EXISTS(
 SELECT 1 FROM bansir.establishment_memberships WHERE tenant_id=t AND establishment_id=e AND user_id=u
 AND(role IN('admin','superadmin') OR 'financial'=ANY(allowed_routes)
 OR (CASE WHEN part='expense' THEN 'financial-payables' ELSE 'financial-receivables' END)=ANY(allowed_routes)))
$$;
REVOKE ALL ON FUNCTION bansir.financial_recipient_allowed(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.financial_recipient_allowed(uuid,uuid,uuid,text) TO bansir_worker;

-- One daily digest per unit, category and recipient; no financial values in push.
CREATE FUNCTION bansir.schedule_financial_alerts() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
DECLARE unit record; part text; recipient record; today date; n uuid; j uuid; heading text;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('bansir:financial-alerts',0)) THEN RETURN;END IF;
 FOR unit IN SELECT e.tenant_id,e.id,s.config->>'timeZone' AS zone FROM bansir.establishments e
 JOIN bansir.tenants t ON t.id=e.tenant_id LEFT JOIN bansir.storefronts s ON(s.tenant_id,s.establishment_id)=(e.tenant_id,e.id)
 WHERE e.active AND t.active LOOP
  today:=(now() AT TIME ZONE (CASE WHEN EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=unit.zone) THEN unit.zone ELSE 'America/Cuiaba' END))::date;
  FOREACH part IN ARRAY ARRAY['income','expense'] LOOP
   IF NOT EXISTS(SELECT 1 FROM bansir.financial_entries f WHERE f.tenant_id=unit.tenant_id AND f.establishment_id=unit.id
    AND f.type=part AND f.status='pending' AND f.due_date<=today)
    AND NOT(part='income' AND EXISTS(SELECT 1 FROM bansir.sales s WHERE s.tenant_id=unit.tenant_id AND s.establishment_id=unit.id
     AND s.due_date<=today AND NOT EXISTS(SELECT 1 FROM bansir.sale_cancellations x WHERE(x.tenant_id,x.establishment_id,x.sale_id)=(s.tenant_id,s.establishment_id,s.id))
     AND s.total_cents>coalesce((SELECT sum(p.amount_cents) FROM bansir.sale_payments p WHERE(p.tenant_id,p.establishment_id,p.sale_id)=(s.tenant_id,s.establishment_id,s.id)),0))) THEN CONTINUE;END IF;
   heading:=CASE WHEN part='expense' THEN 'Contas a pagar precisam de atenção' ELSE 'Contas a receber precisam de atenção' END;
   FOR recipient IN SELECT user_id FROM bansir.establishment_memberships em WHERE em.tenant_id=unit.tenant_id AND em.establishment_id=unit.id
    AND bansir.financial_recipient_allowed(em.tenant_id,em.establishment_id,em.user_id,part) LOOP
    n:=gen_random_uuid();j:=NULL;
    INSERT INTO bansir.jobs(tenant_id,establishment_id,kind,dedupe_key,payload)
     VALUES(unit.tenant_id,unit.id,'notification','financial:'||today||':'||part||':'||recipient.user_id,
      jsonb_build_object('category','financial','financialPart',part,'notificationId',n,'userId',recipient.user_id,'title',heading,
       'body','Há vencimentos de hoje ou em atraso. Confira o financeiro deste estabelecimento.'))
     ON CONFLICT DO NOTHING RETURNING id INTO j;
    IF j IS NOT NULL THEN INSERT INTO bansir.notifications(tenant_id,establishment_id,id,user_id,title,body)
     VALUES(unit.tenant_id,unit.id,n,recipient.user_id,heading,'Há vencimentos de hoje ou em atraso. Confira o financeiro deste estabelecimento.');END IF;
   END LOOP;
  END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION bansir.schedule_financial_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.schedule_financial_alerts() TO bansir_worker;
