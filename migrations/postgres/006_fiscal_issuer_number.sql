-- Different access-key random codes do not permit reuse of an issuer/model/series/number.
-- Protect this identity even if a CNPJ is configured in more than one logical unit.
CREATE UNIQUE INDEX fiscal_issuer_number ON bansir.fiscal_documents
 (environment,substring(access_key FROM 7 FOR 14),substring(access_key FROM 21 FOR 2),substring(access_key FROM 23 FOR 3),substring(access_key FROM 26 FOR 9));
