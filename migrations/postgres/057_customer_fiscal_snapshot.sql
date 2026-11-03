ALTER TABLE bansir.customers ADD COLUMN fiscal_data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(fiscal_data)='object');
ALTER TABLE bansir.sales ADD COLUMN customer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(customer_snapshot)='object');
