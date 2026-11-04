ALTER TABLE bansir.sale_payments ADD COLUMN reversed_at timestamptz;
CREATE VIEW bansir.active_sale_payments WITH(security_invoker=true) AS SELECT * FROM bansir.sale_payments WHERE reversed_at IS NULL;
GRANT SELECT ON bansir.active_sale_payments TO bansir_runtime;
GRANT UPDATE(reversed_at) ON bansir.sale_payments TO bansir_runtime;
CREATE TABLE bansir.sale_payment_reversals(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,payment_id uuid NOT NULL,sale_id uuid NOT NULL,cash_session_id uuid NOT NULL,user_id uuid NOT NULL,
 request_key uuid NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,payment_id),
 FOREIGN KEY(tenant_id,establishment_id,payment_id) REFERENCES bansir.sale_payments(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,sale_id) REFERENCES bansir.sales(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,cash_session_id) REFERENCES bansir.cash_sessions(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,user_id) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id));
ALTER TABLE bansir.sale_payment_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE bansir.sale_payment_reversals FORCE ROW LEVEL SECURITY;
CREATE POLICY unit_reversal ON bansir.sale_payment_reversals TO bansir_runtime USING(bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id));
GRANT SELECT,INSERT ON bansir.sale_payment_reversals TO bansir_runtime;
GRANT UPDATE(subtotal_cents,discount_cents,delivery_fee_cents,total_cents,payment_term,due_date) ON bansir.sales TO bansir_runtime;
GRANT UPDATE(quantity,unit_price_cents,gross_cents,discount_cents) ON bansir.sale_items TO bansir_runtime;
CREATE INDEX sale_reversal_cash ON bansir.sale_payment_reversals(tenant_id,establishment_id,cash_session_id,created_at);
DO $$DECLARE f record; BEGIN
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='bansir' AND p.proname IN('schedule_financial_alerts','agreement_alert_needed') LOOP
 EXECUTE replace(pg_get_functiondef(f.oid),'bansir.sale_payments','bansir.active_sale_payments');
 END LOOP;
END $$;

CREATE FUNCTION bansir.guard_payment_reversal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.reversed_at IS NOT NULL OR NEW.reversed_at IS NULL OR NEW.reversed_at<OLD.created_at OR NOT EXISTS(
 SELECT 1 FROM bansir.sale_payment_reversals r JOIN bansir.cash_sessions c ON(c.tenant_id,c.establishment_id,c.id)=(r.tenant_id,r.establishment_id,r.cash_session_id)
 WHERE(r.tenant_id,r.establishment_id,r.payment_id,r.sale_id)=(OLD.tenant_id,OLD.establishment_id,OLD.id,OLD.sale_id) AND c.closed_at IS NULL)
 THEN RAISE EXCEPTION 'Payment reversal requires an immutable audit and an open cash session' USING ERRCODE='42501';END IF;
 RETURN NEW;END $$;
REVOKE ALL ON FUNCTION bansir.guard_payment_reversal() FROM PUBLIC;
CREATE TRIGGER audited_payment_reversal BEFORE UPDATE OF reversed_at ON bansir.sale_payments FOR EACH ROW EXECUTE FUNCTION bansir.guard_payment_reversal();

ALTER TABLE bansir.sale_cancellations ADD COLUMN cash_session_id uuid;
ALTER TABLE bansir.sale_cancellations ADD FOREIGN KEY(tenant_id,establishment_id,cash_session_id) REFERENCES bansir.cash_sessions(tenant_id,establishment_id,id);
