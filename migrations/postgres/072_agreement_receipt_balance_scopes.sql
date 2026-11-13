-- Receipt balances are independent: the participant balance and the group balance can be
-- shown together, separately or not at all. Existing behavior is preserved by the backfill.
ALTER TABLE bansir.agreements
 ADD COLUMN show_receipt_individual_balance boolean NOT NULL DEFAULT false,
 ADD COLUMN show_receipt_group_balance boolean NOT NULL DEFAULT true;
UPDATE bansir.agreements SET
 show_receipt_individual_balance=individual_balance AND show_receipt_balance,
 show_receipt_group_balance=NOT individual_balance AND show_receipt_balance;

