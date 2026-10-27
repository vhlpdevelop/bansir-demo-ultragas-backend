ALTER TABLE bansir.access_sessions ADD COLUMN refresh_hash text;
GRANT UPDATE(refresh_hash) ON bansir.access_sessions TO bansir_runtime;
