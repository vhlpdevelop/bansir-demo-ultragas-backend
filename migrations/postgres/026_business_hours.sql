CREATE FUNCTION bansir.whatsapp_business_calendar() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
 SELECT jsonb_build_object('businessHours',config->'businessHours','timeZone',config->'timeZone','acceptingOrders',config->'acceptingOrders')
 FROM bansir.storefronts WHERE tenant_id=bansir.tenant_id() AND establishment_id=bansir.establishment_id()
$$;
REVOKE ALL ON FUNCTION bansir.whatsapp_business_calendar() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.whatsapp_business_calendar() TO bansir_worker;
CREATE FUNCTION bansir.guard_business_hours_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (TG_OP='INSERT' AND NEW.config ? 'businessHours') OR (TG_OP='UPDATE' AND OLD.config->'businessHours' IS DISTINCT FROM NEW.config->'businessHours') THEN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND(rolsuper OR rolbypassrls)) AND NOT EXISTS(SELECT 1 FROM bansir.establishments WHERE tenant_id=NEW.tenant_id AND id=NEW.establishment_id AND owner_user_id=bansir.actor_id()) THEN
   RAISE EXCEPTION 'Somente o dono pode configurar o expediente' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bansir.guard_business_hours_owner() FROM PUBLIC;
CREATE TRIGGER business_hours_owner BEFORE INSERT OR UPDATE ON bansir.storefronts FOR EACH ROW EXECUTE FUNCTION bansir.guard_business_hours_owner();

CREATE FUNCTION bansir.whatsapp_open_at(cfg jsonb, instant timestamptz) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,bansir AS $$
DECLARE local_time timestamp;d integer;m integer;r jsonb;delta integer;start_min integer;end_min integer;point integer;
BEGIN
 IF NOT coalesce((cfg->'businessHours'->>'enabled')::boolean,false) OR NOT coalesce((cfg->'businessHours'->>'ignoreWhatsappOutsideHours')::boolean,true) THEN RETURN true;END IF;
 local_time:=instant AT TIME ZONE coalesce(cfg->>'timeZone','America/Cuiaba');d:=extract(dow FROM local_time);m:=extract(hour FROM local_time)*60+extract(minute FROM local_time);
 FOR delta IN -1..0 LOOP
  SELECT value INTO r FROM jsonb_array_elements(cfg->'businessHours'->'days') WHERE (value->>'day')::integer=(d+delta+7)%7;
  IF coalesce((r->>'enabled')::boolean,false) THEN
   start_min:=split_part(r->>'open',':',1)::integer*60+split_part(r->>'open',':',2)::integer;
   end_min:=split_part(r->>'close',':',1)::integer*60+split_part(r->>'close',':',2)::integer;
   IF end_min<start_min THEN end_min:=end_min+1440;END IF;
   point:=m-delta*1440;IF point>=start_min AND point<end_min THEN RETURN coalesce((cfg->>'acceptingOrders')::boolean,true);END IF;
  END IF;
 END LOOP;RETURN false;
END $$;
REVOKE ALL ON FUNCTION bansir.whatsapp_open_at(jsonb,timestamptz) FROM PUBLIC;
CREATE OR REPLACE FUNCTION bansir.queue_meta_greeting() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
DECLARE cfg record;account record;last_at timestamptz;
BEGIN
 IF NOT bansir.whatsapp_open_at((SELECT config FROM bansir.storefronts WHERE tenant_id=NEW.tenant_id AND establishment_id=NEW.establishment_id),NEW.received_at) THEN RETURN NEW;END IF;
 IF NEW.direction<>'in' OR NEW.status<>'received' OR NEW.received_at<now()-interval '10 minutes' OR NEW.received_at>now()+interval '5 minutes' OR lower(trim(regexp_replace(NEW.body,'[!?.]+$','','g'))) NOT IN ('ola','olá','oi','bom dia','boa tarde','boa noite') THEN RETURN NEW; END IF;
 SELECT * INTO cfg FROM bansir.meta_greetings WHERE tenant_id=NEW.tenant_id AND establishment_id=NEW.establishment_id AND enabled;
 IF NOT FOUND OR(cfg.recipient_filter IS NOT NULL AND cfg.recipient_filter<>NEW.phone) OR NOT bansir.meta_sender_active(NEW.tenant_id,NEW.establishment_id,cfg.sender_user_id,'settings') THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM bansir.meta_contacts WHERE tenant_id=NEW.tenant_id AND establishment_id=NEW.establishment_id AND phone=NEW.phone AND NOT opt_in) THEN RETURN NEW;END IF;
 SELECT * INTO account FROM bansir.meta_accounts WHERE tenant_id=NEW.tenant_id AND establishment_id=NEW.establishment_id AND enabled;
 IF NOT FOUND THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||NEW.establishment_id::text||NEW.phone,0));
 SELECT last_queued_at INTO last_at FROM bansir.meta_greeting_contacts WHERE tenant_id=NEW.tenant_id AND establishment_id=NEW.establishment_id AND phone=NEW.phone;
 IF last_at>now()-interval '24 hours' THEN RETURN NEW; END IF;
 INSERT INTO bansir.jobs(tenant_id,establishment_id,kind,dedupe_key,payload,max_attempts) VALUES(NEW.tenant_id,NEW.establishment_id,'whatsapp','greeting:'||NEW.message_id,jsonb_build_object('userId',cfg.sender_user_id,'permission','settings','action','auto-greeting','phone',NEW.phone,'message',cfg.message,'metaPhoneId',account.phone_number_id,'metaWabaId',account.waba_id),5) ON CONFLICT DO NOTHING;
 INSERT INTO bansir.meta_greeting_contacts(tenant_id,establishment_id,phone,last_queued_at) VALUES(NEW.tenant_id,NEW.establishment_id,NEW.phone,now()) ON CONFLICT(tenant_id,establishment_id,phone) DO UPDATE SET last_queued_at=EXCLUDED.last_queued_at;
 RETURN NEW;
END $$;
