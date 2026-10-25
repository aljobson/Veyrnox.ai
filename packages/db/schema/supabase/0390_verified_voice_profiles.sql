-- Verified owner-only Professional Voice Clones (M06).
--
-- A profile is usable only after ElevenLabs reports BOTH is_owner/is_verified
-- and a fine_tuned state. Every mutation is service-role only and the create,
-- verification and revocation entry points require a fresh AAL2/TOTP claim.
-- The browser never receives provider credentials or another user's profile.
--
-- Account deletion is blocked while a provider copy remains. Once provider
-- deletion has been confirmed, the local revoked row is removed automatically
-- when the public.users tombstone is written by erase_account.

CREATE TABLE IF NOT EXISTS public.voice_profiles (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID        NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    provider              TEXT        NOT NULL DEFAULT 'elevenlabs' CHECK (provider = 'elevenlabs'),
    provider_voice_id     TEXT        NULL UNIQUE CHECK (provider_voice_id IS NULL OR provider_voice_id ~ '^[A-Za-z0-9_-]{1,128}$'),
    name                  TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    language              TEXT        NOT NULL CHECK (language ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
    status                TEXT        NOT NULL DEFAULT 'creating' CHECK (status IN (
                                      'creating','samples_pending','verification_pending','training',
                                      'ready','failed','revoking','revoked')),
    consent_version       TEXT        NOT NULL CHECK (char_length(consent_version) BETWEEN 1 AND 64),
    consented_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    verified_at           TIMESTAMPTZ NULL,
    ready_at              TIMESTAMPTZ NULL,
    revocation_requested_at TIMESTAMPTZ NULL,
    revoked_at            TIMESTAMPTZ NULL,
    error_code            TEXT        NULL CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9_]{1,64}$'),
    sample_count          INTEGER     NOT NULL DEFAULT 0 CHECK (sample_count BETWEEN 0 AND 100),
    sample_seconds        DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (sample_seconds BETWEEN 0 AND 10800),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT voice_profile_state_times CHECK (
      (status <> 'ready' OR (verified_at IS NOT NULL AND ready_at IS NOT NULL))
      AND (status NOT IN ('revoking','revoked') OR revocation_requested_at IS NOT NULL)
      AND (status <> 'revoked' OR revoked_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS voice_profiles_user_idx ON public.voice_profiles(user_id, created_at DESC);
-- The API's count check gives a friendly error; this partial unique index is
-- the actual concurrency boundary when two create requests race.
CREATE UNIQUE INDEX IF NOT EXISTS voice_profiles_one_active_user_idx
  ON public.voice_profiles(user_id) WHERE status <> 'revoked';
ALTER TABLE public.voice_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_profiles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_profiles FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.voice_profile_samples (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id            UUID        NOT NULL REFERENCES public.voice_profiles(id) ON DELETE CASCADE,
    provider_sample_id    TEXT        NOT NULL CHECK (provider_sample_id ~ '^[A-Za-z0-9_-]{1,128}$'),
    duration_seconds      DOUBLE PRECISION NOT NULL CHECK (duration_seconds > 0 AND duration_seconds <= 10800),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(profile_id, provider_sample_id)
);
CREATE INDEX IF NOT EXISTS voice_profile_samples_profile_idx ON public.voice_profile_samples(profile_id, created_at);
ALTER TABLE public.voice_profile_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_profile_samples FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_profile_samples FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.voice_profile_actor(p_auth_id TEXT)
RETURNS public.users
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u FROM public.users u WHERE u.auth_id = p_auth_id AND u.deleted_at IS NULL
$$;
REVOKE ALL ON FUNCTION private.voice_profile_actor(TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.voice_profile_recent_mfa(p_aal TEXT, p_mfa_at BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT p_aal = 'aal2' AND p_mfa_at BETWEEN extract(epoch FROM now())::bigint - 300 AND extract(epoch FROM now())::bigint + 5
$$;
REVOKE ALL ON FUNCTION private.voice_profile_recent_mfa(TEXT, BIGINT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_voice_profile(
  p_auth_id TEXT, p_name TEXT, p_language TEXT, p_consent_version TEXT,
  p_aal TEXT, p_mfa_at BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE u public.users%ROWTYPE; v_id UUID;
BEGIN
  IF NOT private.voice_profile_recent_mfa(p_aal, p_mfa_at) THEN
    RETURN jsonb_build_object('ok',false,'code','RECENT_MFA_REQUIRED');
  END IF;
  SELECT * INTO u FROM private.voice_profile_actor(p_auth_id);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  IF u.frozen_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','ACCOUNT_FROZEN'); END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 100
     OR p_language IS NULL OR p_language !~ '^[a-z]{2,3}(-[A-Z]{2})?$'
     OR p_consent_version IS DISTINCT FROM 'voice-owner-2026-10-25' THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_INPUT');
  END IF;
  IF (SELECT count(*) FROM public.voice_profiles v WHERE v.user_id=u.id AND v.status <> 'revoked') >= 1 THEN
    RETURN jsonb_build_object('ok',false,'code','PROFILE_LIMIT');
  END IF;
  INSERT INTO public.voice_profiles(user_id,name,language,consent_version)
  VALUES(u.id,btrim(p_name),p_language,p_consent_version) RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok',true,'profile_id',v_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok',false,'code','PROFILE_LIMIT');
END $$;
REVOKE ALL ON FUNCTION public.create_voice_profile(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_voice_profile(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.list_voice_profiles(p_auth_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE u public.users%ROWTYPE; rows JSONB;
BEGIN
  SELECT * INTO u FROM private.voice_profile_actor(p_auth_id);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'profiles','[]'::jsonb); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',v.id,'name',v.name,'language',v.language,'status',v.status,
    'consented_at',v.consented_at,'verified_at',v.verified_at,'ready_at',v.ready_at,
    'sample_count',v.sample_count,'sample_seconds',v.sample_seconds,
    'revocation_requested_at',v.revocation_requested_at,'revoked_at',v.revoked_at,
    'error_code',v.error_code,'created_at',v.created_at,'updated_at',v.updated_at
  ) ORDER BY v.created_at DESC),'[]'::jsonb) INTO rows
  FROM public.voice_profiles v WHERE v.user_id=u.id;
  RETURN jsonb_build_object('ok',true,'profiles',rows);
END $$;
REVOKE ALL ON FUNCTION public.list_voice_profiles(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_voice_profiles(TEXT) TO service_role;

-- Internal ownership lookup. The provider id never appears in list_voice_profiles.
CREATE OR REPLACE FUNCTION public.get_voice_profile(p_auth_id TEXT, p_profile_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE u public.users%ROWTYPE; v public.voice_profiles%ROWTYPE;
BEGIN
  SELECT * INTO u FROM private.voice_profile_actor(p_auth_id);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  SELECT * INTO v FROM public.voice_profiles WHERE id=p_profile_id AND user_id=u.id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok',true,'id',v.id,'provider_voice_id',v.provider_voice_id,
    'name',v.name,'language',v.language,'status',v.status,'error_code',v.error_code,
    'sample_count',v.sample_count,'sample_seconds',v.sample_seconds);
END $$;
REVOKE ALL ON FUNCTION public.get_voice_profile(TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_voice_profile(TEXT,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.voice_profile_set_provider(p_auth_id TEXT, p_profile_id UUID, p_provider_voice_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE u public.users%ROWTYPE; changed UUID;
BEGIN
  SELECT * INTO u FROM private.voice_profile_actor(p_auth_id);
  IF NOT FOUND OR p_provider_voice_id IS NULL OR p_provider_voice_id !~ '^[A-Za-z0-9_-]{1,128}$' THEN
    RETURN jsonb_build_object('ok',false,'code','NOT_FOUND');
  END IF;
  UPDATE public.voice_profiles SET provider_voice_id=p_provider_voice_id,status='samples_pending',updated_at=now()
   WHERE id=p_profile_id AND user_id=u.id AND status='creating' AND provider_voice_id IS NULL RETURNING id INTO changed;
  RETURN CASE WHEN changed IS NULL THEN jsonb_build_object('ok',false,'code','STATE_CONFLICT')
              ELSE jsonb_build_object('ok',true) END;
END $$;
REVOKE ALL ON FUNCTION public.voice_profile_set_provider(TEXT,UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.voice_profile_set_provider(TEXT,UUID,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.voice_profile_record_sample(
  p_auth_id TEXT, p_profile_id UUID, p_provider_sample_id TEXT, p_duration_seconds DOUBLE PRECISION
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE u public.users%ROWTYPE; v public.voice_profiles%ROWTYPE; inserted UUID;
BEGIN
  SELECT * INTO u FROM private.voice_profile_actor(p_auth_id);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  IF p_provider_sample_id IS NULL OR p_provider_sample_id !~ '^[A-Za-z0-9_-]{1,128}$'
     OR p_duration_seconds IS NULL OR p_duration_seconds <= 0 OR p_duration_seconds > 10800 THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_INPUT');
  END IF;
  SELECT * INTO v FROM public.voice_profiles WHERE id=p_profile_id AND user_id=u.id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  IF v.status <> 'samples_pending' OR v.sample_seconds + p_duration_seconds > 10800 THEN
    RETURN jsonb_build_object('ok',false,'code','STATE_CONFLICT');
  END IF;
  INSERT INTO public.voice_profile_samples(profile_id,provider_sample_id,duration_seconds)
  VALUES(v.id,p_provider_sample_id,p_duration_seconds)
  ON CONFLICT(profile_id,provider_sample_id) DO NOTHING RETURNING id INTO inserted;
  IF inserted IS NOT NULL THEN
    UPDATE public.voice_profiles SET sample_count=sample_count+1,
      sample_seconds=sample_seconds+p_duration_seconds,updated_at=now() WHERE id=v.id;
  END IF;
  SELECT * INTO v FROM public.voice_profiles WHERE id=p_profile_id;
  RETURN jsonb_build_object('ok',true,'sample_count',v.sample_count,'sample_seconds',v.sample_seconds,
    'minimum_reached',v.sample_seconds>=1800);
END $$;
REVOKE ALL ON FUNCTION public.voice_profile_record_sample(TEXT,UUID,TEXT,DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.voice_profile_record_sample(TEXT,UUID,TEXT,DOUBLE PRECISION) TO service_role;

CREATE OR REPLACE FUNCTION public.voice_profile_transition(
  p_auth_id TEXT, p_profile_id UUID, p_next TEXT, p_error_code TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE u public.users%ROWTYPE; current public.voice_profiles%ROWTYPE;
BEGIN
  SELECT * INTO u FROM private.voice_profile_actor(p_auth_id);
  IF NOT FOUND OR p_next NOT IN ('verification_pending','training','ready','failed')
     OR (p_error_code IS NOT NULL AND p_error_code !~ '^[a-z0-9_]{1,64}$') THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_INPUT');
  END IF;
  SELECT * INTO current FROM public.voice_profiles WHERE id=p_profile_id AND user_id=u.id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  IF NOT ((current.status='samples_pending' AND p_next IN ('verification_pending','failed'))
       OR (current.status='verification_pending' AND p_next IN ('training','failed'))
       OR (current.status='training' AND p_next IN ('ready','failed'))
       OR (current.status='ready' AND p_next='failed')
       OR (current.status='creating' AND p_next='failed')) THEN
    RETURN jsonb_build_object('ok',false,'code','STATE_CONFLICT');
  END IF;
  UPDATE public.voice_profiles SET status=p_next,error_code=p_error_code,updated_at=now(),
    verified_at=CASE WHEN p_next='training' THEN now() ELSE verified_at END,
    ready_at=CASE WHEN p_next='ready' THEN now() ELSE ready_at END
   WHERE id=current.id;
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.voice_profile_transition(TEXT,UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.voice_profile_transition(TEXT,UUID,TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.voice_profile_start_revoke(
  p_auth_id TEXT, p_profile_id UUID, p_aal TEXT, p_mfa_at BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE u public.users%ROWTYPE; v public.voice_profiles%ROWTYPE;
BEGIN
  IF NOT private.voice_profile_recent_mfa(p_aal,p_mfa_at) THEN RETURN jsonb_build_object('ok',false,'code','RECENT_MFA_REQUIRED'); END IF;
  SELECT * INTO u FROM private.voice_profile_actor(p_auth_id);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  SELECT * INTO v FROM public.voice_profiles WHERE id=p_profile_id AND user_id=u.id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  IF v.status='revoked' THEN RETURN jsonb_build_object('ok',true,'replayed',true,'provider_voice_id',NULL); END IF;
  UPDATE public.voice_profiles SET status='revoking',revocation_requested_at=COALESCE(revocation_requested_at,now()),updated_at=now()
   WHERE id=v.id;
  RETURN jsonb_build_object('ok',true,'replayed',false,'provider_voice_id',v.provider_voice_id);
END $$;
REVOKE ALL ON FUNCTION public.voice_profile_start_revoke(TEXT,UUID,TEXT,BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.voice_profile_start_revoke(TEXT,UUID,TEXT,BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.voice_profile_finish_revoke(p_auth_id TEXT, p_profile_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE u public.users%ROWTYPE; changed UUID;
BEGIN
  SELECT * INTO u FROM private.voice_profile_actor(p_auth_id);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  UPDATE public.voice_profiles SET status='revoked',provider_voice_id=NULL,revoked_at=now(),updated_at=now(),error_code=NULL
   WHERE id=p_profile_id AND user_id=u.id AND status='revoking' RETURNING id INTO changed;
  RETURN CASE WHEN changed IS NULL THEN jsonb_build_object('ok',false,'code','STATE_CONFLICT')
              ELSE jsonb_build_object('ok',true) END;
END $$;
REVOKE ALL ON FUNCTION public.voice_profile_finish_revoke(TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.voice_profile_finish_revoke(TEXT,UUID) TO service_role;

-- Add active provider copies to the established account-deletion blockers.
CREATE OR REPLACE FUNCTION private.account_deletion_blockers(p_user_id UUID, p_auth_id TEXT)
RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_blockers TEXT[]; v_auth UUID;
BEGIN
  -- Preserve every blocker already implemented by 0347 through the same checks.
  v_blockers := ARRAY[]::TEXT[];
  BEGIN v_auth := p_auth_id::uuid; EXCEPTION WHEN invalid_text_representation THEN v_auth := NULL; END;
  IF EXISTS (SELECT 1 FROM public.users u WHERE u.id=p_user_id AND u.frozen_at IS NOT NULL) THEN v_blockers:=array_append(v_blockers,'account_frozen'); END IF;
  IF EXISTS (SELECT 1 FROM public.evidence_holds h JOIN public.jobs j ON j.id=h.job_id WHERE j.user_id=p_user_id AND h.released_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.assets a JOIN public.jobs j ON j.id=a.job_id WHERE j.user_id=p_user_id AND a.held_at IS NOT NULL) THEN v_blockers:=array_append(v_blockers,'account_on_hold'); END IF;
  IF EXISTS (SELECT 1 FROM public.credit_subscriptions s WHERE s.user_id=p_user_id AND s.status IN ('active','past_due'))
     OR EXISTS (SELECT 1 FROM public.social_publish_subscriptions s WHERE s.user_id=p_user_id AND s.status IN ('active','past_due')) THEN v_blockers:=array_append(v_blockers,'active_subscription'); END IF;
  IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.user_id=p_user_id AND j.state IN ('DEBITED','SUBMITTED','FAILOVER')) THEN v_blockers:=array_append(v_blockers,'generation_in_progress'); END IF;
  IF EXISTS (SELECT 1 FROM public.top_ups t WHERE t.user_id=p_user_id AND t.status='pending' AND t.created_at>now()-interval '2 hours') THEN v_blockers:=array_append(v_blockers,'top_up_in_progress'); END IF;
  IF EXISTS (SELECT 1 FROM public.cinema_content c WHERE c.creator_id=p_user_id)
     OR EXISTS (SELECT 1 FROM public.cinema_uploads c WHERE c.creator_id=p_user_id AND c.deleted_at IS NULL) THEN v_blockers:=array_append(v_blockers,'cinema_content_present'); END IF;
  IF v_auth IS NOT NULL AND EXISTS (SELECT 1 FROM public.projects p WHERE p.owner_id=v_auth AND p.deleted_at IS NULL) THEN v_blockers:=array_append(v_blockers,'projects_present'); END IF;
  IF EXISTS (SELECT 1 FROM public.social_brands b JOIN public.social_brand_members m ON m.brand_id=b.id WHERE b.owner_user_id=p_user_id AND m.user_id<>p_user_id) THEN v_blockers:=array_append(v_blockers,'publish_team_present'); END IF;
  IF EXISTS (SELECT 1 FROM public.voice_profiles v WHERE v.user_id=p_user_id AND v.status<>'revoked') THEN v_blockers:=array_append(v_blockers,'voice_profile_present'); END IF;
  RETURN v_blockers;
END $$;
REVOKE ALL ON FUNCTION private.account_deletion_blockers(UUID,TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.erase_revoked_voice_profiles()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    DELETE FROM public.voice_profiles WHERE user_id=NEW.id AND status='revoked';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.erase_revoked_voice_profiles() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS erase_revoked_voice_profiles ON public.users;
CREATE TRIGGER erase_revoked_voice_profiles AFTER UPDATE OF deleted_at ON public.users
FOR EACH ROW EXECUTE FUNCTION private.erase_revoked_voice_profiles();

-- Extend the established privacy export without copying its large projection
-- function. The previous implementation becomes a private, uncallable helper;
-- the public service-role wrapper adds only safe voice lifecycle metadata.
-- Provider handles and sample audio are deliberately excluded.
DO $$
BEGIN
  IF to_regprocedure('private.read_privacy_export_page_without_voice(text,text,uuid,text,uuid,text,text,integer)') IS NULL THEN
    ALTER FUNCTION public.read_privacy_export_page(TEXT,TEXT,UUID,TEXT,UUID,TEXT,TEXT,INTEGER)
      SET SCHEMA private;
    ALTER FUNCTION private.read_privacy_export_page(TEXT,TEXT,UUID,TEXT,UUID,TEXT,TEXT,INTEGER)
      RENAME TO read_privacy_export_page_without_voice;
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.read_privacy_export_page_without_voice(TEXT,TEXT,UUID,TEXT,UUID,TEXT,TEXT,INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.read_privacy_export_page(
  p_auth_id TEXT, p_aal TEXT, p_export_id UUID, p_section TEXT,
  p_thread_id UUID, p_after TEXT, p_key TEXT, p_page_size INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE result JSONB; profiles JSONB;
BEGIN
  result := private.read_privacy_export_page_without_voice(
    p_auth_id,p_aal,p_export_id,p_section,p_thread_id,p_after,p_key,p_page_size);
  IF p_section='profile' AND result->>'ok'='true' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',v.id,'name',v.name,'language',v.language,'status',v.status,
      'consent_version',v.consent_version,'consented_at',v.consented_at,
      'verified_at',v.verified_at,'ready_at',v.ready_at,
      'sample_count',v.sample_count,'sample_seconds',v.sample_seconds,
      'revocation_requested_at',v.revocation_requested_at,'revoked_at',v.revoked_at,
      'error_code',v.error_code,'created_at',v.created_at,'updated_at',v.updated_at
    ) ORDER BY v.created_at,v.id),'[]'::jsonb) INTO profiles
    FROM public.voice_profiles v
    JOIN public.users u ON u.id=v.user_id AND u.auth_id=p_auth_id AND u.deleted_at IS NULL
    JOIN public.privacy_export_requests r ON r.id=p_export_id AND r.user_id=u.id
    WHERE v.created_at<=r.as_of;
    result := jsonb_set(result,'{rows,0,voice_profiles}',profiles,true);
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_privacy_export_page(TEXT,TEXT,UUID,TEXT,UUID,TEXT,TEXT,INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_privacy_export_page(TEXT,TEXT,UUID,TEXT,UUID,TEXT,TEXT,INTEGER)
  TO service_role;
