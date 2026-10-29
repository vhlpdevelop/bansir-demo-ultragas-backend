CREATE TABLE bansir.auth_attempt_windows (
 scope text NOT NULL CHECK(scope IN('tenant-ip','tenant-account','platform-ip','platform-account')),
 subject_hash text NOT NULL CHECK(subject_hash ~ '^[a-f0-9]{64}$'),
 started_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,hits integer NOT NULL CHECK(hits>0),
 PRIMARY KEY(scope,subject_hash)
);
CREATE INDEX auth_window_expiry ON bansir.auth_attempt_windows(expires_at);
REVOKE ALL ON bansir.auth_attempt_windows FROM PUBLIC,bansir_runtime,bansir_worker;
CREATE FUNCTION bansir.auth_attempt(scope_name text,subject text,clear_success boolean DEFAULT false) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
DECLARE cap integer; row_window bansir.auth_attempt_windows; stamp timestamptz:=clock_timestamp();
BEGIN
 cap:=CASE scope_name WHEN 'tenant-ip' THEN 60 WHEN 'tenant-account' THEN 10 WHEN 'platform-ip' THEN 20 WHEN 'platform-account' THEN 5 END;
 IF cap IS NULL OR subject !~ '^[a-f0-9]{64}$' OR subject IS NULL THEN RAISE EXCEPTION 'Invalid auth throttle scope' USING ERRCODE='22023'; END IF;
 IF clear_success THEN
  IF scope_name NOT IN('tenant-account','platform-account') THEN RAISE EXCEPTION 'Invalid auth throttle reset' USING ERRCODE='22023'; END IF;
  DELETE FROM bansir.auth_attempt_windows WHERE scope=scope_name AND subject_hash=subject;RETURN 0;
 END IF;
 -- Fixed windows never extend on blocked attempts. Bound opportunistic cleanup.
 DELETE FROM bansir.auth_attempt_windows WHERE (scope,subject_hash) IN (
  SELECT scope,subject_hash FROM bansir.auth_attempt_windows WHERE expires_at<stamp ORDER BY expires_at LIMIT 100
 );
 INSERT INTO bansir.auth_attempt_windows AS w(scope,subject_hash,started_at,expires_at,hits)
 VALUES(scope_name,subject,stamp,stamp+interval '15 minutes',1)
 ON CONFLICT(scope,subject_hash) DO UPDATE SET
  started_at=CASE WHEN w.expires_at<=stamp THEN stamp ELSE w.started_at END,
  expires_at=CASE WHEN w.expires_at<=stamp THEN stamp+interval '15 minutes' ELSE w.expires_at END,
  hits=CASE WHEN w.expires_at<=stamp THEN 1 ELSE least(w.hits+1,cap+1) END
 RETURNING * INTO row_window;
 IF row_window.hits>cap THEN RETURN greatest(1,ceil(extract(epoch FROM row_window.expires_at-stamp))::integer);END IF;
 RETURN 0;
END $$;
REVOKE ALL ON FUNCTION bansir.auth_attempt(text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.auth_attempt(text,text,boolean) TO bansir_runtime;
