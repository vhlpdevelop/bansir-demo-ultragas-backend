ALTER TABLE bansir.customers ADD COLUMN email text NOT NULL DEFAULT '';
ALTER TABLE bansir.customers ADD COLUMN birth_date text NOT NULL DEFAULT '';
ALTER TABLE bansir.customers ADD COLUMN notes text NOT NULL DEFAULT '';
CREATE FUNCTION bansir.normalize_customer_phone(raw text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d text:=regexp_replace(coalesce(raw,''),'[^0-9]','','g');
BEGIN
 IF length(d) IN(12,13) AND left(d,2)='55' THEN d:=substr(d,3); END IF;
 IF left(d,2)<>ALL(string_to_array('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99',' ')) THEN RETURN NULL; END IF;
 IF length(d)=10 AND substr(d,3,1)~'[6-9]' THEN d:=left(d,2)||'9'||substr(d,3); END IF;
 IF (length(d)=11 AND substr(d,3,1)='9') OR (length(d)=10 AND substr(d,3,1)~'[2-5]') THEN RETURN '55'||d; END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION bansir.customer_lookup_phone(phone text,metadata jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN trim(phone)<>'' THEN bansir.normalize_customer_phone(phone) ELSE coalesce(bansir.normalize_customer_phone(metadata->>'mobile'),bansir.normalize_customer_phone(metadata->>'telephone')) END
$$;
REVOKE ALL ON FUNCTION bansir.normalize_customer_phone(text),bansir.customer_lookup_phone(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.normalize_customer_phone(text),bansir.customer_lookup_phone(text,jsonb) TO bansir_runtime;
CREATE INDEX customer_canonical_phone ON bansir.customers(tenant_id,establishment_id,bansir.customer_lookup_phone(phone,import_metadata)) WHERE active;
WITH candidates AS (
 SELECT tenant_id,establishment_id,id,phone,bansir.customer_lookup_phone(phone,import_metadata) AS normalized,
 count(*) OVER(PARTITION BY tenant_id,establishment_id,bansir.customer_lookup_phone(phone,import_metadata)) AS matches
 FROM bansir.customers WHERE active
)
UPDATE bansir.customers c SET phone=CASE WHEN x.matches=1 THEN x.normalized ELSE c.phone END,
 import_metadata=c.import_metadata||jsonb_build_object('phoneBeforeRepair',c.phone,'phoneRepairConflict',x.matches>1)
FROM candidates x WHERE(c.tenant_id,c.establishment_id,c.id)=(x.tenant_id,x.establishment_id,x.id) AND x.normalized IS NOT NULL AND c.phone IS DISTINCT FROM x.normalized;
CREATE OR REPLACE FUNCTION bansir.checkout_customer_snapshot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
DECLARE candidate uuid; matches integer; BEGIN
 SELECT count(*),(array_agg(id))[1] INTO matches,candidate FROM bansir.customers
 WHERE tenant_id=NEW.tenant_id AND establishment_id=NEW.establishment_id AND active AND bansir.customer_lookup_phone(phone,import_metadata)=NEW.phone;
 NEW.customer_id=CASE WHEN matches=1 THEN candidate ELSE NULL END;RETURN NEW;
END $$;
-- Recover unlinked public orders only when one active customer matches in that unit.
WITH matches AS (
 SELECT o.tenant_id,o.establishment_id,o.id,(array_agg(c.id))[1] AS customer_id
 FROM bansir.storefront_orders o JOIN bansir.customers c ON c.tenant_id=o.tenant_id AND c.establishment_id=o.establishment_id AND c.active
 AND bansir.customer_lookup_phone(c.phone,c.import_metadata)=bansir.normalize_customer_phone(o.phone)
 WHERE o.customer_id IS NULL GROUP BY o.tenant_id,o.establishment_id,o.id HAVING count(*)=1
)
UPDATE bansir.storefront_orders o SET customer_id=m.customer_id FROM matches m WHERE(o.tenant_id,o.establishment_id,o.id)=(m.tenant_id,m.establishment_id,m.id);
