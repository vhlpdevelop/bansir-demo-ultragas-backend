ALTER TABLE bansir.pdv_terminal_smartpos ADD COLUMN pix_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE bansir.pdv_smartpos_codes ADD COLUMN pix_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE bansir.smartpos_charges DROP CONSTRAINT smartpos_charges_method_check;
ALTER TABLE bansir.smartpos_charges ADD CHECK(method IN('credit_card','debit_card','pix'));
