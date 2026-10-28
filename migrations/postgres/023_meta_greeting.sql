CREATE TABLE bansir.meta_greetings (
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,enabled boolean NOT NULL DEFAULT false,
 message text NOT NULL CHECK(length(message) BETWEEN 1 AND 1024),sender_user_id uuid NOT NULL REFERENCES bansir.users(id),
 recipient_filter text CHECK(recipient_filter IS NULL OR recipient_filter ~ '^[0-9]{10,15}$'),
 updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,establishment_id),
 FOREIGN KEY(tenant_id,establishment_id) REFERENCES bansir.establishments(tenant_id,id)
);
ALTER TABLE bansir.meta_greetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bansir.meta_greetings FORCE ROW LEVEL SECURITY;
CREATE POLICY greeting_scope ON bansir.meta_greetings TO bansir_runtime USING(bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id));
GRANT SELECT,INSERT,UPDATE ON bansir.meta_greetings TO bansir_runtime;
CREATE POLICY greeting_worker ON bansir.meta_greetings FOR SELECT TO bansir_worker USING(tenant_id=bansir.tenant_id() AND establishment_id=bansir.establishment_id());
GRANT SELECT ON bansir.meta_greetings TO bansir_worker;
CREATE TABLE bansir.meta_greeting_contacts (
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,phone text NOT NULL,last_queued_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,establishment_id,phone), FOREIGN KEY(tenant_id,establishment_id) REFERENCES bansir.establishments(tenant_id,id)
);
REVOKE ALL ON bansir.meta_greeting_contacts FROM PUBLIC;
CREATE FUNCTION bansir.queue_meta_greeting() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
DECLARE cfg record;account record;last_at timestamptz;
BEGIN
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
REVOKE ALL ON FUNCTION bansir.queue_meta_greeting() FROM PUBLIC;
CREATE TRIGGER meta_greeting_after_incoming AFTER INSERT ON bansir.meta_messages FOR EACH ROW EXECUTE FUNCTION bansir.queue_meta_greeting();
ALTER TABLE bansir.meta_greeting_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bansir.meta_greeting_contacts FORCE ROW LEVEL SECURITY;

