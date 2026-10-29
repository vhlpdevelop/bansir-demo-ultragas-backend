ALTER TABLE bansir.sale_payments ADD COLUMN installments integer NOT NULL DEFAULT 1 CHECK(installments BETWEEN 1 AND 24);
ALTER TABLE bansir.sale_payments ADD CONSTRAINT installments_credit_only CHECK(method='credit_card' OR installments=1);
