CREATE TABLE bansir.user_appearance (
 user_id uuid PRIMARY KEY REFERENCES bansir.users(id) ON DELETE CASCADE,
 preference jsonb NOT NULL
);
ALTER TABLE bansir.user_appearance ENABLE ROW LEVEL SECURITY;
ALTER TABLE bansir.user_appearance FORCE ROW LEVEL SECURITY;
CREATE POLICY user_appearance_self ON bansir.user_appearance TO bansir_runtime
 USING (user_id=bansir.actor_id()) WITH CHECK (user_id=bansir.actor_id());
GRANT SELECT,INSERT,UPDATE ON bansir.user_appearance TO bansir_runtime;
