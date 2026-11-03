ALTER TABLE bansir.notifications ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE FUNCTION bansir.agreement_recipient_allowed(t uuid,e uuid,u uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
 SELECT bansir.push_recipient_active(t,e,u) AND EXISTS(SELECT 1 FROM bansir.establishment_memberships m
 WHERE(m.tenant_id,m.establishment_id,m.user_id)=(t,e,u) AND(m.role IN('admin','superadmin') OR
 m.allowed_routes&&ARRAY['financial','financial-receivables','agreements-view','agreements-manage','agreements-close','agreements-collect']))
$$;
CREATE FUNCTION bansir.agreement_alert_needed(t uuid,e uuid,a uuid,p date,event text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
 WITH context AS(SELECT (now() AT TIME ZONE CASE WHEN EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=s.config->>'timeZone') THEN s.config->>'timeZone' ELSE 'America/Cuiaba' END)::date AS today
 FROM bansir.establishments est JOIN bansir.tenants tenant ON tenant.id=est.tenant_id
 LEFT JOIN bansir.storefronts s ON(s.tenant_id,s.establishment_id)=(est.tenant_id,est.id)
 WHERE(est.tenant_id,est.id)=(t,e) AND est.active AND tenant.active)
 SELECT EXISTS(SELECT 1 FROM bansir.sale_agreements l JOIN bansir.sales sale ON(sale.tenant_id,sale.establishment_id,sale.id)=(l.tenant_id,l.establishment_id,l.sale_id),context
 WHERE(l.tenant_id,l.establishment_id,l.agreement_id,l.period_end)=(t,e,a,p)
 AND NOT EXISTS(SELECT 1 FROM bansir.sale_cancellations x WHERE(x.tenant_id,x.establishment_id,x.sale_id)=(t,e,sale.id))
 AND sale.total_cents>coalesce((SELECT sum(amount_cents) FROM bansir.sale_payments pay WHERE(pay.tenant_id,pay.establishment_id,pay.sale_id)=(t,e,sale.id)),0)
 AND CASE event WHEN 'overdue' THEN l.due_date<context.today WHEN 'due' THEN l.due_date=context.today
 WHEN 'close' THEN p<=context.today AND NOT EXISTS(SELECT 1 FROM bansir.agreement_cycles c WHERE(c.tenant_id,c.establishment_id,c.agreement_id,c.period_end)=(t,e,a,p)) ELSE false END)
$$;
REVOKE ALL ON FUNCTION bansir.agreement_recipient_allowed(uuid,uuid,uuid),bansir.agreement_alert_needed(uuid,uuid,uuid,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.agreement_recipient_allowed(uuid,uuid,uuid),bansir.agreement_alert_needed(uuid,uuid,uuid,date,text) TO bansir_worker;
CREATE FUNCTION bansir.schedule_agreement_alerts() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
DECLARE period record; recipient record; event text; title text; n uuid; j uuid; today date;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('bansir:agreement-alerts',0)) THEN RETURN; END IF;
 FOR period IN SELECT DISTINCT tenant_id,establishment_id,agreement_id,period_end FROM bansir.sale_agreements LOOP
  SELECT (now() AT TIME ZONE CASE WHEN EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=s.config->>'timeZone') THEN s.config->>'timeZone' ELSE 'America/Cuiaba' END)::date INTO today
  FROM (SELECT 1)dummy LEFT JOIN bansir.storefronts s ON(s.tenant_id,s.establishment_id)=(period.tenant_id,period.establishment_id);
  event:=NULL;
  FOREACH event IN ARRAY ARRAY['overdue','due','close'] LOOP
   IF bansir.agreement_alert_needed(period.tenant_id,period.establishment_id,period.agreement_id,period.period_end,event) THEN EXIT;END IF;
   event:=NULL;
  END LOOP;
  IF event IS NULL THEN CONTINUE;END IF;
  title:=CASE event WHEN 'close' THEN 'Convênio: confira o fechamento' WHEN 'due' THEN 'Convênio: vencimento hoje' ELSE 'Convênio: saldo em atraso' END;
  FOR recipient IN SELECT user_id FROM bansir.establishment_memberships em WHERE(em.tenant_id,em.establishment_id)=(period.tenant_id,period.establishment_id)
   AND bansir.agreement_recipient_allowed(em.tenant_id,em.establishment_id,em.user_id) LOOP
   n:=gen_random_uuid();j:=NULL;
   INSERT INTO bansir.jobs(tenant_id,establishment_id,kind,dedupe_key,payload)
   VALUES(period.tenant_id,period.establishment_id,'notification','agreement:'||period.agreement_id||':'||period.period_end||':'||today||':'||event||':'||recipient.user_id,
   jsonb_build_object('category','agreement','agreementId',period.agreement_id,'periodEnd',period.period_end,'event',event,'notificationId',n,'userId',recipient.user_id,'title',title,'body','Abra o financeiro para conferir o convênio e seu período.'))
   ON CONFLICT DO NOTHING RETURNING id INTO j;
   IF j IS NOT NULL THEN INSERT INTO bansir.notifications(tenant_id,establishment_id,id,user_id,title,body,metadata)
    VALUES(period.tenant_id,period.establishment_id,n,recipient.user_id,title,'Abra o financeiro para conferir o convênio e seu período.',jsonb_build_object('section','agreements','agreementId',period.agreement_id,'periodEnd',period.period_end,'event',event));END IF;
  END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION bansir.schedule_agreement_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.schedule_agreement_alerts() TO bansir_worker;

CREATE OR REPLACE FUNCTION bansir.schedule_financial_alerts() RETURNS void
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
     AND NOT EXISTS(SELECT 1 FROM bansir.sale_agreements ag WHERE(ag.tenant_id,ag.establishment_id,ag.sale_id)=(s.tenant_id,s.establishment_id,s.id)) AND s.due_date<=today AND NOT EXISTS(SELECT 1 FROM bansir.sale_cancellations x WHERE(x.tenant_id,x.establishment_id,x.sale_id)=(s.tenant_id,s.establishment_id,s.id))
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
