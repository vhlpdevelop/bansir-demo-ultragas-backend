ALTER TABLE bansir.agreements
 ADD COLUMN individual_balance boolean NOT NULL DEFAULT false,
 ADD COLUMN show_receipt_balance boolean NOT NULL DEFAULT true;
