-- Preserve the actual posting time while attributing the receipt to a prior shift.
ALTER TABLE bansir.sale_payments ADD COLUMN cash_effective_at timestamptz;
CREATE OR REPLACE VIEW bansir.active_sale_payments WITH (security_invoker=true) AS SELECT * FROM bansir.sale_payments WHERE reversed_at IS NULL;
