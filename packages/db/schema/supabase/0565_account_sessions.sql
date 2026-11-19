-- 0565: list and end one of the caller's own sign-in sessions (ADR-0363).
--
-- Supabase Auth keeps sessions in auth.sessions and offers a user only "sign out
-- others" and "sign out everywhere". These two functions let the signed-in devices
-- list show each session and end one. Both take the verified account id from the
-- Worker (never from the client), only ever touch rows of that account, and return
-- no IP address. plpgsql, like account_mfa_enrolled (0404): the body is resolved at
-- call time, because auth.sessions exists on Supabase but not in the bare replay
-- database. Service role only.
BEGIN;

CREATE OR REPLACE FUNCTION public.list_account_sessions(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(s)::jsonb ORDER BY s.last_used DESC)
    FROM (
      SELECT id::text AS id,
             pg_catalog.left(COALESCE(user_agent, ''), 300) AS user_agent,
             created_at,
             COALESCE(refreshed_at, updated_at, created_at) AS last_used
      FROM auth.sessions
      WHERE user_id = p_auth_id::uuid
        AND (not_after IS NULL OR not_after > pg_catalog.now())
      ORDER BY COALESCE(refreshed_at, updated_at, created_at) DESC
      LIMIT 50
    ) s
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.list_account_sessions(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_account_sessions(TEXT) TO service_role;

-- true when a session was ended; false when it was already gone or is not this
-- account's, so a replay or a guessed id changes nothing and reveals nothing.
CREATE OR REPLACE FUNCTION public.revoke_account_session(p_auth_id TEXT, p_session_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_rows INTEGER;
BEGIN
  IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR p_session_id IS NULL OR p_session_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  DELETE FROM auth.sessions WHERE id = p_session_id::uuid AND user_id = p_auth_id::uuid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END $$;
REVOKE ALL ON FUNCTION public.revoke_account_session(TEXT, TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_account_session(TEXT, TEXT) TO service_role;

-- Keep the admin endpoint inventory and the database telemetry allowlist in lockstep.
DO $$ BEGIN
  IF to_regprocedure('public.telemetry_path_allowed_pre_0565(text)') IS NULL THEN
    ALTER FUNCTION public.telemetry_path_allowed(TEXT) RENAME TO telemetry_path_allowed_pre_0565;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT p_path = '/api/v1/account/sessions' OR public.telemetry_path_allowed_pre_0565(p_path)
$$;
REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT) FROM PUBLIC,anon,authenticated,service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
