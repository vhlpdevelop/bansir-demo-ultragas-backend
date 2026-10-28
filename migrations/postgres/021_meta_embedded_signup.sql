ALTER TABLE bansir.meta_accounts ADD COLUMN onboarding_id uuid;
CREATE TABLE bansir.meta_onboarding(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),user_id uuid NOT NULL,auth_session_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'created' CHECK(state IN('created','stored','active')),expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,id),FOREIGN KEY(tenant_id,establishment_id,user_id) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id)
);
ALTER TABLE bansir.meta_onboarding ENABLE ROW LEVEL SECURITY;ALTER TABLE bansir.meta_onboarding FORCE ROW LEVEL SECURITY;
CREATE POLICY unit_runtime ON bansir.meta_onboarding TO bansir_runtime USING(bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id));
GRANT SELECT,INSERT,UPDATE ON bansir.meta_onboarding TO bansir_runtime;
