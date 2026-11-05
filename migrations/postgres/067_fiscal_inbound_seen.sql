ALTER TABLE bansir.fiscal_inbound ADD COLUMN badge_since timestamptz;
ALTER TABLE bansir.fiscal_inbound ALTER COLUMN badge_since SET DEFAULT now();
CREATE TABLE bansir.fiscal_inbound_seen (
 tenant_id uuid NOT NULL, establishment_id uuid NOT NULL, document_id uuid NOT NULL, user_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,establishment_id,user_id,document_id),
 FOREIGN KEY(tenant_id,establishment_id,document_id) REFERENCES bansir.fiscal_inbound(tenant_id,establishment_id,id)
);
ALTER TABLE bansir.fiscal_inbound_seen ENABLE ROW LEVEL SECURITY;
ALTER TABLE bansir.fiscal_inbound_seen FORCE ROW LEVEL SECURITY;
CREATE POLICY fiscal_seen_self ON bansir.fiscal_inbound_seen TO bansir_runtime
 USING (user_id=bansir.actor_id() AND bansir.can_access_establishment(tenant_id,establishment_id))
 WITH CHECK (user_id=bansir.actor_id() AND bansir.can_access_establishment(tenant_id,establishment_id));
GRANT SELECT,INSERT ON bansir.fiscal_inbound_seen TO bansir_runtime;
