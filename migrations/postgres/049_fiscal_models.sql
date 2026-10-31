-- Existing counters belong to NFC-e. Never restart their numbering.
ALTER TABLE bansir.fiscal_numbering ADD COLUMN model integer NOT NULL DEFAULT 65 CHECK(model IN(55,65));
ALTER TABLE bansir.fiscal_numbering DROP CONSTRAINT fiscal_numbering_pkey;
ALTER TABLE bansir.fiscal_numbering ADD PRIMARY KEY(tenant_id,establishment_id,environment,series,model);
