GRANT DELETE ON bansir.notifications TO bansir_runtime;
GRANT SELECT ON bansir.notifications TO bansir_worker;

CREATE FUNCTION bansir.fleet_recipient_allowed(t uuid,e uuid,u uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
 SELECT bansir.push_recipient_active(t,e,u) AND EXISTS(SELECT 1 FROM bansir.establishment_memberships
 WHERE tenant_id=t AND establishment_id=e AND user_id=u AND(role IN('admin','superadmin') OR 'fleet'=ANY(allowed_routes)))
$$;
REVOKE ALL ON FUNCTION bansir.fleet_recipient_allowed(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.fleet_recipient_allowed(uuid,uuid,uuid) TO bansir_worker;

-- The worker can schedule alerts across units only through this fixed producer.
-- A rule revision and recipient receive at most one warning and one overdue alert.
CREATE FUNCTION bansir.schedule_fleet_alerts() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
DECLARE v record;r jsonb;recipient record;remaining bigint;stage text;event_key text;n uuid;j uuid;body text;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('bansir:fleet-alerts',0)) THEN RETURN;END IF;
 FOR v IN SELECT veh.* FROM bansir.vehicles veh JOIN bansir.tenants t ON t.id=veh.tenant_id
 JOIN bansir.establishments e ON(e.tenant_id,e.id)=(veh.tenant_id,veh.establishment_id)
 WHERE veh.status='ATIVO' AND t.active AND e.active LOOP
  FOR r IN SELECT value FROM jsonb_array_elements(v.maintenance_rules) LOOP
   remaining:=(r->>'lastServiceKm')::bigint+(r->>'intervalKm')::bigint-v.current_km;
   IF remaining>least(500,ceil((r->>'intervalKm')::numeric*0.1)) THEN CONTINUE;END IF;
   stage:=CASE WHEN remaining<=0 THEN 'overdue' ELSE 'warning' END;
   event_key:='fleet:'||v.id||':'||md5(r::text)||':'||stage;
   body:=v.name||CASE WHEN v.plate<>'' THEN ' ('||v.plate||')' ELSE '' END||' · '||(r->>'name')||
    CASE WHEN remaining<=0 THEN ': manutenção vencida há '||abs(remaining)||' km.' ELSE ': faltam '||remaining||' km para a manutenção.' END;
   FOR recipient IN SELECT user_id FROM bansir.establishment_memberships em
    WHERE em.tenant_id=v.tenant_id AND em.establishment_id=v.establishment_id
    AND bansir.fleet_recipient_allowed(em.tenant_id,em.establishment_id,em.user_id) LOOP
    n:=gen_random_uuid();j:=NULL;
    INSERT INTO bansir.jobs(tenant_id,establishment_id,kind,dedupe_key,payload)
    VALUES(v.tenant_id,v.establishment_id,'notification',event_key||':'||recipient.user_id,
     jsonb_build_object('category','fleet','notificationId',n,'userId',recipient.user_id,
      'title',CASE WHEN remaining<=0 THEN 'Manutenção da frota vencida' ELSE 'Manutenção da frota próxima' END,'body',body))
    ON CONFLICT DO NOTHING RETURNING id INTO j;
    IF j IS NOT NULL THEN INSERT INTO bansir.notifications(tenant_id,establishment_id,id,user_id,title,body)
     VALUES(v.tenant_id,v.establishment_id,n,recipient.user_id,
      CASE WHEN remaining<=0 THEN 'Manutenção da frota vencida' ELSE 'Manutenção da frota próxima' END,body);END IF;
   END LOOP;
  END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION bansir.schedule_fleet_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.schedule_fleet_alerts() TO bansir_worker;
