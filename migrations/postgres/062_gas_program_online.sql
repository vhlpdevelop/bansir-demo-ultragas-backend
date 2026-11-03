ALTER TABLE bansir.sale_items ADD COLUMN gas_do_povo boolean NOT NULL DEFAULT false;
ALTER TABLE bansir.sale_payments DROP CONSTRAINT sale_payments_method_check;
ALTER TABLE bansir.sale_payments ADD CONSTRAINT sale_payments_method_check CHECK (method IN ('cash','pix','credit_card','debit_card','online'));
