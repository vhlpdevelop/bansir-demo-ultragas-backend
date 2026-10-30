-- Existing browser credentials remain valid. SmartPOS has an independent slot.
ALTER TABLE bansir.pdv_terminals
 ADD COLUMN smartpos_hash text UNIQUE,
 ADD COLUMN smartpos_metadata jsonb NOT NULL DEFAULT '{}',
 ADD COLUMN smartpos_last_seen_at timestamptz;
