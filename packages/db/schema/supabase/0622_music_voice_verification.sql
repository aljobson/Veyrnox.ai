-- Default-off, provider-independent ownership review for reusable Music voices.
-- No biometric template or provider persona is created. Private uploads are
-- queued for deletion no later than their immutable PUT expiry plus the reaper interval.
BEGIN;

CREATE TABLE IF NOT EXISTS public.music_voice_profiles (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80 AND name !~ '[[:cntrl:]]'),
  status TEXT NOT NULL CHECK(status IN('challenge_issued','pending_review','verified','rejected','revoked','expired')),
  reference_source_key TEXT UNIQUE,
  reference_mime_type TEXT CHECK(reference_mime_type IS NULL OR reference_mime_type IN('audio/mpeg','audio/wav')),
  reference_size_bytes BIGINT CHECK(reference_size_bytes IS NULL OR reference_size_bytes BETWEEN 1 AND 20971520),
  reference_duration_seconds NUMERIC(8,3) CHECK(reference_duration_seconds IS NULL OR reference_duration_seconds BETWEEN 2 AND 300),
  challenge_source_key TEXT UNIQUE,
  challenge_mime_type TEXT CHECK(challenge_mime_type IS NULL OR challenge_mime_type IN('audio/mpeg','audio/wav')),
  challenge_size_bytes BIGINT CHECK(challenge_size_bytes IS NULL OR challenge_size_bytes BETWEEN 1 AND 20971520),
  challenge_duration_seconds NUMERIC(8,3) CHECK(challenge_duration_seconds IS NULL OR challenge_duration_seconds BETWEEN 2 AND 60),
  challenge_nonce TEXT,
  challenge_hmac TEXT,
  challenge_ciphertext TEXT,
  challenge_issued_at TIMESTAMPTZ NOT NULL,
  challenge_expires_at TIMESTAMPTZ NOT NULL,
  challenge_attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK(challenge_attempt_count BETWEEN 0 AND 3),
  challenge_reissue_count SMALLINT NOT NULL DEFAULT 0 CHECK(challenge_reissue_count BETWEEN 0 AND 2),
  submission_revision INTEGER NOT NULL DEFAULT 0 CHECK(submission_revision BETWEEN 0 AND 2147483647),
  review_expires_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  verification_expires_at TIMESTAMPTZ,
  reason_code TEXT,
  consent_version TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  attested_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  deletion_queued_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK(reference_source_key IS NULL OR challenge_source_key IS NULL OR reference_source_key<>challenge_source_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS music_voice_one_active_per_user_idx ON public.music_voice_profiles(user_id)
  WHERE status IN('challenge_issued','pending_review','verified');
CREATE INDEX IF NOT EXISTS music_voice_review_queue_idx ON public.music_voice_profiles(status,created_at)
  WHERE status='pending_review';

CREATE TABLE IF NOT EXISTS public.music_voice_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.music_voice_profiles(id) ON DELETE RESTRICT,
  actor_user_id UUID REFERENCES public.users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK(event_type IN('enrolled','challenge_reissued','challenge_failed','submitted','evidence_viewed','evidence_delivered','approved','rejected','revoked','expired','account_erased')),
  submission_revision INTEGER NOT NULL CHECK(submission_revision BETWEEN 0 AND 2147483647),
  reason_code TEXT,
  checklist JSONB CHECK(checklist IS NULL OR (jsonb_typeof(checklist)='object'
    AND checklist-'phrase_exact'-'reference_consistent'-'no_synthetic_concerns'-'policy_acknowledged'='{}'::jsonb
    AND jsonb_typeof(checklist->'phrase_exact')='boolean' AND jsonb_typeof(checklist->'reference_consistent')='boolean'
    AND jsonb_typeof(checklist->'no_synthetic_concerns')='boolean' AND jsonb_typeof(checklist->'policy_acknowledged')='boolean')),
  policy_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS music_voice_events_profile_idx ON public.music_voice_events(profile_id,created_at);
CREATE INDEX IF NOT EXISTS music_voice_events_actor_idx ON public.music_voice_events(actor_user_id)
  WHERE actor_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.music_voice_receipts (
  actor_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK(operation IN('enroll','reissue','submit','revoke','review')),
  idempotency_key TEXT NOT NULL CHECK(idempotency_key~'^[A-Za-z0-9._-]{8,120}$'),
  request_digest TEXT NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(actor_user_id,operation,idempotency_key)
);

-- Content-free tombstones prevent an upload key from ever being rebound after
-- revoke/reject/expiry has already authorized its deletion.
CREATE TABLE IF NOT EXISTS public.music_voice_source_tombstones (
  source_digest TEXT PRIMARY KEY CHECK(source_digest~'^[a-f0-9]{64}$'),
  profile_id UUID NOT NULL REFERENCES public.music_voice_profiles(id) ON DELETE RESTRICT,
  source_kind TEXT NOT NULL CHECK(source_kind IN('reference','challenge')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS music_voice_source_tombstones_profile_idx
  ON public.music_voice_source_tombstones(profile_id);

ALTER TABLE public.music_voice_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_voice_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.music_voice_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_voice_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.music_voice_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_voice_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.music_voice_source_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_voice_source_tombstones FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.music_voice_profiles,public.music_voice_events,public.music_voice_receipts,public.music_voice_source_tombstones FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.music_voice_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF TG_OP='TRUNCATE' THEN
  RAISE EXCEPTION '% is append-only (attempted TRUNCATE)',TG_TABLE_NAME USING ERRCODE='42501';
 END IF;
 RAISE EXCEPTION 'APPEND_ONLY' USING ERRCODE='55000';
END $$;
REVOKE ALL ON FUNCTION private.music_voice_append_only() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS music_voice_events_immutable ON public.music_voice_events;
CREATE TRIGGER music_voice_events_immutable BEFORE UPDATE OR DELETE ON public.music_voice_events
  FOR EACH ROW EXECUTE FUNCTION private.music_voice_append_only();
DROP TRIGGER IF EXISTS music_voice_events_no_truncate ON public.music_voice_events;
CREATE TRIGGER music_voice_events_no_truncate BEFORE TRUNCATE ON public.music_voice_events
  FOR EACH STATEMENT EXECUTE FUNCTION private.music_voice_append_only();
DROP TRIGGER IF EXISTS music_voice_receipts_immutable ON public.music_voice_receipts;
CREATE TRIGGER music_voice_receipts_immutable BEFORE UPDATE OR DELETE ON public.music_voice_receipts
  FOR EACH ROW EXECUTE FUNCTION private.music_voice_append_only();
DROP TRIGGER IF EXISTS music_voice_receipts_no_truncate ON public.music_voice_receipts;
CREATE TRIGGER music_voice_receipts_no_truncate BEFORE TRUNCATE ON public.music_voice_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION private.music_voice_append_only();
DROP TRIGGER IF EXISTS music_voice_source_tombstones_immutable ON public.music_voice_source_tombstones;
CREATE TRIGGER music_voice_source_tombstones_immutable BEFORE UPDATE OR DELETE ON public.music_voice_source_tombstones
  FOR EACH ROW EXECUTE FUNCTION private.music_voice_append_only();
DROP TRIGGER IF EXISTS music_voice_source_tombstones_no_truncate ON public.music_voice_source_tombstones;
CREATE TRIGGER music_voice_source_tombstones_no_truncate BEFORE TRUNCATE ON public.music_voice_source_tombstones
  FOR EACH STATEMENT EXECUTE FUNCTION private.music_voice_append_only();

CREATE OR REPLACE FUNCTION private.music_voice_json(r public.music_voice_profiles) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object('id',r.id,'name',r.name,'status',CASE
   WHEN r.status='challenge_issued' AND r.challenge_expires_at<=clock_timestamp() THEN 'expired'
   WHEN r.status='pending_review' AND r.review_expires_at<=clock_timestamp() THEN 'expired'
   WHEN r.status='verified' AND r.verification_expires_at<=clock_timestamp() THEN 'expired' ELSE r.status END,
  'submission_revision',r.submission_revision,'challenge_expires_at',r.challenge_expires_at,
  'review_expires_at',r.review_expires_at,'verified_at',r.verified_at,
  'verification_expires_at',r.verification_expires_at,
  'reason_code',CASE WHEN r.status='rejected' THEN 'not_verified'
   WHEN (r.status='challenge_issued' AND r.challenge_expires_at<=clock_timestamp())
     OR (r.status='pending_review' AND r.review_expires_at<=clock_timestamp())
     OR (r.status='verified' AND r.verification_expires_at<=clock_timestamp()) THEN 'expired' ELSE NULL END,
  'created_at',r.created_at,'updated_at',r.updated_at))
$$;
REVOKE ALL ON FUNCTION private.music_voice_json(public.music_voice_profiles) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.music_voice_queue_media(r public.music_voice_profiles) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k TEXT; deadline TIMESTAMPTZ; BEGIN
 FOREACH k IN ARRAY ARRAY[r.reference_source_key,r.challenge_source_key] LOOP
  IF k IS NOT NULL THEN
   SELECT greatest(clock_timestamp(),put_expires_at) INTO deadline
    FROM public.upload_reservations WHERE r2_key=k;
   -- Account erasure removes upload_reservations before the users.deleted_at
   -- trigger runs. Preserve the maximum 16-minute PUT window when that row is
   -- already gone, so an issued upload can never race deletion.
   IF deadline IS NULL THEN deadline:=clock_timestamp()+interval '16 minutes'; END IF;
   INSERT INTO public.asset_reap_queue(r2_key,not_before) VALUES(k,deadline)
    ON CONFLICT(r2_key) DO UPDATE SET not_before=greatest(public.asset_reap_queue.not_before,EXCLUDED.not_before);
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.music_voice_queue_media(public.music_voice_profiles) FROM PUBLIC,anon,authenticated,service_role;

-- Voice evidence is single-purpose. Reject a generic upload already bound to
-- any other durable consumer; once accepted, its reservation is consumed so
-- later generic job/source binders cannot reuse the key.
CREATE OR REPLACE FUNCTION private.music_voice_source_unbound(p_key TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.assets WHERE r2_key=p_key)
 AND NOT EXISTS(SELECT 1 FROM public.evidence_holds WHERE r2_key=p_key AND released_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.music_source_assets WHERE r2_key=p_key AND status<>'deleted')
 AND NOT EXISTS(SELECT 1 FROM public.jobs j, LATERAL jsonb_each_text(
   CASE WHEN jsonb_typeof(j.inputs->'source_keys')='object' THEN j.inputs->'source_keys' ELSE '{}'::jsonb END) source
   WHERE source.value=p_key)
 AND NOT EXISTS(SELECT 1 FROM public.jobs j, LATERAL jsonb_array_elements(
   CASE WHEN jsonb_typeof(j.inputs->'references')='array' THEN j.inputs->'references' ELSE '[]'::jsonb END) reference
   WHERE reference->>'origin'='upload' AND reference->>'key'=p_key)
$$;
REVOKE ALL ON FUNCTION private.music_voice_source_unbound(TEXT) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.music_voice_fresh_mfa(p_aal TEXT,p_mfa_at TIMESTAMPTZ) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path='' AS $$ SELECT p_aal='aal2' AND p_mfa_at IS NOT NULL AND isfinite(p_mfa_at)
 AND p_mfa_at BETWEEN clock_timestamp()-interval '300 seconds' AND clock_timestamp()+interval '5 seconds' $$;
REVOKE ALL ON FUNCTION private.music_voice_fresh_mfa(TEXT,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.music_voice_owner(p_auth_id TEXT) RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT id FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL AND frozen_at IS NULL
$$;
REVOKE ALL ON FUNCTION private.music_voice_owner(TEXT) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.music_voice_list(p_auth_id TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE u UUID; rows JSONB; BEGIN
 u:=private.music_voice_owner(p_auth_id); IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 SELECT coalesce(jsonb_agg(private.music_voice_json(v) ORDER BY v.created_at DESC),'[]'::jsonb) INTO rows
  FROM (SELECT * FROM public.music_voice_profiles WHERE user_id=u ORDER BY created_at DESC LIMIT 20) v;
 RETURN jsonb_build_object('ok',true,'profiles',rows);
END $$;

-- The generic 24-hour upload sweep asks this before deleting anything. Active
-- evidence remains protected until an explicit terminal transition queues it.
CREATE OR REPLACE FUNCTION public.music_voice_protected_uploads() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('ok',true,'keys',coalesce(jsonb_agg(k),'[]'::jsonb)) FROM (
  SELECT reference_source_key AS k FROM public.music_voice_profiles
   WHERE status IN('challenge_issued','pending_review','verified') AND reference_source_key IS NOT NULL
  UNION
  SELECT challenge_source_key AS k FROM public.music_voice_profiles
   WHERE status IN('challenge_issued','pending_review','verified') AND challenge_source_key IS NOT NULL
 ) retained
$$;
REVOKE ALL ON FUNCTION public.music_voice_protected_uploads() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_voice_protected_uploads() TO service_role;

-- The cleanup worker uses this narrow lookup immediately before every R2
-- delete, closing the gap between its initial protection snapshot and delete.
CREATE OR REPLACE FUNCTION public.music_voice_upload_protected(p_key TEXT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('ok',true,'protected',EXISTS(
  SELECT 1 FROM public.music_voice_profiles WHERE status IN('challenge_issued','pending_review','verified')
   AND (reference_source_key=p_key OR challenge_source_key=p_key)))
$$;
REVOKE ALL ON FUNCTION public.music_voice_upload_protected(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_voice_upload_protected(TEXT) TO service_role;

-- Preserve every pre-existing reaper fence and add the voice profile as a
-- final authority. A queued key cannot be deleted after an active rebind.
CREATE OR REPLACE FUNCTION public.asset_reap_allowed(p_key TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (auth.uid() IS NULL OR EXISTS(SELECT 1 FROM public.editor_library_renders WHERE owner_id=auth.uid() AND r2_key=p_key))
 AND NOT EXISTS(SELECT 1 FROM public.evidence_holds WHERE r2_key=p_key AND released_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.assets WHERE r2_key=p_key)
 AND NOT EXISTS(SELECT 1 FROM public.asset_reap_queue WHERE r2_key=p_key AND not_before>now())
 AND NOT EXISTS(SELECT 1 FROM public.music_voice_profiles WHERE status IN('challenge_issued','pending_review','verified')
   AND (reference_source_key=p_key OR challenge_source_key=p_key));
$$;
REVOKE ALL ON FUNCTION public.asset_reap_allowed(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.asset_reap_allowed(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.music_voice_challenge_context(p_auth_id TEXT,p_profile_id UUID,p_idem_key TEXT,p_request_digest TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE u UUID; v public.music_voice_profiles; seen public.music_voice_receipts; BEGIN
 u:=private.music_voice_owner(p_auth_id); IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 SELECT * INTO v FROM public.music_voice_profiles WHERE id=p_profile_id AND user_id=u;
 IF v.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','CHALLENGE_UNAVAILABLE'); END IF;
 SELECT * INTO seen FROM public.music_voice_receipts WHERE actor_user_id=u AND operation='submit'
  AND idempotency_key=p_idem_key AND result->>'profile_id'=v.id::text;
 IF FOUND THEN
  IF seen.request_digest<>p_request_digest THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  RETURN jsonb_build_object('ok',true,'replay',true);
 END IF;
 IF v.status<>'challenge_issued' OR v.challenge_expires_at<=clock_timestamp() OR v.challenge_nonce IS NULL
  THEN RETURN jsonb_build_object('ok',false,'code','CHALLENGE_UNAVAILABLE'); END IF;
 RETURN jsonb_build_object('ok',true,'nonce',v.challenge_nonce,'challenge_expires_at',v.challenge_expires_at,'replay',false);
END $$;

-- Enrollment consumes its upload reservation, so the route must be able to
-- resolve an idempotent retry before it tries to inspect that reservation.
-- This returns only the same owner projection that a completed enrollment
-- already returned; the one-time plaintext phrase is never replayed.
CREATE OR REPLACE FUNCTION public.music_voice_enroll_context(p_auth_id TEXT,p_idem_key TEXT,p_request_digest TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE u UUID; v public.music_voice_profiles; seen public.music_voice_receipts; BEGIN
 u:=private.music_voice_owner(p_auth_id); IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 SELECT * INTO seen FROM public.music_voice_receipts WHERE actor_user_id=u AND operation='enroll' AND idempotency_key=p_idem_key;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'replay',false); END IF;
 IF seen.request_digest<>p_request_digest THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
 SELECT * INTO v FROM public.music_voice_profiles WHERE id=(seen.result->>'profile_id')::uuid AND user_id=u;
 IF v.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 RETURN jsonb_build_object('ok',true,'replay',true,'profile',private.music_voice_json(v));
END $$;

CREATE OR REPLACE FUNCTION public.music_voice_enroll(p_auth_id TEXT,p_profile_id UUID,p_name TEXT,p_reference_key TEXT,
 p_reference_mime TEXT,p_reference_size BIGINT,p_reference_seconds NUMERIC,p_nonce TEXT,p_hmac TEXT,p_ciphertext TEXT,
 p_idem_key TEXT,p_request_digest TEXT,p_aal TEXT,p_mfa_at TIMESTAMPTZ,p_consent_version TEXT,p_policy_version TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u UUID; v public.music_voice_profiles; seen public.music_voice_receipts; result JSONB; BEGIN
 u:=private.music_voice_owner(p_auth_id); IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 PERFORM pg_advisory_xact_lock(618,hashtext(u::text)); SELECT id INTO u FROM public.users WHERE id=u AND deleted_at IS NULL AND frozen_at IS NULL FOR UPDATE;
 SELECT * INTO seen FROM public.music_voice_receipts WHERE actor_user_id=u AND operation='enroll' AND idempotency_key=p_idem_key;
 IF FOUND THEN IF seen.request_digest<>p_request_digest THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  SELECT * INTO v FROM public.music_voice_profiles WHERE id=(seen.result->>'profile_id')::uuid AND user_id=u;
  RETURN jsonb_build_object('ok',true,'profile',private.music_voice_json(v),'created',false,'idempotent',true); END IF;
 IF NOT private.music_voice_fresh_mfa(p_aal,p_mfa_at) THEN RETURN jsonb_build_object('ok',false,'code','MFA_REQUIRED'); END IF;
 IF (SELECT count(*) FROM public.music_voice_events WHERE actor_user_id=u AND event_type='enrolled'
   AND created_at>=clock_timestamp()-interval '24 hours')>=3
  OR EXISTS(SELECT 1 FROM public.music_voice_profiles WHERE user_id=u AND status='rejected'
   AND updated_at>=clock_timestamp()-interval '1 hour')
  THEN RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED'); END IF;
 IF p_profile_id IS NULL OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 80 OR p_name~'[[:cntrl:]]'
  OR p_reference_mime NOT IN('audio/mpeg','audio/wav') OR p_reference_size NOT BETWEEN 1 AND 20971520
  OR p_reference_seconds NOT BETWEEN 2 AND 300 OR p_nonce IS NULL OR length(p_nonce)<20 OR p_hmac IS NULL OR length(p_hmac)<40
  OR p_ciphertext IS NULL OR length(p_ciphertext)<40 OR p_idem_key!~'^[A-Za-z0-9._-]{8,120}$'
  OR p_reference_key!~('^music-voice-uploads/'||lower(p_auth_id)||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(mp3|wav)$')
  OR p_request_digest!~'^[a-f0-9]{64}$' OR p_consent_version<>'music-own-voice-2026-11-24'
  OR p_policy_version<>'music-voice-review-v1' THEN RETURN jsonb_build_object('ok',false,'code','INVALID'); END IF;
 FOR v IN SELECT * FROM public.music_voice_profiles WHERE user_id=u AND ((status='challenge_issued' AND challenge_expires_at<=clock_timestamp())
  OR (status='pending_review' AND review_expires_at<=clock_timestamp()) OR (status='verified' AND verification_expires_at<=clock_timestamp())) FOR UPDATE LOOP
  PERFORM private.music_voice_queue_media(v);
  UPDATE public.music_voice_profiles SET status='expired',reference_source_key=NULL,reference_mime_type=NULL,reference_size_bytes=NULL,
   reference_duration_seconds=NULL,challenge_source_key=NULL,challenge_mime_type=NULL,challenge_size_bytes=NULL,challenge_duration_seconds=NULL,
   challenge_nonce=NULL,challenge_hmac=NULL,challenge_ciphertext=NULL,reason_code='expired',deletion_queued_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=v.id;
  INSERT INTO public.music_voice_events(profile_id,event_type,submission_revision,reason_code,policy_version)
   VALUES(v.id,'expired',v.submission_revision,'expired',v.policy_version);
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.music_voice_profiles WHERE user_id=u AND status IN('challenge_issued','pending_review','verified'))
  THEN RETURN jsonb_build_object('ok',false,'code','ACTIVE_PROFILE'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.upload_reservations WHERE r2_key=p_reference_key AND user_id=u AND size_bytes=p_reference_size
   AND created_at>clock_timestamp()-interval '20 hours')
  OR EXISTS(SELECT 1 FROM public.music_voice_profiles WHERE reference_source_key=p_reference_key OR challenge_source_key=p_reference_key)
  OR EXISTS(SELECT 1 FROM public.music_voice_source_tombstones WHERE source_digest=encode(sha256(convert_to(p_reference_key,'UTF8')),'hex'))
  OR EXISTS(SELECT 1 FROM public.asset_reap_queue WHERE r2_key=p_reference_key)
  OR NOT private.music_voice_source_unbound(p_reference_key)
  THEN RETURN jsonb_build_object('ok',false,'code','SOURCE_NOT_FOUND'); END IF;
 INSERT INTO public.music_voice_profiles(id,user_id,name,status,reference_source_key,reference_mime_type,reference_size_bytes,
  reference_duration_seconds,challenge_nonce,challenge_hmac,challenge_ciphertext,challenge_issued_at,challenge_expires_at,consent_version,policy_version)
 VALUES(p_profile_id,u,btrim(p_name),'challenge_issued',p_reference_key,p_reference_mime,p_reference_size,p_reference_seconds,
  p_nonce,p_hmac,p_ciphertext,clock_timestamp(),clock_timestamp()+interval '20 minutes',p_consent_version,p_policy_version) RETURNING * INTO v;
 INSERT INTO public.music_voice_source_tombstones(source_digest,profile_id,source_kind)
  VALUES(encode(sha256(convert_to(p_reference_key,'UTF8')),'hex'),v.id,'reference');
 DELETE FROM public.upload_reservations WHERE r2_key=p_reference_key AND user_id=u;
 INSERT INTO public.music_voice_events(profile_id,actor_user_id,event_type,submission_revision,policy_version)
  VALUES(v.id,u,'enrolled',0,v.policy_version);
 result:=jsonb_build_object('profile_id',v.id);
 INSERT INTO public.music_voice_receipts VALUES(u,'enroll',p_idem_key,p_request_digest,result,clock_timestamp());
 RETURN jsonb_build_object('ok',true,'profile',private.music_voice_json(v),'created',true,'idempotent',false);
END $$;

CREATE OR REPLACE FUNCTION public.music_voice_reissue(p_auth_id TEXT,p_profile_id UUID,p_nonce TEXT,p_hmac TEXT,p_ciphertext TEXT,
 p_idem_key TEXT,p_request_digest TEXT,p_aal TEXT,p_mfa_at TIMESTAMPTZ) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u UUID; v public.music_voice_profiles; seen public.music_voice_receipts; result JSONB; BEGIN
 u:=private.music_voice_owner(p_auth_id); IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 PERFORM pg_advisory_xact_lock(618,hashtext(u::text)); SELECT * INTO v FROM public.music_voice_profiles WHERE id=p_profile_id AND user_id=u FOR UPDATE;
 SELECT * INTO seen FROM public.music_voice_receipts WHERE actor_user_id=u AND operation='reissue' AND idempotency_key=p_idem_key;
 IF FOUND THEN IF seen.request_digest<>p_request_digest THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  SELECT * INTO v FROM public.music_voice_profiles WHERE id=(seen.result->>'profile_id')::uuid AND user_id=u;
  RETURN jsonb_build_object('ok',true,'profile',private.music_voice_json(v),'reissued',false,'idempotent',true); END IF;
 IF NOT private.music_voice_fresh_mfa(p_aal,p_mfa_at) THEN RETURN jsonb_build_object('ok',false,'code','MFA_REQUIRED'); END IF;
 IF v.id IS NULL OR v.status<>'challenge_issued' THEN RETURN jsonb_build_object('ok',false,'code','STATE_CONFLICT'); END IF;
 IF v.challenge_reissue_count>=2 THEN RETURN jsonb_build_object('ok',false,'code','REISSUE_LIMIT'); END IF;
 IF p_nonce IS NULL OR length(p_nonce)<20 OR p_hmac IS NULL OR length(p_hmac)<40 OR p_ciphertext IS NULL OR length(p_ciphertext)<40
  OR p_idem_key!~'^[A-Za-z0-9._-]{8,120}$' OR p_request_digest!~'^[a-f0-9]{64}$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID'); END IF;
 UPDATE public.music_voice_profiles SET challenge_nonce=p_nonce,challenge_hmac=p_hmac,challenge_ciphertext=p_ciphertext,
  challenge_issued_at=clock_timestamp(),challenge_expires_at=clock_timestamp()+interval '20 minutes',challenge_attempt_count=0,
  challenge_reissue_count=challenge_reissue_count+1,updated_at=clock_timestamp() WHERE id=v.id RETURNING * INTO v;
 INSERT INTO public.music_voice_events(profile_id,actor_user_id,event_type,submission_revision,policy_version)
  VALUES(v.id,u,'challenge_reissued',v.submission_revision,v.policy_version);
 result:=jsonb_build_object('profile_id',v.id);
 INSERT INTO public.music_voice_receipts VALUES(u,'reissue',p_idem_key,p_request_digest,result,clock_timestamp());
 RETURN jsonb_build_object('ok',true,'profile',private.music_voice_json(v),'reissued',true,'idempotent',false);
END $$;

CREATE OR REPLACE FUNCTION public.music_voice_submit(p_auth_id TEXT,p_profile_id UUID,p_challenge_key TEXT,p_challenge_mime TEXT,
 p_challenge_size BIGINT,p_challenge_seconds NUMERIC,p_phrase_proof TEXT,p_idem_key TEXT,p_request_digest TEXT,p_aal TEXT,p_mfa_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u UUID; v public.music_voice_profiles; r public.upload_reservations; seen public.music_voice_receipts; result JSONB; BEGIN
 u:=private.music_voice_owner(p_auth_id); IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 PERFORM pg_advisory_xact_lock(618,hashtext(u::text)); SELECT * INTO v FROM public.music_voice_profiles WHERE id=p_profile_id AND user_id=u FOR UPDATE;
 SELECT * INTO seen FROM public.music_voice_receipts WHERE actor_user_id=u AND operation='submit' AND idempotency_key=p_idem_key;
 IF FOUND THEN IF seen.request_digest<>p_request_digest THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  IF seen.result->>'code' IS NOT NULL THEN RETURN seen.result||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO v FROM public.music_voice_profiles WHERE id=(seen.result->>'profile_id')::uuid AND user_id=u;
  RETURN jsonb_build_object('ok',true,'profile',private.music_voice_json(v),'idempotent',true); END IF;
 IF NOT private.music_voice_fresh_mfa(p_aal,p_mfa_at) THEN RETURN jsonb_build_object('ok',false,'code','MFA_REQUIRED'); END IF;
 IF v.id IS NULL OR v.status<>'challenge_issued' THEN RETURN jsonb_build_object('ok',false,'code','STATE_CONFLICT'); END IF;
 IF v.challenge_expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('ok',false,'code','CHALLENGE_EXPIRED'); END IF;
 IF p_phrase_proof IS DISTINCT FROM v.challenge_hmac THEN
  UPDATE public.music_voice_profiles SET challenge_attempt_count=challenge_attempt_count+1,updated_at=clock_timestamp() WHERE id=v.id RETURNING * INTO v;
  INSERT INTO public.music_voice_events(profile_id,actor_user_id,event_type,submission_revision,reason_code,policy_version)
   VALUES(v.id,u,'challenge_failed',v.submission_revision,'phrase_mismatch',v.policy_version);
  IF v.challenge_attempt_count>=3 THEN PERFORM private.music_voice_queue_media(v);
   UPDATE public.music_voice_profiles SET status='expired',reference_source_key=NULL,reference_mime_type=NULL,reference_size_bytes=NULL,
    reference_duration_seconds=NULL,challenge_source_key=NULL,challenge_mime_type=NULL,challenge_size_bytes=NULL,challenge_duration_seconds=NULL,
    challenge_nonce=NULL,challenge_hmac=NULL,challenge_ciphertext=NULL,deletion_queued_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=v.id;
   INSERT INTO public.music_voice_events(profile_id,event_type,submission_revision,reason_code,policy_version)
    VALUES(v.id,'expired',v.submission_revision,'challenge_attempts_exhausted',v.policy_version);
  END IF;
  result:=jsonb_build_object('profile_id',v.id,'ok',false,'code','CHALLENGE_MISMATCH',
   'attempts_remaining',greatest(0,3-v.challenge_attempt_count));
  INSERT INTO public.music_voice_receipts VALUES(u,'submit',p_idem_key,p_request_digest,result,clock_timestamp());
  RETURN result||jsonb_build_object('idempotent',false);
 END IF;
 IF p_challenge_key=v.reference_source_key OR p_challenge_mime NOT IN('audio/mpeg','audio/wav') OR p_challenge_size NOT BETWEEN 1 AND 20971520
  OR p_challenge_key!~('^music-voice-uploads/'||lower(p_auth_id)||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(mp3|wav)$')
  OR p_challenge_seconds NOT BETWEEN 2 AND 60 OR p_idem_key!~'^[A-Za-z0-9._-]{8,120}$' OR p_request_digest!~'^[a-f0-9]{64}$'
  THEN RETURN jsonb_build_object('ok',false,'code','INVALID'); END IF;
 SELECT * INTO r FROM public.upload_reservations WHERE r2_key=p_challenge_key AND user_id=u AND size_bytes=p_challenge_size;
 IF r.r2_key IS NULL OR r.created_at<v.challenge_issued_at OR EXISTS(SELECT 1 FROM public.music_voice_profiles
  WHERE reference_source_key=p_challenge_key OR challenge_source_key=p_challenge_key)
  OR EXISTS(SELECT 1 FROM public.music_voice_source_tombstones WHERE source_digest=encode(sha256(convert_to(p_challenge_key,'UTF8')),'hex'))
  OR EXISTS(SELECT 1 FROM public.asset_reap_queue WHERE r2_key=p_challenge_key)
  OR NOT private.music_voice_source_unbound(p_challenge_key)
  THEN RETURN jsonb_build_object('ok',false,'code','SOURCE_NOT_FOUND'); END IF;
 UPDATE public.music_voice_profiles SET status='pending_review',challenge_source_key=p_challenge_key,challenge_mime_type=p_challenge_mime,
  challenge_size_bytes=p_challenge_size,challenge_duration_seconds=p_challenge_seconds,
  submission_revision=submission_revision+1,review_expires_at=clock_timestamp()+interval '7 days',updated_at=clock_timestamp()
  WHERE id=v.id RETURNING * INTO v;
 INSERT INTO public.music_voice_source_tombstones(source_digest,profile_id,source_kind)
  VALUES(encode(sha256(convert_to(p_challenge_key,'UTF8')),'hex'),v.id,'challenge');
 DELETE FROM public.upload_reservations WHERE r2_key=p_challenge_key AND user_id=u;
 INSERT INTO public.music_voice_events(profile_id,actor_user_id,event_type,submission_revision,policy_version)
  VALUES(v.id,u,'submitted',v.submission_revision,v.policy_version);
 result:=jsonb_build_object('profile_id',v.id);
 INSERT INTO public.music_voice_receipts VALUES(u,'submit',p_idem_key,p_request_digest,result,clock_timestamp());
 RETURN jsonb_build_object('ok',true,'profile',private.music_voice_json(v),'idempotent',false);
END $$;

CREATE OR REPLACE FUNCTION public.music_voice_revoke(p_auth_id TEXT,p_profile_id UUID,p_idem_key TEXT,p_request_digest TEXT,
 p_aal TEXT,p_mfa_at TIMESTAMPTZ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u UUID; v public.music_voice_profiles; seen public.music_voice_receipts; result JSONB; BEGIN
 SELECT id INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 PERFORM pg_advisory_xact_lock(618,hashtext(u::text)); SELECT * INTO v FROM public.music_voice_profiles WHERE id=p_profile_id AND user_id=u FOR UPDATE;
 SELECT * INTO seen FROM public.music_voice_receipts WHERE actor_user_id=u AND operation='revoke' AND idempotency_key=p_idem_key;
 IF FOUND THEN IF seen.request_digest<>p_request_digest THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  SELECT * INTO v FROM public.music_voice_profiles WHERE id=(seen.result->>'profile_id')::uuid AND user_id=u;
  RETURN jsonb_build_object('ok',true,'profile',private.music_voice_json(v),'deletion_queued',true,'idempotent',true); END IF;
 IF v.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF v.status IN('challenge_issued','pending_review','verified') THEN PERFORM private.music_voice_queue_media(v);
  UPDATE public.music_voice_profiles SET status='revoked',reference_source_key=NULL,reference_mime_type=NULL,reference_size_bytes=NULL,
   reference_duration_seconds=NULL,challenge_source_key=NULL,challenge_mime_type=NULL,challenge_size_bytes=NULL,challenge_duration_seconds=NULL,challenge_nonce=NULL,
   challenge_hmac=NULL,challenge_ciphertext=NULL,reason_code='owner_revoked',deletion_queued_at=clock_timestamp(),updated_at=clock_timestamp()
   WHERE id=v.id RETURNING * INTO v;
  INSERT INTO public.music_voice_events(profile_id,actor_user_id,event_type,submission_revision,reason_code,policy_version)
   VALUES(v.id,u,'revoked',v.submission_revision,'owner_revoked',v.policy_version);
 END IF;
 result:=jsonb_build_object('profile_id',v.id);
 INSERT INTO public.music_voice_receipts VALUES(u,'revoke',p_idem_key,p_request_digest,result,clock_timestamp());
 RETURN jsonb_build_object('ok',true,'profile',private.music_voice_json(v),'deletion_queued',v.deletion_queued_at IS NOT NULL,'idempotent',false);
END $$;

-- Extend the complete 0428 matrix: owner and moderator review evidence, but
-- launch-gated approval is restricted to owner.
CREATE OR REPLACE FUNCTION public.admin_role_permissions(p_role TEXT) RETURNS TEXT[]
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY(SELECT jsonb_array_elements_text(coalesce(
  '{"owner":["users.read","payments","changes.read","affiliates","endpoints","plans.read","plans.write","traffic","support","support.write","roles.write","switches.write","violations","appeals","reports","cinema","webhooks","security","music_voices.review","music_voices.approve"],"finance":["payments","affiliates","plans.read"],"support":["users.read","support","support.write","changes.read"],"moderator":["violations","appeals","reports","cinema","music_voices.review"],"viewer":["users.read","payments","changes.read","affiliates","endpoints","plans.read","traffic"]}'::jsonb->p_role,'[]'::jsonb)))
$$;
REVOKE ALL ON FUNCTION public.admin_role_permissions(TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_role_permissions(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.music_voice_admin_list(p_auth_id TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rows JSONB; BEGIN PERFORM public.admin_require_permission(p_auth_id,'music_voices.review');
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'owner_user_id',v.user_id,'status',v.status,
  'submission_revision',v.submission_revision,'review_expires_at',v.review_expires_at,'created_at',v.created_at)
  ORDER BY v.created_at),'[]'::jsonb) INTO rows FROM public.music_voice_profiles v
  WHERE v.status='pending_review' AND v.review_expires_at>clock_timestamp();
 RETURN jsonb_build_object('ok',true,'profiles',rows); END $$;

CREATE OR REPLACE FUNCTION public.music_voice_admin_evidence(p_auth_id TEXT,p_profile_id UUID,p_revision INTEGER,p_aal TEXT,p_mfa_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor UUID; v public.music_voice_profiles; BEGIN
 PERFORM public.admin_require_permission(p_auth_id,'music_voices.review');
 IF NOT private.music_voice_fresh_mfa(p_aal,p_mfa_at) THEN RETURN jsonb_build_object('ok',false,'code','MFA_REQUIRED'); END IF;
 SELECT id INTO actor FROM public.users WHERE auth_id=p_auth_id AND is_admin AND deleted_at IS NULL AND frozen_at IS NULL;
 IF actor IS NULL THEN RAISE EXCEPTION 'not_admin' USING ERRCODE='42501'; END IF;
 SELECT * INTO v FROM public.music_voice_profiles WHERE id=p_profile_id FOR UPDATE;
 IF v.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF actor=v.user_id THEN RETURN jsonb_build_object('ok',false,'code','SELF_REVIEW_FORBIDDEN'); END IF;
 IF v.status<>'pending_review' OR v.submission_revision<>p_revision OR v.review_expires_at<=clock_timestamp()
  THEN RETURN jsonb_build_object('ok',false,'code','STATE_CONFLICT'); END IF;
 IF EXISTS(SELECT 1 FROM public.music_voice_events WHERE profile_id=v.id AND actor_user_id=actor
   AND event_type='evidence_viewed' AND submission_revision=p_revision AND created_at>=clock_timestamp()-interval '30 seconds')
  OR (SELECT count(*) FROM public.music_voice_events WHERE profile_id=v.id AND actor_user_id=actor
   AND event_type='evidence_viewed' AND submission_revision=p_revision AND created_at>=clock_timestamp()-interval '1 hour')>=10
  THEN RETURN jsonb_build_object('ok',false,'code','EVIDENCE_RATE_LIMIT'); END IF;
 INSERT INTO public.music_voice_events(profile_id,actor_user_id,event_type,submission_revision,policy_version)
  VALUES(v.id,actor,'evidence_viewed',v.submission_revision,v.policy_version);
 RETURN jsonb_build_object('ok',true,'profile_id',v.id,'submission_revision',v.submission_revision,
  'reference_source_key',v.reference_source_key,'challenge_source_key',v.challenge_source_key,
  'challenge_ciphertext',v.challenge_ciphertext,'policy_version',v.policy_version);
END $$;

CREATE OR REPLACE FUNCTION public.music_voice_admin_evidence_delivered(p_auth_id TEXT,p_profile_id UUID,p_revision INTEGER,p_aal TEXT,p_mfa_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor UUID; v public.music_voice_profiles; BEGIN
 PERFORM public.admin_require_permission(p_auth_id,'music_voices.review');
 IF NOT private.music_voice_fresh_mfa(p_aal,p_mfa_at) THEN RETURN jsonb_build_object('ok',false,'code','MFA_REQUIRED'); END IF;
 SELECT id INTO actor FROM public.users WHERE auth_id=p_auth_id AND is_admin AND deleted_at IS NULL AND frozen_at IS NULL;
 IF actor IS NULL THEN RAISE EXCEPTION 'not_admin' USING ERRCODE='42501'; END IF;
 SELECT * INTO v FROM public.music_voice_profiles WHERE id=p_profile_id FOR UPDATE;
 IF v.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF actor=v.user_id THEN RETURN jsonb_build_object('ok',false,'code','SELF_REVIEW_FORBIDDEN'); END IF;
 IF v.status<>'pending_review' OR v.submission_revision<>p_revision OR v.review_expires_at<=clock_timestamp()
  THEN RETURN jsonb_build_object('ok',false,'code','STATE_CONFLICT'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.music_voice_events WHERE profile_id=v.id AND actor_user_id=actor
   AND event_type='evidence_viewed' AND submission_revision=p_revision
   AND created_at BETWEEN clock_timestamp()-interval '10 minutes' AND clock_timestamp()-interval '5 seconds')
  THEN RETURN jsonb_build_object('ok',false,'code','EVIDENCE_NOT_VIEWED'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.music_voice_events WHERE profile_id=v.id AND actor_user_id=actor
   AND event_type='evidence_delivered' AND submission_revision=p_revision AND created_at>=clock_timestamp()-interval '10 minutes') THEN
  INSERT INTO public.music_voice_events(profile_id,actor_user_id,event_type,submission_revision,policy_version)
   VALUES(v.id,actor,'evidence_delivered',v.submission_revision,v.policy_version);
 END IF;
 RETURN jsonb_build_object('ok',true,'profile_id',v.id,'submission_revision',v.submission_revision);
END $$;

CREATE OR REPLACE FUNCTION public.music_voice_admin_review(p_auth_id TEXT,p_profile_id UUID,p_revision INTEGER,p_decision TEXT,
 p_reason_code TEXT,p_checklist JSONB,p_idem_key TEXT,p_request_digest TEXT,p_aal TEXT,p_mfa_at TIMESTAMPTZ,p_policy_version TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor UUID; v public.music_voice_profiles; seen public.music_voice_receipts; result JSONB; BEGIN
 actor:=public.admin_lock_mutation(p_auth_id::uuid,CASE WHEN p_decision='approve' THEN 'music_voices.approve' ELSE 'music_voices.review' END,p_aal,p_mfa_at);
 SELECT * INTO seen FROM public.music_voice_receipts WHERE actor_user_id=actor AND operation='review' AND idempotency_key=p_idem_key;
 IF FOUND THEN IF seen.request_digest<>p_request_digest THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  SELECT * INTO v FROM public.music_voice_profiles WHERE id=(seen.result->>'profile_id')::uuid;
  RETURN jsonb_build_object('ok',true,'profile',private.music_voice_json(v),'idempotent',true); END IF;
 IF NOT private.music_voice_fresh_mfa(p_aal,p_mfa_at) THEN RETURN jsonb_build_object('ok',false,'code','MFA_REQUIRED'); END IF;
 SELECT * INTO v FROM public.music_voice_profiles WHERE id=p_profile_id FOR UPDATE;
 IF v.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF actor=v.user_id THEN RETURN jsonb_build_object('ok',false,'code','SELF_REVIEW_FORBIDDEN'); END IF;
 IF v.status<>'pending_review' OR v.submission_revision<>p_revision OR v.review_expires_at<=clock_timestamp()
  THEN RETURN jsonb_build_object('ok',false,'code','STATE_CONFLICT'); END IF;
 IF p_decision NOT IN('approve','reject')
  OR (p_decision='approve' AND p_reason_code<>'evidence_consistent')
  OR (p_decision='reject' AND p_reason_code NOT IN('phrase_mismatch','reference_mismatch','synthetic_suspected','evidence_unreadable','policy_failed'))
  OR p_policy_version<>v.policy_version
  OR p_idem_key!~'^[A-Za-z0-9._-]{8,120}$' OR p_request_digest!~'^[a-f0-9]{64}$' OR jsonb_typeof(p_checklist) IS DISTINCT FROM 'object'
  OR p_checklist-'phrase_exact'-'reference_consistent'-'no_synthetic_concerns'-'policy_acknowledged'<>'{}'::jsonb
  OR jsonb_typeof(p_checklist->'phrase_exact') IS DISTINCT FROM 'boolean'
  OR jsonb_typeof(p_checklist->'reference_consistent') IS DISTINCT FROM 'boolean'
  OR jsonb_typeof(p_checklist->'no_synthetic_concerns') IS DISTINCT FROM 'boolean'
  OR jsonb_typeof(p_checklist->'policy_acknowledged') IS DISTINCT FROM 'boolean'
  THEN RETURN jsonb_build_object('ok',false,'code','INVALID'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.music_voice_events WHERE profile_id=v.id AND actor_user_id=actor
  AND event_type='evidence_delivered' AND submission_revision=p_revision AND created_at>=clock_timestamp()-interval '10 minutes')
  THEN RETURN jsonb_build_object('ok',false,'code','EVIDENCE_NOT_DELIVERED'); END IF;
 IF p_decision='approve' AND (p_reason_code<>'evidence_consistent' OR p_checklist IS DISTINCT FROM
  '{"phrase_exact":true,"policy_acknowledged":true,"reference_consistent":true,"no_synthetic_concerns":true}'::jsonb)
  THEN RETURN jsonb_build_object('ok',false,'code','CHECKLIST_INCOMPLETE'); END IF;
 IF p_decision='approve' THEN PERFORM private.music_voice_queue_media(v);
  UPDATE public.music_voice_profiles SET status='verified',verified_at=clock_timestamp(),verification_expires_at=clock_timestamp()+interval '30 days',
   reference_source_key=NULL,reference_mime_type=NULL,reference_size_bytes=NULL,reference_duration_seconds=NULL,
   challenge_source_key=NULL,challenge_mime_type=NULL,challenge_size_bytes=NULL,challenge_duration_seconds=NULL,
   challenge_nonce=NULL,challenge_hmac=NULL,challenge_ciphertext=NULL,reason_code=NULL,deletion_queued_at=clock_timestamp(),updated_at=clock_timestamp()
   WHERE id=v.id RETURNING * INTO v;
  INSERT INTO public.music_voice_events(profile_id,actor_user_id,event_type,submission_revision,reason_code,checklist,policy_version)
   VALUES(v.id,actor,'approved',v.submission_revision,p_reason_code,p_checklist,v.policy_version);
 ELSE PERFORM private.music_voice_queue_media(v);
  UPDATE public.music_voice_profiles SET status='rejected',reference_source_key=NULL,reference_mime_type=NULL,reference_size_bytes=NULL,
   reference_duration_seconds=NULL,challenge_source_key=NULL,challenge_mime_type=NULL,challenge_size_bytes=NULL,challenge_duration_seconds=NULL,
   challenge_nonce=NULL,challenge_hmac=NULL,challenge_ciphertext=NULL,
   reason_code=p_reason_code,deletion_queued_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=v.id RETURNING * INTO v;
  INSERT INTO public.music_voice_events(profile_id,actor_user_id,event_type,submission_revision,reason_code,checklist,policy_version)
   VALUES(v.id,actor,'rejected',v.submission_revision,p_reason_code,p_checklist,v.policy_version);
 END IF;
 result:=jsonb_build_object('profile_id',v.id);
 INSERT INTO public.music_voice_receipts VALUES(actor,'review',p_idem_key,p_request_digest,result,clock_timestamp());
 RETURN jsonb_build_object('ok',true,'profile',private.music_voice_json(v),'idempotent',false);
END $$;

CREATE OR REPLACE FUNCTION public.expire_music_voice_profiles(p_batch_size INTEGER DEFAULT 100) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.music_voice_profiles; moved INTEGER:=0; BEGIN
 FOR v IN SELECT * FROM public.music_voice_profiles WHERE
  (status='challenge_issued' AND challenge_expires_at<=clock_timestamp()) OR
  (status='pending_review' AND review_expires_at<=clock_timestamp()) OR
  (status='verified' AND verification_expires_at<=clock_timestamp())
  ORDER BY updated_at LIMIT least(greatest(coalesce(p_batch_size,100),1),500) FOR UPDATE SKIP LOCKED LOOP
  PERFORM private.music_voice_queue_media(v);
  UPDATE public.music_voice_profiles SET status='expired',reference_source_key=NULL,reference_mime_type=NULL,reference_size_bytes=NULL,
   reference_duration_seconds=NULL,challenge_source_key=NULL,challenge_mime_type=NULL,challenge_size_bytes=NULL,challenge_duration_seconds=NULL,
   challenge_nonce=NULL,challenge_hmac=NULL,challenge_ciphertext=NULL,reason_code='expired',deletion_queued_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=v.id;
  INSERT INTO public.music_voice_events(profile_id,event_type,submission_revision,reason_code,policy_version)
   VALUES(v.id,'expired',v.submission_revision,'expired',v.policy_version); moved:=moved+1;
 END LOOP; RETURN moved; END $$;

CREATE OR REPLACE FUNCTION private.music_voice_forget_erased_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.music_voice_profiles; BEGIN IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
 FOR v IN SELECT * FROM public.music_voice_profiles WHERE user_id=NEW.id FOR UPDATE LOOP
  PERFORM private.music_voice_queue_media(v);
  UPDATE public.music_voice_profiles SET name='Removed voice',status='revoked',reference_source_key=NULL,reference_mime_type=NULL,reference_size_bytes=NULL,
   reference_duration_seconds=NULL,challenge_source_key=NULL,challenge_mime_type=NULL,challenge_size_bytes=NULL,challenge_duration_seconds=NULL,
   challenge_nonce=NULL,challenge_hmac=NULL,challenge_ciphertext=NULL,reason_code='account_erased',deletion_queued_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=v.id;
  INSERT INTO public.music_voice_events(profile_id,event_type,submission_revision,reason_code,policy_version)
   VALUES(v.id,'account_erased',v.submission_revision,'account_erased',v.policy_version);
 END LOOP; END IF; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION private.music_voice_forget_erased_user() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS users_music_voice_forget_erased ON public.users;
CREATE TRIGGER users_music_voice_forget_erased AFTER UPDATE OF deleted_at ON public.users
  FOR EACH ROW EXECUTE FUNCTION private.music_voice_forget_erased_user();

DO $$ BEGIN
 IF to_regprocedure('public.telemetry_path_allowed_pre_0618(text)') IS NULL THEN
  ALTER FUNCTION public.telemetry_path_allowed(TEXT) RENAME TO telemetry_path_allowed_pre_0618;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT p_path IN ('/api/v1/music/voices','/api/v1/music/voices/:id','/api/v1/music/voices/:id/verify',
  '/api/v1/music/voices/:id/challenge','/api/v1/admin/music/voices','/api/v1/admin/music/voices/:id/evidence',
  '/api/v1/admin/music/voices/:id/evidence/ack','/api/v1/admin/music/voices/:id/review',
  '/app/music/voices','/app/admin/music-voices')
  OR public.telemetry_path_allowed_pre_0618(p_path)
$$;
REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT) FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION public.music_voice_list(TEXT),public.music_voice_challenge_context(TEXT,UUID,TEXT,TEXT),public.music_voice_enroll_context(TEXT,TEXT,TEXT),public.music_voice_upload_protected(TEXT),public.music_voice_enroll(TEXT,UUID,TEXT,TEXT,TEXT,BIGINT,NUMERIC,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT),
 public.music_voice_reissue(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ),public.music_voice_submit(TEXT,UUID,TEXT,TEXT,BIGINT,NUMERIC,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ),
 public.music_voice_revoke(TEXT,UUID,TEXT,TEXT,TEXT,TIMESTAMPTZ),public.music_voice_admin_list(TEXT),
 public.music_voice_admin_evidence(TEXT,UUID,INTEGER,TEXT,TIMESTAMPTZ),public.music_voice_admin_evidence_delivered(TEXT,UUID,INTEGER,TEXT,TIMESTAMPTZ),public.music_voice_admin_review(TEXT,UUID,INTEGER,TEXT,TEXT,JSONB,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT),
 public.expire_music_voice_profiles(INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_voice_list(TEXT),public.music_voice_challenge_context(TEXT,UUID,TEXT,TEXT),public.music_voice_enroll_context(TEXT,TEXT,TEXT),public.music_voice_upload_protected(TEXT),public.music_voice_enroll(TEXT,UUID,TEXT,TEXT,TEXT,BIGINT,NUMERIC,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT),
 public.music_voice_reissue(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ),public.music_voice_submit(TEXT,UUID,TEXT,TEXT,BIGINT,NUMERIC,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ),
 public.music_voice_revoke(TEXT,UUID,TEXT,TEXT,TEXT,TIMESTAMPTZ),public.music_voice_admin_list(TEXT),
 public.music_voice_admin_evidence(TEXT,UUID,INTEGER,TEXT,TIMESTAMPTZ),public.music_voice_admin_evidence_delivered(TEXT,UUID,INTEGER,TEXT,TIMESTAMPTZ),public.music_voice_admin_review(TEXT,UUID,INTEGER,TEXT,TEXT,JSONB,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT),
 public.expire_music_voice_profiles(INTEGER) TO service_role;

SELECT cron.schedule('veyrnox-expire-music-voices','*/10 * * * *',$$SELECT public.expire_music_voice_profiles(100);$$);
COMMIT;

-- Rollback: disable the voices flag first. Then unschedule the named cron job,
-- drop the user trigger/functions, and retain all four tables until every
-- queued object has been reaped; dropping rows before that loses deletion handles.
