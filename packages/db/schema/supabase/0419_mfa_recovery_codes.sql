-- ADR-0311: recovery removes only the TOTP factors bound at provisioning time.
BEGIN;
CREATE TABLE IF NOT EXISTS public.mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  batch_id uuid NOT NULL,
  factor_ids uuid[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  UNIQUE (user_id, code_hash)
);
ALTER TABLE public.mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfa_recovery_codes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mfa_recovery_codes FROM PUBLIC,anon,authenticated;

-- One bounded sliding window per user; no per-attempt rows or isolate-local bypass.
CREATE TABLE IF NOT EXISTS public.mfa_recovery_attempts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  attempted_at timestamptz[] NOT NULL DEFAULT '{}'
);
ALTER TABLE public.mfa_recovery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfa_recovery_attempts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mfa_recovery_attempts FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.mfa_recovery_attempt(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_attempts timestamptz[]; v_now timestamptz := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('mfa_recovery:' || p_user_id));
  SELECT coalesce(array_agg(a), '{}'::timestamptz[]) INTO v_attempts
    FROM public.mfa_recovery_attempts r, unnest(r.attempted_at) a
    WHERE r.user_id=p_user_id AND a > v_now - interval '15 minutes';
  IF cardinality(v_attempts) >= 5 THEN RETURN false; END IF;
  INSERT INTO public.mfa_recovery_attempts(user_id,attempted_at)
    VALUES(p_user_id,array_append(v_attempts,v_now))
    ON CONFLICT(user_id) DO UPDATE SET attempted_at=EXCLUDED.attempted_at;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.mfa_recovery_replace(
  p_user_id uuid, p_hashes text[], p_batch uuid, p_factor_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('mfa_recovery:' || p_user_id));
  IF coalesce(cardinality(p_factor_ids),0)=0 OR coalesce(cardinality(p_hashes),0)=0
    OR p_batch IS NULL THEN RAISE EXCEPTION 'invalid_recovery_batch'; END IF;
  DELETE FROM public.mfa_recovery_codes WHERE user_id=p_user_id;
  INSERT INTO public.mfa_recovery_codes(user_id,code_hash,batch_id,factor_ids)
    SELECT p_user_id,h,p_batch,p_factor_ids FROM (SELECT DISTINCT unnest(p_hashes) h) hashes;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public.mfa_recovery_consume(p_user_id uuid, p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_batch uuid; v_bound uuid[]; v_current uuid[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('mfa_recovery:' || p_user_id));
  UPDATE public.mfa_recovery_codes SET used_at=now()
    WHERE user_id=p_user_id AND code_hash=p_hash AND used_at IS NULL
    RETURNING batch_id,factor_ids INTO v_batch,v_bound;
  IF NOT FOUND THEN RETURN jsonb_build_object('consumed',false,'factor_ids','[]'::jsonb); END IF;
  -- plpgsql resolves auth.mfa_factors at call time, like 0404 (bare replay lacks it).
  SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO v_current FROM auth.mfa_factors
    WHERE user_id=p_user_id AND factor_type='totp' AND status='verified' AND id=ANY(v_bound);
  RETURN jsonb_build_object('consumed',true,'factor_ids',v_current,'stale',cardinality(v_current)=0);
END $$;

CREATE OR REPLACE FUNCTION public.mfa_recovery_status(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_current uuid[]; v_total integer; v_unused integer; v_usable integer;
  v_batch uuid; v_created timestamptz; v_missing boolean;
BEGIN
  SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO v_current FROM auth.mfa_factors
    WHERE user_id=p_user_id AND factor_type='totp' AND status='verified';
  SELECT count(*),count(*) FILTER(WHERE used_at IS NULL),
    count(*) FILTER(WHERE used_at IS NULL AND factor_ids && v_current)
    INTO v_total,v_unused,v_usable FROM public.mfa_recovery_codes WHERE user_id=p_user_id;
  SELECT batch_id,created_at INTO v_batch,v_created FROM public.mfa_recovery_codes
    WHERE user_id=p_user_id ORDER BY created_at DESC LIMIT 1;
  SELECT EXISTS(SELECT 1 FROM unnest(v_current) f WHERE NOT EXISTS(
    SELECT 1 FROM public.mfa_recovery_codes c WHERE c.user_id=p_user_id
      AND c.used_at IS NULL AND f=ANY(c.factor_ids))) INTO v_missing;
  RETURN jsonb_build_object('total',v_total,'unused',v_unused,'usable',v_usable,
    'batch_id',v_batch,'generated_at',v_created,'enrolled',cardinality(v_current)>0,
    'needs_regeneration',cardinality(v_current)>0 AND (v_usable=0 OR v_missing));
END $$;

REVOKE ALL ON FUNCTION public.mfa_recovery_attempt(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mfa_recovery_replace(uuid,text[],uuid,uuid[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mfa_recovery_consume(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mfa_recovery_status(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mfa_recovery_attempt(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mfa_recovery_replace(uuid,text[],uuid,uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.mfa_recovery_consume(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mfa_recovery_status(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
