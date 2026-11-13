ALTER TABLE bansir.delivery_events ADD COLUMN reported_payment text
 CHECK (reported_payment IS NULL OR (reported_payment IN ('cash','pix','credit_card','debit_card','not_received') AND action='complete'));

ALTER TABLE bansir.storefront_orders ADD COLUMN requested_payment text
 CHECK (requested_payment IN ('cash','pix','credit_card','debit_card','arrange'));
GRANT INSERT(requested_payment) ON bansir.storefront_orders TO bansir_storefront;
