ALTER TABLE bansir.customers
 ADD COLUMN additional_phone text NOT NULL DEFAULT '',
 ADD COLUMN additional_info text NOT NULL DEFAULT '';
