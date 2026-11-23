-- Crun Suno music foundation (phase A only).
-- Schema and inactive routes only: no migration in this file activates Crun.
BEGIN;

CREATE TABLE IF NOT EXISTS public.crun_dispatch (
    job_id UUID PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL CHECK (endpoint = 'crun:suno/music-generate'),
    payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 65536),
    state TEXT NOT NULL DEFAULT 'READY' CHECK (state IN ('READY','STARTED','ACCEPTED','REJECTED','UNKNOWN','DEFERRED','CLOSED')),
    attempt_token UUID,
    provider_job_id TEXT CHECK (provider_job_id IS NULL OR provider_job_id ~ '^[A-Za-z0-9._-]{1,128}$'),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
    retry_at TIMESTAMPTZ,
    failure_code TEXT CHECK (failure_code IS NULL OR failure_code ~ '^[a-z0-9_]{1,64}$'),
    last_authoritative_status TEXT CHECK (last_authoritative_status IS NULL OR last_authoritative_status IN ('pending','running','success','failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    projected_at TIMESTAMPTZ,
    recovery_checked_at TIMESTAMPTZ
);
ALTER TABLE public.crun_dispatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crun_dispatch FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crun_dispatch FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.crun_dispatch TO service_role;
CREATE INDEX IF NOT EXISTS crun_dispatch_ready_idx ON public.crun_dispatch(retry_at, created_at, job_id)
    WHERE state IN ('READY','DEFERRED');
CREATE INDEX IF NOT EXISTS crun_dispatch_recovery_idx ON public.crun_dispatch(recovery_checked_at, created_at, job_id)
    WHERE state IN ('STARTED','ACCEPTED','REJECTED','UNKNOWN','DEFERRED');

-- One durable row per reserved CreateTask slot. The advisory lock in the RPC
-- makes the count a true account-wide rolling window under concurrency.
CREATE TABLE IF NOT EXISTS public.crun_create_reservations (
    reservation_key TEXT PRIMARY KEY CHECK (reservation_key ~ '^[A-Za-z0-9._:-]{8,160}$'),
    purpose TEXT NOT NULL CHECK (purpose ~ '^[a-z0-9._:-]{2,64}$'),
    reserved_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);
ALTER TABLE public.crun_create_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crun_create_reservations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crun_create_reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.crun_create_reservations TO service_role;
CREATE INDEX IF NOT EXISTS crun_create_reservations_window_idx ON public.crun_create_reservations(reserved_at);

-- Endpoint+frozen-Suno-model breaker. Route-wide 455/505 still uses every
-- matching model_routes.breaker_opened_at; this table is for one disabled Suno model.
CREATE TABLE IF NOT EXISTS public.crun_suno_model_breakers (
    endpoint TEXT NOT NULL CHECK (endpoint='crun:suno/music-generate'),
    suno_model TEXT NOT NULL CHECK (suno_model IN ('v6','v6_mini','v6_wild')),
    opened_at TIMESTAMPTZ NOT NULL,
    reason_code TEXT NOT NULL CHECK (reason_code ~ '^[a-z0-9_]{1,64}$'),
    fence BIGINT NOT NULL DEFAULT 1 CHECK (fence > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
    is_open BOOLEAN NOT NULL DEFAULT true,
    reopened_at TIMESTAMPTZ,
    PRIMARY KEY(endpoint,suno_model)
);
ALTER TABLE public.crun_suno_model_breakers ADD COLUMN IF NOT EXISTS is_open BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.crun_suno_model_breakers ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ;
ALTER TABLE public.crun_suno_model_breakers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crun_suno_model_breakers FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crun_suno_model_breakers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.crun_suno_model_breakers TO service_role;

CREATE OR REPLACE FUNCTION public.trip_crun_suno_model_breaker(
    p_endpoint TEXT,p_suno_model TEXT,p_reason_code TEXT,p_observed_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.crun_suno_model_breakers%ROWTYPE;
BEGIN
 IF p_endpoint<>'crun:suno/music-generate' OR p_suno_model NOT IN ('v6','v6_mini','v6_wild')
 OR p_reason_code !~ '^[a-z0-9_]{1,64}$' OR p_observed_at IS NULL OR p_observed_at>statement_timestamp()+interval '1 minute'
 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 INSERT INTO public.crun_suno_model_breakers(endpoint,suno_model,opened_at,reason_code,updated_at)
 VALUES(p_endpoint,p_suno_model,p_observed_at,p_reason_code,statement_timestamp())
 ON CONFLICT(endpoint,suno_model) DO UPDATE SET opened_at=EXCLUDED.opened_at,reason_code=EXCLUDED.reason_code,
   is_open=true,fence=public.crun_suno_model_breakers.fence+1,updated_at=statement_timestamp()
 WHERE (public.crun_suno_model_breakers.is_open AND public.crun_suno_model_breakers.updated_at<=p_observed_at)
    OR (NOT public.crun_suno_model_breakers.is_open AND p_observed_at>public.crun_suno_model_breakers.reopened_at)
 RETURNING * INTO v;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','STALE_FENCE'); END IF;
 RETURN jsonb_build_object('ok',true,'fence',v.fence,'opened_at',v.opened_at);
END $$;
REVOKE ALL ON FUNCTION public.trip_crun_suno_model_breaker(TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.trip_crun_suno_model_breaker(TEXT,TEXT,TEXT,TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION public.reopen_crun_suno_model_breaker(
 p_endpoint TEXT,p_suno_model TEXT,p_expected_fence BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n BIGINT;
BEGIN
 UPDATE public.crun_suno_model_breakers SET is_open=false,reopened_at=statement_timestamp(),fence=fence+1,updated_at=statement_timestamp()
  WHERE endpoint=p_endpoint AND suno_model=p_suno_model AND fence=p_expected_fence AND is_open;
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN CASE WHEN n=1 THEN jsonb_build_object('ok',true) ELSE jsonb_build_object('ok',false,'code','STALE_FENCE') END;
END $$;
REVOKE ALL ON FUNCTION public.reopen_crun_suno_model_breaker(TEXT,TEXT,BIGINT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_crun_suno_model_breaker(TEXT,TEXT,BIGINT) TO service_role;

-- The single atomic pre-submit gate for every Crun CreateTask. Admission is
-- checked while the shared policy row is locked and before a limiter row is
-- consumed. The endpoint/model parameters keep generic and Suno callers on
-- the same gate without making legacy two-argument callers fail deployment.
CREATE OR REPLACE FUNCTION public.reserve_crun_create_slot(
 p_reservation_key TEXT,p_purpose TEXT,p_endpoint TEXT,p_suno_model TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_now TIMESTAMPTZ; v_count INTEGER; v_retry INTEGER; v_admission BOOLEAN;
BEGIN
 IF p_reservation_key IS NULL OR p_reservation_key !~ '^[A-Za-z0-9._:-]{8,160}$'
 OR p_purpose IS NULL OR p_purpose !~ '^[a-z0-9._:-]{2,64}$'
 OR (p_endpoint IS NOT NULL AND p_endpoint !~ '^crun:[A-Za-z0-9._/-]{1,120}$')
 OR (p_suno_model IS NOT NULL AND (p_endpoint<>'crun:suno/music-generate'
     OR p_suno_model NOT IN ('v6','v6_mini','v6_wild'))) THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crun:create:account',0));
 SELECT admission_open INTO v_admission FROM public.provider_spend_provider_policy
  WHERE provider='crun' FOR UPDATE;
 IF NOT FOUND OR v_admission IS DISTINCT FROM true THEN
  RETURN jsonb_build_object('ok',false,'code','PROVIDER_ADMISSION_PAUSED','retry_after_seconds',60);
 END IF;
 IF p_endpoint IS NOT NULL AND EXISTS(SELECT 1 FROM public.model_routes
   WHERE supplier='crun' AND endpoint=p_endpoint AND breaker_opened_at IS NOT NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','CRUN_UNAVAILABLE','retry_after_seconds',60);
 END IF;
 IF p_endpoint='crun:suno/music-generate' AND p_suno_model IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.crun_suno_model_breakers
   WHERE endpoint=p_endpoint AND suno_model=p_suno_model AND is_open) THEN
  RETURN jsonb_build_object('ok',false,'code','CRUN_UNAVAILABLE','retry_after_seconds',60);
 END IF;
 v_now:=clock_timestamp();
 IF EXISTS(SELECT 1 FROM public.crun_create_reservations WHERE reservation_key=p_reservation_key) THEN
  RETURN jsonb_build_object('ok',true,'idempotent',true);
 END IF;
 DELETE FROM public.crun_create_reservations WHERE reserved_at<=v_now-interval '10 seconds';
 SELECT count(*) INTO v_count FROM public.crun_create_reservations WHERE reserved_at > v_now - interval '10 seconds';
 IF v_count >= 20 THEN
  SELECT GREATEST(1,ceil(extract(epoch FROM min(reserved_at)+interval '10 seconds'-v_now)))::INTEGER
   INTO v_retry FROM public.crun_create_reservations WHERE reserved_at > v_now - interval '10 seconds';
  RETURN jsonb_build_object('ok',false,'code','CRUN_RATE_LIMITED','retry_after_seconds',COALESCE(v_retry,1));
 END IF;
 INSERT INTO public.crun_create_reservations(reservation_key,purpose,reserved_at)
  VALUES(p_reservation_key,p_purpose,v_now);
 RETURN jsonb_build_object('ok',true,'idempotent',false,'remaining',19-v_count);
END $$;
REVOKE ALL ON FUNCTION public.reserve_crun_create_slot(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_crun_create_slot(TEXT,TEXT,TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_crun_create_slot(p_reservation_key TEXT,p_purpose TEXT)
RETURNS JSONB LANGUAGE SQL SECURITY DEFINER SET search_path='' AS $$
 SELECT public.reserve_crun_create_slot(p_reservation_key,p_purpose,NULL,NULL)
$$;
REVOKE ALL ON FUNCTION public.reserve_crun_create_slot(TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_crun_create_slot(TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION private.music_crun_quote_available(p_endpoint TEXT,p_suno_model TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_admission BOOLEAN;
BEGIN
 SELECT admission_open INTO v_admission FROM public.provider_spend_provider_policy WHERE provider='crun' FOR SHARE;
 IF NOT FOUND OR v_admission IS DISTINCT FROM true THEN RETURN false; END IF;
 PERFORM 1 FROM public.model_routes WHERE supplier='crun' AND endpoint=p_endpoint
  AND breaker_opened_at IS NOT NULL FOR SHARE;
 IF FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM public.crun_suno_model_breakers WHERE endpoint=p_endpoint AND suno_model=p_suno_model AND is_open FOR SHARE;
 RETURN NOT FOUND;
END $$;
REVOKE ALL ON FUNCTION private.music_crun_quote_available(TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.trip_crun_endpoint_routes(p_endpoint TEXT,p_observed_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n BIGINT;
BEGIN
 IF p_endpoint<>'crun:suno/music-generate' OR p_observed_at IS NULL THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 UPDATE public.model_routes SET breaker_opened_at=p_observed_at,updated_at=statement_timestamp()
 WHERE supplier='crun' AND endpoint=p_endpoint AND (breaker_opened_at IS NULL OR breaker_opened_at<=p_observed_at);
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN jsonb_build_object('ok',true,'updated',n);
END $$;
REVOKE ALL ON FUNCTION public.trip_crun_endpoint_routes(TEXT,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.trip_crun_endpoint_routes(TEXT,TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION public.reopen_crun_endpoint_routes(p_endpoint TEXT,p_expected_opened_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n BIGINT;
BEGIN
 IF p_endpoint<>'crun:suno/music-generate' OR p_expected_opened_at IS NULL THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 UPDATE public.model_routes SET breaker_opened_at=NULL,consecutive_failures=0,updated_at=statement_timestamp()
 WHERE supplier='crun' AND endpoint=p_endpoint AND breaker_opened_at=p_expected_opened_at;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n=0 THEN RETURN jsonb_build_object('ok',false,'code','STALE_FENCE'); END IF;
 RETURN jsonb_build_object('ok',true,'updated',n);
END $$;
REVOKE ALL ON FUNCTION public.reopen_crun_endpoint_routes(TEXT,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_crun_endpoint_routes(TEXT,TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION private.crun_suno_margin_ok(p_credits INTEGER,p_cost_per_request NUMERIC)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path='' AS $$
 SELECT p_credits IS NOT NULL AND p_credits>0 AND p_cost_per_request IS NOT NULL
  AND p_credits*0.033 >= 2*p_cost_per_request
$$;
REVOKE ALL ON FUNCTION private.crun_suno_margin_ok(INTEGER,NUMERIC) FROM PUBLIC,anon,authenticated;

-- Freeze the supplier contract on song-create rows only.
ALTER TABLE public.music_prompt_specs
 ADD COLUMN IF NOT EXISTS provider_contract TEXT,
 ADD COLUMN IF NOT EXISTS suno_model TEXT,
 ADD COLUMN IF NOT EXISTS vocal_gender TEXT,
 ADD COLUMN IF NOT EXISTS weirdness NUMERIC(4,3);
ALTER TABLE public.music_generation_quotes ADD COLUMN IF NOT EXISTS provider_contract TEXT;
ALTER TABLE public.music_lyric_drafts ADD COLUMN IF NOT EXISTS provider_contract TEXT;

UPDATE public.music_prompt_specs SET provider_contract='fal-ace-v1'
 WHERE provider_contract IS NULL AND mode IN ('simple','custom') AND model_id IN ('ace-step','ace-step-1.5','ace-step-loop');
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.music_prompt_specs WHERE mode IN ('simple','custom')
  AND model_id IN ('ace-step','ace-step-1.5','ace-step-loop') AND provider_contract IS NULL)
 THEN RAISE EXCEPTION '0584 prompt contract backfill left target rows unclassified'; END IF; END $$;
UPDATE public.music_generation_quotes q SET provider_contract='fal-ace-v1'
 FROM public.music_prompt_specs p WHERE p.id=q.prompt_spec_id AND p.mode IN ('simple','custom')
 AND p.model_id IN ('ace-step','ace-step-1.5','ace-step-loop') AND q.provider_contract IS NULL
 AND q.provider_endpoint IN ('fal-ai/ace-step','fal-ai/ace-step-1.5');
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.music_generation_quotes q JOIN public.music_prompt_specs p ON p.id=q.prompt_spec_id
 WHERE p.mode IN ('simple','custom') AND p.model_id IN ('ace-step','ace-step-1.5','ace-step-loop')
 AND q.provider_endpoint IN ('fal-ai/ace-step','fal-ai/ace-step-1.5') AND q.provider_contract IS NULL)
 THEN RAISE EXCEPTION '0584 quote contract backfill left target rows unclassified'; END IF; END $$;
UPDATE public.music_lyric_drafts SET provider_contract='fal-ace-v1' WHERE provider_contract IS NULL;
ALTER TABLE public.music_lyric_drafts ALTER COLUMN provider_contract SET DEFAULT 'fal-ace-v1';
ALTER TABLE public.music_lyric_drafts ALTER COLUMN provider_contract SET NOT NULL;

ALTER TABLE public.music_lyric_drafts DROP CONSTRAINT IF EXISTS music_lyric_drafts_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS music_lyric_drafts_user_contract_key
 ON public.music_lyric_drafts(user_id,provider_contract);

-- Widen physical columns first; contract checks below retain fal's old limits.
ALTER TABLE public.music_prompt_specs
 DROP CONSTRAINT IF EXISTS music_prompt_specs_lyrics_check,
 DROP CONSTRAINT IF EXISTS music_prompt_specs_styles_check,
 DROP CONSTRAINT IF EXISTS music_prompt_specs_exclude_styles_check,
 DROP CONSTRAINT IF EXISTS music_prompt_specs_duration_by_model_check,
 DROP CONSTRAINT IF EXISTS music_prompt_specs_duration_by_contract_check,
 DROP CONSTRAINT IF EXISTS music_prompt_specs_provider_contract_check,
 DROP CONSTRAINT IF EXISTS music_prompt_specs_suno_fields_check;
ALTER TABLE public.music_prompt_specs
 ADD CONSTRAINT music_prompt_specs_lyrics_check CHECK(lyrics IS NULL OR char_length(lyrics) BETWEEN 1 AND CASE provider_contract WHEN 'crun-suno-v1' THEN 5000 ELSE 3000 END) NOT VALID,
 ADD CONSTRAINT music_prompt_specs_styles_check CHECK(styles IS NULL OR char_length(styles) BETWEEN 1 AND CASE provider_contract WHEN 'crun-suno-v1' THEN 1000 ELSE 500 END) NOT VALID,
 ADD CONSTRAINT music_prompt_specs_exclude_styles_check CHECK(exclude_styles IS NULL OR char_length(exclude_styles) BETWEEN 1 AND CASE provider_contract WHEN 'crun-suno-v1' THEN 1000 ELSE 500 END) NOT VALID,
 ADD CONSTRAINT music_prompt_specs_duration_by_contract_check CHECK(
   (provider_contract='crun-suno-v1' AND duration_seconds BETWEEN 1 AND 135)
   OR (provider_contract IS DISTINCT FROM 'crun-suno-v1' AND
      (duration_seconds BETWEEN 10 AND 60 OR (model_id='ace-step-1.5' AND duration_seconds BETWEEN 10 AND 135)))) NOT VALID,
 ADD CONSTRAINT music_prompt_specs_provider_contract_check CHECK(
   (mode IN ('simple','custom') AND model_id IN ('ace-step','ace-step-1.5') AND provider_contract IN ('fal-ace-v1','crun-suno-v1'))
   OR (mode IN ('simple','custom') AND model_id='ace-step-loop' AND provider_contract='fal-ace-v1')
   OR ((mode NOT IN ('simple','custom') OR model_id NOT IN ('ace-step','ace-step-1.5','ace-step-loop')) AND provider_contract IS NULL)) NOT VALID,
 ADD CONSTRAINT music_prompt_specs_suno_fields_check CHECK(
   (provider_contract='crun-suno-v1' AND suno_model IN ('v6','v6_mini','v6_wild')
      AND (vocal_gender IS NULL OR vocal_gender IN ('auto','male','female'))
      AND (weirdness IS NULL OR weirdness BETWEEN 0 AND 1)
      AND bpm IS NULL AND key_scale IS NULL AND time_signature IS NULL)
   OR (provider_contract IS DISTINCT FROM 'crun-suno-v1' AND suno_model IS NULL AND vocal_gender IS NULL AND weirdness IS NULL)) NOT VALID;
ALTER TABLE public.music_prompt_specs VALIDATE CONSTRAINT music_prompt_specs_lyrics_check;
ALTER TABLE public.music_prompt_specs VALIDATE CONSTRAINT music_prompt_specs_styles_check;
ALTER TABLE public.music_prompt_specs VALIDATE CONSTRAINT music_prompt_specs_exclude_styles_check;
ALTER TABLE public.music_prompt_specs VALIDATE CONSTRAINT music_prompt_specs_duration_by_contract_check;
ALTER TABLE public.music_prompt_specs VALIDATE CONSTRAINT music_prompt_specs_provider_contract_check;
ALTER TABLE public.music_prompt_specs VALIDATE CONSTRAINT music_prompt_specs_suno_fields_check;

-- The pre-existing song-create shape required every simple fal row to be
-- instrumental. Widen only that clause for a frozen Crun contract, preserving
-- every later cover/edit/mashup branch byte-for-byte.
DO $$ DECLARE v_def TEXT;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
  WHERE conrelid='public.music_prompt_specs'::regclass AND conname='music_prompt_specs_mode_shape_check';
 IF v_def IS NOT NULL AND v_def NOT LIKE '%provider_contract%crun-suno-v1%' THEN
  IF position('(mode = ''simple''::text) AND instrumental' IN v_def)=0 THEN
   RAISE EXCEPTION '0584 could not widen music_prompt_specs_mode_shape_check';
  END IF;
  v_def:=replace(v_def,'(mode = ''simple''::text) AND instrumental',
   '(mode = ''simple''::text) AND (instrumental OR provider_contract = ''crun-suno-v1''::text)');
  ALTER TABLE public.music_prompt_specs DROP CONSTRAINT music_prompt_specs_mode_shape_check;
  EXECUTE 'ALTER TABLE public.music_prompt_specs ADD CONSTRAINT music_prompt_specs_mode_shape_check '||v_def;
 END IF;
END $$;

ALTER TABLE public.music_generation_quotes DROP CONSTRAINT IF EXISTS music_generation_quotes_provider_endpoint_check;
ALTER TABLE public.music_generation_quotes DROP CONSTRAINT IF EXISTS music_generation_quotes_provider_contract_check;
ALTER TABLE public.music_generation_quotes ADD CONSTRAINT music_generation_quotes_provider_endpoint_check CHECK(provider_endpoint IN(
 'fal-ai/ace-step','fal-ai/ace-step-1.5','crun:suno/music-generate',
 'fal-ai/stable-audio-3/small/music/audio-to-audio','fal-ai/ace-step/audio-outpaint','fal-ai/ace-step/audio-inpaint',
 'fal-ai/stable-audio-3/small/music/audio-outpainting'));
ALTER TABLE public.music_generation_quotes ADD CONSTRAINT music_generation_quotes_provider_contract_check CHECK(
 (provider_endpoint IN ('fal-ai/ace-step','fal-ai/ace-step-1.5') AND (provider_contract='fal-ace-v1' OR provider_contract IS NULL))
 OR (provider_endpoint='crun:suno/music-generate' AND provider_contract='crun-suno-v1')
 OR (provider_endpoint NOT IN ('fal-ai/ace-step','fal-ai/ace-step-1.5','crun:suno/music-generate') AND provider_contract IS NULL)) NOT VALID;
ALTER TABLE public.music_generation_quotes VALIDATE CONSTRAINT music_generation_quotes_provider_contract_check;

ALTER TABLE public.music_lyric_drafts
 DROP CONSTRAINT IF EXISTS music_lyric_drafts_lyrics_check,
 DROP CONSTRAINT IF EXISTS music_lyric_drafts_styles_check,
 DROP CONSTRAINT IF EXISTS music_lyric_drafts_contract_check;
ALTER TABLE public.music_lyric_drafts
 ADD CONSTRAINT music_lyric_drafts_contract_check CHECK(provider_contract IN ('fal-ace-v1','crun-suno-v1')) NOT VALID,
 ADD CONSTRAINT music_lyric_drafts_lyrics_check CHECK(char_length(lyrics)<=CASE provider_contract WHEN 'crun-suno-v1' THEN 5000 ELSE 3000 END) NOT VALID,
 ADD CONSTRAINT music_lyric_drafts_styles_check CHECK(char_length(styles)<=CASE provider_contract WHEN 'crun-suno-v1' THEN 1000 ELSE 500 END) NOT VALID;
ALTER TABLE public.music_lyric_drafts VALIDATE CONSTRAINT music_lyric_drafts_contract_check;
ALTER TABLE public.music_lyric_drafts VALIDATE CONSTRAINT music_lyric_drafts_lyrics_check;
ALTER TABLE public.music_lyric_drafts VALIDATE CONSTRAINT music_lyric_drafts_styles_check;

-- Provider-aware duration blocks. The two-argument compatibility function
-- resolves the current active catalog endpoint; frozen submit uses three args.
CREATE OR REPLACE FUNCTION private.music_duration_price_blocks(p_model_id TEXT,p_contract TEXT,p_duration_seconds INTEGER)
RETURNS INTEGER LANGUAGE SQL IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN p_contract IN ('crun-suno-v1','crun:suno/music-generate') THEN 1
  WHEN p_model_id='ace-step-1.5' THEN ceil(p_duration_seconds/60.0)::INTEGER ELSE 1 END
$$;
REVOKE ALL ON FUNCTION private.music_duration_price_blocks(TEXT,TEXT,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.music_duration_price_blocks(TEXT,TEXT,INTEGER) TO service_role;
CREATE OR REPLACE FUNCTION private.music_duration_price_blocks(p_model_id TEXT,p_duration_seconds INTEGER)
RETURNS INTEGER LANGUAGE SQL STABLE SET search_path='' AS $$
 SELECT private.music_duration_price_blocks(p_model_id,
   CASE c.provider_endpoint WHEN 'crun:suno/music-generate' THEN 'crun-suno-v1' ELSE 'fal-ace-v1' END,p_duration_seconds)
 FROM public.model_catalog c WHERE c.id=p_model_id
$$;
REVOKE ALL ON FUNCTION private.music_duration_price_blocks(TEXT,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.music_duration_price_blocks(TEXT,INTEGER) TO service_role;

-- Inactive, unverified routes only. No parity record, catalog flip or price change.
INSERT INTO public.model_routes(model_id,supplier,endpoint,cost_per_unit,cost_unit,billing_seconds,priority,state,provenance,parity_record)
SELECT c.id,'crun','crun:suno/music-generate',0.0536,'per_generation',NULL,2,'standby','unverified',NULL
FROM public.model_catalog c WHERE c.id IN ('ace-step','ace-step-1.5')
ON CONFLICT(model_id,supplier,endpoint) DO NOTHING;
DO $$ DECLARE n BIGINT; BEGIN
 SELECT count(*) INTO n FROM public.model_routes WHERE model_id IN ('ace-step','ace-step-1.5')
  AND supplier='crun' AND endpoint='crun:suno/music-generate';
 IF n<>2 THEN RAISE EXCEPTION '0584 expected exactly two Crun Suno routes, got %',n; END IF;
END $$;

CREATE OR REPLACE FUNCTION private.music_active_provider_contract(p_model_id TEXT)
RETURNS TEXT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE c.provider_endpoint WHEN 'crun:suno/music-generate' THEN 'crun-suno-v1'
 WHEN 'fal-ai/ace-step' THEN 'fal-ace-v1' WHEN 'fal-ai/ace-step-1.5' THEN 'fal-ace-v1' ELSE NULL END
 FROM public.model_catalog c WHERE c.id=p_model_id AND c.active AND NOT c.gated_flag
$$;
REVOKE ALL ON FUNCTION private.music_active_provider_contract(TEXT) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.music_bind_prompt_contract()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_contract TEXT;
BEGIN
 IF TG_OP='UPDATE' AND OLD.provider_contract IS NOT NULL AND NEW.provider_contract IS DISTINCT FROM OLD.provider_contract THEN
  RAISE EXCEPTION 'provider_contract is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.mode IN ('simple','custom') AND NEW.model_id IN ('ace-step','ace-step-1.5','ace-step-loop') AND NEW.provider_contract IS NULL THEN
  v_contract:=private.music_active_provider_contract(NEW.model_id);
  IF v_contract IS NULL THEN RAISE EXCEPTION 'active music provider contract unavailable'; END IF;
  NEW.provider_contract:=v_contract;
 END IF;
 IF NEW.provider_contract='crun-suno-v1' THEN NEW.suno_model:=COALESCE(NEW.suno_model,'v6'); END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.music_bind_prompt_contract() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS music_bind_prompt_contract ON public.music_prompt_specs;
CREATE TRIGGER music_bind_prompt_contract BEFORE INSERT OR UPDATE ON public.music_prompt_specs
 FOR EACH ROW EXECUTE FUNCTION private.music_bind_prompt_contract();

CREATE OR REPLACE FUNCTION private.music_bind_quote_contract()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_is_song_create BOOLEAN;
BEGIN
 IF TG_OP='UPDATE' AND OLD.provider_contract IS NOT NULL AND NEW.provider_contract IS DISTINCT FROM OLD.provider_contract THEN
  RAISE EXCEPTION 'provider_contract is immutable' USING ERRCODE='23514'; END IF;
 SELECT p.mode IN ('simple','custom') AND p.model_id IN ('ace-step','ace-step-1.5','ace-step-loop') INTO v_is_song_create
  FROM public.music_prompt_specs p WHERE p.id=NEW.prompt_spec_id;
 IF NEW.provider_contract IS NULL AND COALESCE(v_is_song_create,false) THEN NEW.provider_contract:=CASE NEW.provider_endpoint
  WHEN 'crun:suno/music-generate' THEN 'crun-suno-v1'
  WHEN 'fal-ai/ace-step' THEN 'fal-ace-v1' WHEN 'fal-ai/ace-step-1.5' THEN 'fal-ace-v1' ELSE NULL END; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.music_bind_quote_contract() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS music_bind_quote_contract ON public.music_generation_quotes;
CREATE TRIGGER music_bind_quote_contract BEFORE INSERT OR UPDATE ON public.music_generation_quotes
 FOR EACH ROW EXECUTE FUNCTION private.music_bind_quote_contract();

-- Contract-bound draft API. The legacy signatures below resolve the current
-- contract inside the same transaction and remain deploy-safe.
CREATE OR REPLACE FUNCTION public.music_get_custom_draft(p_auth_id TEXT,p_provider_contract TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; d public.music_lyric_drafts%ROWTYPE; v_active TEXT;
BEGIN
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
 v_active:=private.music_active_provider_contract('ace-step-1.5');
 IF p_provider_contract IS DISTINCT FROM v_active THEN RETURN jsonb_build_object('ok',false,'code','CONTRACT_STALE'); END IF;
 SELECT * INTO d FROM public.music_lyric_drafts WHERE user_id=v_user AND provider_contract=p_provider_contract;
 RETURN jsonb_build_object('ok',true,'provider_contract',p_provider_contract,'draft',CASE WHEN d.id IS NULL THEN
  jsonb_build_object('id',NULL,'model_id','ace-step-1.5','lyrics','','styles','','title','','revision',0,'updated_at',NULL)
  ELSE jsonb_build_object('id',d.id,'model_id',d.model_id,'lyrics',d.lyrics,'styles',d.styles,'title',d.title,
   'revision',d.revision,'updated_at',d.updated_at) END);
END $$;
REVOKE ALL ON FUNCTION public.music_get_custom_draft(TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_custom_draft(TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.music_get_custom_draft(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_contract TEXT; d public.music_lyric_drafts%ROWTYPE;
BEGIN
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
 v_contract:=COALESCE(private.music_active_provider_contract('ace-step-1.5'),'fal-ace-v1');
 SELECT * INTO d FROM public.music_lyric_drafts WHERE user_id=v_user AND provider_contract=v_contract;
 RETURN jsonb_build_object('ok',true,'provider_contract',v_contract,'draft',CASE WHEN d.id IS NULL THEN
  jsonb_build_object('id',NULL,'model_id','ace-step','lyrics','','styles','','title','','revision',0,'updated_at',NULL)
  ELSE jsonb_build_object('id',d.id,'model_id',d.model_id,'lyrics',d.lyrics,'styles',d.styles,'title',d.title,
   'revision',d.revision,'updated_at',d.updated_at) END);
END $$;
REVOKE ALL ON FUNCTION public.music_get_custom_draft(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_custom_draft(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.music_save_custom_draft(
 p_auth_id TEXT,p_provider_contract TEXT,p_draft_id UUID,p_expected_revision INTEGER,
 p_model_id TEXT,p_lyrics TEXT,p_styles TEXT,p_title TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; d public.music_lyric_drafts%ROWTYPE; v_active TEXT; v_lyrics_max INTEGER; v_styles_max INTEGER;
BEGIN
 v_active:=private.music_active_provider_contract('ace-step-1.5');
 IF p_provider_contract IS DISTINCT FROM v_active THEN RETURN jsonb_build_object('ok',false,'code','CONTRACT_STALE'); END IF;
 v_lyrics_max:=CASE p_provider_contract WHEN 'crun-suno-v1' THEN 5000 ELSE 3000 END;
 v_styles_max:=CASE p_provider_contract WHEN 'crun-suno-v1' THEN 1000 ELSE 500 END;
 IF p_expected_revision IS NULL OR p_expected_revision<0 OR p_model_id IS NULL OR p_model_id!~'^[A-Za-z0-9._-]{1,100}$'
 OR p_lyrics IS NULL OR char_length(p_lyrics)>v_lyrics_max OR p_styles IS NULL OR char_length(p_styles)>v_styles_max
 OR p_title IS NULL OR char_length(p_title)>80 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.model_catalog WHERE id=p_model_id AND active AND NOT gated_flag AND modality='text-to-audio') THEN
  RETURN jsonb_build_object('ok',false,'code','MODEL_UNAVAILABLE'); END IF;
 INSERT INTO public.music_lyric_drafts(user_id,provider_contract,model_id)
 VALUES(v_user,p_provider_contract,p_model_id) ON CONFLICT(user_id,provider_contract) DO NOTHING;
 SELECT * INTO d FROM public.music_lyric_drafts WHERE user_id=v_user AND provider_contract=p_provider_contract FOR UPDATE;
 IF p_draft_id IS NOT NULL AND d.id IS DISTINCT FROM p_draft_id THEN RETURN jsonb_build_object('ok',false,'code','DRAFT_STALE'); END IF;
 IF d.revision IS DISTINCT FROM p_expected_revision THEN RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT',
  'provider_contract',p_provider_contract,'draft',jsonb_build_object('id',d.id,'model_id',d.model_id,'lyrics',d.lyrics,
   'styles',d.styles,'title',d.title,'revision',d.revision,'updated_at',d.updated_at)); END IF;
 UPDATE public.music_lyric_drafts SET model_id=p_model_id,lyrics=p_lyrics,styles=p_styles,title=p_title,
  revision=revision+1,updated_at=statement_timestamp() WHERE id=d.id RETURNING * INTO d;
 RETURN jsonb_build_object('ok',true,'provider_contract',p_provider_contract,'draft',jsonb_build_object(
  'id',d.id,'model_id',d.model_id,'lyrics',d.lyrics,'styles',d.styles,'title',d.title,'revision',d.revision,'updated_at',d.updated_at));
END $$;
REVOKE ALL ON FUNCTION public.music_save_custom_draft(TEXT,TEXT,UUID,INTEGER,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_save_custom_draft(TEXT,TEXT,UUID,INTEGER,TEXT,TEXT,TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.music_save_custom_draft(
 p_auth_id TEXT,p_expected_revision INTEGER,p_model_id TEXT,p_lyrics TEXT,p_styles TEXT,p_title TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_contract TEXT; d public.music_lyric_drafts%ROWTYPE;
BEGIN
 IF p_expected_revision IS NULL OR p_expected_revision<0 OR p_model_id IS NULL OR p_model_id!~'^[A-Za-z0-9._-]{1,100}$'
  OR p_lyrics IS NULL OR char_length(p_lyrics)>3000 OR p_styles IS NULL OR char_length(p_styles)>500
  OR p_title IS NULL OR char_length(p_title)>80 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.model_catalog WHERE id=p_model_id AND active AND NOT gated_flag AND modality='text-to-audio') THEN
  RETURN jsonb_build_object('ok',false,'code','MODEL_UNAVAILABLE'); END IF;
 v_contract:=COALESCE(private.music_active_provider_contract('ace-step-1.5'),'fal-ace-v1');
 INSERT INTO public.music_lyric_drafts(user_id,provider_contract,model_id) VALUES(v_user,v_contract,p_model_id)
  ON CONFLICT(user_id,provider_contract) DO NOTHING;
 SELECT * INTO d FROM public.music_lyric_drafts WHERE user_id=v_user AND provider_contract=v_contract FOR UPDATE;
 IF d.revision IS DISTINCT FROM p_expected_revision THEN RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT',
  'draft',jsonb_build_object('id',d.id,'model_id',d.model_id,'lyrics',d.lyrics,'styles',d.styles,'title',d.title,
   'revision',d.revision,'updated_at',d.updated_at)); END IF;
 UPDATE public.music_lyric_drafts SET model_id=p_model_id,lyrics=p_lyrics,styles=p_styles,title=p_title,
  revision=revision+1,updated_at=statement_timestamp() WHERE id=d.id RETURNING * INTO d;
 RETURN jsonb_build_object('ok',true,'provider_contract',v_contract,'draft',jsonb_build_object('id',d.id,'model_id',d.model_id,
  'lyrics',d.lyrics,'styles',d.styles,'title',d.title,'revision',d.revision,'updated_at',d.updated_at));
END $$;
REVOKE ALL ON FUNCTION public.music_save_custom_draft(TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_save_custom_draft(TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.music_create_quote(
 p_auth_id TEXT,p_prompt TEXT,p_title TEXT DEFAULT NULL,p_model_id TEXT DEFAULT 'ace-step'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; m public.model_catalog%ROWTYPE; spec UUID; q public.music_generation_quotes%ROWTYPE;
 v_balance INTEGER; v_contract TEXT; v_blocks INTEGER;
BEGIN
 IF p_prompt IS NULL OR char_length(btrim(p_prompt)) NOT BETWEEN 1 AND 500
 OR (p_title IS NOT NULL AND char_length(btrim(p_title)) NOT BETWEEN 1 AND 80)
 OR p_model_id NOT IN ('ace-step','ace-step-1.5','ace-step-loop') THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
 IF p_model_id IN ('ace-step-1.5','ace-step-loop') AND NOT private.music_paid_plan_active(v_user) THEN
  RETURN jsonb_build_object('ok',false,'code','PLAN_UNAVAILABLE'); END IF;
 IF (SELECT count(*) FROM public.music_generation_quotes WHERE user_id=v_user AND created_at>now()-interval '60 seconds')>=20 THEN
  RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED','retry_after_seconds',60); END IF;
 SELECT * INTO m FROM public.model_catalog WHERE id=p_model_id;
 v_contract:=private.music_active_provider_contract(p_model_id);
 IF NOT FOUND OR v_contract IS NULL OR NOT m.active OR m.gated_flag OR m.modality<>'text-to-audio'
  OR m.credits_5s IS NULL OR m.credits_5s<=0
  OR m.provider_endpoint IS DISTINCT FROM (CASE v_contract WHEN 'crun-suno-v1' THEN 'crun:suno/music-generate'
      ELSE (CASE p_model_id WHEN 'ace-step' THEN 'fal-ai/ace-step' ELSE 'fal-ai/ace-step-1.5' END) END)
  OR (v_contract='crun-suno-v1' AND p_model_id='ace-step-loop')
  THEN RETURN jsonb_build_object('ok',false,'code','MODEL_UNAVAILABLE'); END IF;
 IF v_contract='crun-suno-v1' AND NOT private.music_crun_quote_available(m.provider_endpoint,
   COALESCE(NULLIF(current_setting('veyrnox.crun_suno_model',true),''),'v6')) THEN
  RETURN jsonb_build_object('ok',false,'code','MUSIC_UNAVAILABLE','retry_after_seconds',60); END IF;
 SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance
  FROM public.credit_balances WHERE user_id=v_user;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NO_BALANCE_ROW'); END IF;
 INSERT INTO public.music_prompt_specs(user_id,model_id,title,prompt,provider_contract,suno_model)
 VALUES(v_user,m.id,NULLIF(btrim(p_title),''),btrim(p_prompt),v_contract,
  CASE v_contract WHEN 'crun-suno-v1' THEN 'v6' ELSE NULL END) RETURNING id INTO spec;
 v_blocks:=private.music_duration_price_blocks(m.id,v_contract,60);
 INSERT INTO public.music_generation_quotes(user_id,prompt_spec_id,model_id,provider_endpoint,provider_contract,
  unit_credits,total_credits,catalog_updated_at,expires_at)
 VALUES(v_user,spec,m.id,m.provider_endpoint,v_contract,m.credits_5s*v_blocks,m.credits_5s*v_blocks*2,m.updated_at,now()+interval '5 minutes')
 RETURNING * INTO q;
 RETURN jsonb_build_object('ok',true,'quote_id',q.id,'model_id',q.model_id,'provider_contract',q.provider_contract,
  'unit_credits',q.unit_credits,'total_credits',q.total_credits,'balance',v_balance,
  'balance_after',v_balance-q.total_credits,'affordable',v_balance>=q.total_credits,'expires_at',q.expires_at);
END $$;
REVOKE ALL ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.music_create_custom_quote(
 p_auth_id TEXT,p_provider_contract TEXT,p_draft_id UUID,p_draft_revision INTEGER,
 p_instrumental BOOLEAN,p_rights_confirmed BOOLEAN,p_duration_seconds INTEGER
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; d public.music_lyric_drafts%ROWTYPE; m public.model_catalog%ROWTYPE;
 spec UUID; q public.music_generation_quotes%ROWTYPE; v_balance INTEGER; v_active TEXT; v_blocks INTEGER;
BEGIN
 v_active:=private.music_active_provider_contract('ace-step-1.5');
 IF p_provider_contract IS DISTINCT FROM v_active THEN RETURN jsonb_build_object('ok',false,'code','CONTRACT_STALE'); END IF;
 IF p_draft_id IS NULL OR p_draft_revision IS NULL OR p_draft_revision<0 OR p_instrumental IS NULL
 OR (p_instrumental AND p_rights_confirmed IS DISTINCT FROM false)
 OR (NOT p_instrumental AND p_rights_confirmed IS DISTINCT FROM true)
 OR p_duration_seconds IS NULL OR p_duration_seconds<(CASE p_provider_contract WHEN 'crun-suno-v1' THEN 1 ELSE 10 END) OR p_duration_seconds>135
 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
 IF (SELECT count(*) FROM public.music_generation_quotes WHERE user_id=v_user AND created_at>now()-interval '60 seconds')>=20 THEN
  RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED','retry_after_seconds',60); END IF;
 SELECT * INTO d FROM public.music_lyric_drafts WHERE id=p_draft_id AND user_id=v_user
  AND provider_contract=p_provider_contract AND revision=p_draft_revision FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); END IF;
 IF d.model_id<>'ace-step-1.5' OR char_length(btrim(d.styles)) NOT BETWEEN 1 AND (CASE p_provider_contract WHEN 'crun-suno-v1' THEN 1000 ELSE 500 END)
 OR (NOT p_instrumental AND char_length(btrim(d.lyrics)) NOT BETWEEN 1 AND (CASE p_provider_contract WHEN 'crun-suno-v1' THEN 5000 ELSE 3000 END))
 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT * INTO m FROM public.model_catalog WHERE id='ace-step-1.5';
 IF NOT FOUND OR NOT m.active OR m.gated_flag OR m.credits_5s IS NULL OR m.credits_5s<=0
  OR private.music_active_provider_contract(m.id) IS DISTINCT FROM p_provider_contract
  OR m.provider_endpoint IS DISTINCT FROM (CASE p_provider_contract WHEN 'crun-suno-v1' THEN 'crun:suno/music-generate' ELSE 'fal-ai/ace-step-1.5' END)
 THEN RETURN jsonb_build_object('ok',false,'code','CONTRACT_STALE'); END IF;
 IF p_provider_contract='crun-suno-v1' AND NOT private.music_crun_quote_available(m.provider_endpoint,
   COALESCE(NULLIF(current_setting('veyrnox.crun_suno_model',true),''),'v6')) THEN
  RETURN jsonb_build_object('ok',false,'code','MUSIC_UNAVAILABLE','retry_after_seconds',60); END IF;
 IF NOT private.music_paid_plan_active(v_user) THEN RETURN jsonb_build_object('ok',false,'code','PLAN_UNAVAILABLE'); END IF;
 SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance
  FROM public.credit_balances WHERE user_id=v_user;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NO_BALANCE_ROW'); END IF;
 INSERT INTO public.music_prompt_specs(user_id,mode,model_id,title,prompt,instrumental,schema_version,
  lyrics,styles,draft_revision,lyrics_rights_version,duration_seconds,provider_contract,suno_model)
 VALUES(v_user,'custom',m.id,NULLIF(btrim(d.title),''),left(btrim(d.styles),500),p_instrumental,'music-custom-v1',
  CASE WHEN p_instrumental THEN NULL ELSE d.lyrics END,d.styles,d.revision,
  CASE WHEN p_instrumental THEN NULL ELSE 'music-lyrics-rights-v1' END,p_duration_seconds,p_provider_contract,
  CASE p_provider_contract WHEN 'crun-suno-v1' THEN 'v6' ELSE NULL END) RETURNING id INTO spec;
 v_blocks:=private.music_duration_price_blocks(m.id,p_provider_contract,p_duration_seconds);
 INSERT INTO public.music_generation_quotes(user_id,prompt_spec_id,model_id,provider_endpoint,provider_contract,
  unit_credits,total_credits,catalog_updated_at,expires_at)
 VALUES(v_user,spec,m.id,m.provider_endpoint,p_provider_contract,m.credits_5s*v_blocks,m.credits_5s*v_blocks*2,m.updated_at,now()+interval '5 minutes')
 RETURNING * INTO q;
 RETURN jsonb_build_object('ok',true,'quote_id',q.id,'model_id',q.model_id,'provider_contract',q.provider_contract,
  'unit_credits',q.unit_credits,'total_credits',q.total_credits,'balance',v_balance,'balance_after',v_balance-q.total_credits,
  'affordable',v_balance>=q.total_credits,'expires_at',q.expires_at,'duration_seconds',p_duration_seconds,
  'mode','custom','draft_id',d.id,'draft_revision',d.revision,'instrumental',p_instrumental);
END $$;
REVOKE ALL ON FUNCTION public.music_create_custom_quote(TEXT,TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_create_custom_quote(TEXT,TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN,INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.music_create_custom_quote(
 p_auth_id TEXT,p_draft_revision INTEGER,p_instrumental BOOLEAN,p_rights_confirmed BOOLEAN,p_duration_seconds INTEGER
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_contract TEXT; v_draft UUID;
BEGIN
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
 v_contract:=private.music_active_provider_contract('ace-step-1.5');
 SELECT id INTO v_draft FROM public.music_lyric_drafts WHERE user_id=v_user AND provider_contract=v_contract;
 IF v_draft IS NULL THEN RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); END IF;
 RETURN public.music_create_custom_quote(p_auth_id,v_contract,v_draft,p_draft_revision,p_instrumental,p_rights_confirmed,p_duration_seconds);
END $$;
REVOKE ALL ON FUNCTION public.music_create_custom_quote(TEXT,INTEGER,BOOLEAN,BOOLEAN,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_create_custom_quote(TEXT,INTEGER,BOOLEAN,BOOLEAN,INTEGER) TO service_role;

-- Latest deployed simple-quote signature (0514). Tempo/key/signature are fal
-- controls and are rejected before a Crun quote row is created.
CREATE OR REPLACE FUNCTION public.music_create_quote(
 p_auth_id TEXT,p_prompt TEXT,p_title TEXT,p_model_id TEXT,p_variety INTEGER,
 p_style_influence INTEGER,p_exclude_styles TEXT,p_duration_seconds INTEGER,
 p_bpm INTEGER,p_key_scale TEXT,p_time_signature TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result JSONB; spec UUID;
BEGIN
 IF (p_bpm IS NOT NULL OR p_key_scale IS NOT NULL OR p_time_signature IS NOT NULL)
   AND private.music_active_provider_contract(p_model_id)='crun-suno-v1' THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 IF (p_bpm IS NOT NULL OR p_key_scale IS NOT NULL OR p_time_signature IS NOT NULL)
   AND p_model_id IS DISTINCT FROM 'ace-step-1.5' THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 IF (p_bpm IS NOT NULL AND p_bpm NOT BETWEEN 40 AND 220)
  OR (p_key_scale IS NOT NULL AND p_key_scale!~'^(C|C#|D|D#|E|F|F#|G|G#|A|A#|B) (Major|Minor)$')
  OR (p_time_signature IS NOT NULL AND p_time_signature NOT IN ('2','3','4','6')) THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 result:=public.music_create_quote(p_auth_id,p_prompt,p_title,p_model_id,p_variety,p_style_influence,
  p_exclude_styles,p_duration_seconds);
 IF result->>'ok' IS DISTINCT FROM 'true' OR (p_bpm IS NULL AND p_key_scale IS NULL AND p_time_signature IS NULL) THEN
  RETURN result; END IF;
 SELECT q.prompt_spec_id INTO spec FROM public.music_generation_quotes q JOIN public.users u ON u.id=q.user_id
  WHERE q.id=(result->>'quote_id')::UUID AND u.auth_id=p_auth_id;
 IF spec IS NULL THEN RAISE EXCEPTION 'music quote prompt snapshot missing'; END IF;
 UPDATE public.music_prompt_specs SET bpm=p_bpm,key_scale=p_key_scale,time_signature=p_time_signature WHERE id=spec;
 RETURN result||jsonb_build_object('bpm',p_bpm,'key_scale',p_key_scale,'time_signature',p_time_signature);
END $$;
REVOKE ALL ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,TEXT,INTEGER,INTEGER,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,TEXT,INTEGER,INTEGER,TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.music_get_reuse_draft_context(
 p_auth_id TEXT,p_song_id UUID,p_version_id UUID,p_provider_contract TEXT
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; p public.music_prompt_specs%ROWTYPE; v_title TEXT; d public.music_lyric_drafts%ROWTYPE;
 v_lyrics TEXT; v_styles TEXT;
BEGIN
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
 IF p_provider_contract IS DISTINCT FROM private.music_active_provider_contract('ace-step-1.5') THEN
  RETURN jsonb_build_object('ok',false,'code','CONTRACT_STALE'); END IF;
 IF EXISTS(SELECT 1 FROM public.music_song_versions v JOIN public.music_songs s ON s.id=v.song_id
  WHERE v.id=p_version_id AND v.song_id=p_song_id AND v.user_id=v_user AND s.user_id=v_user
   AND s.status='active' AND v.generation_request_id IS NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','REUSE_UNAVAILABLE'); END IF;
 SELECT ps.* INTO p FROM public.music_songs s
 JOIN public.music_song_versions v ON v.id=p_version_id AND v.user_id=v_user AND v.song_id=s.id
 JOIN public.music_generation_requests r ON r.id=v.generation_request_id AND r.user_id=v_user
 JOIN public.music_prompt_specs ps ON ps.id=r.prompt_spec_id AND ps.user_id=v_user
 WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active' AND s.current_version_id=p_version_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); END IF;
 SELECT title INTO v_title FROM public.music_songs WHERE id=p_song_id AND user_id=v_user;
 v_lyrics:=COALESCE(p.lyrics,''); v_styles:=COALESCE(NULLIF(p.styles,''),NULLIF(p.prompt,''),'');
 IF v_lyrics='' AND v_styles='' THEN RETURN jsonb_build_object('ok',false,'code','REUSE_UNAVAILABLE'); END IF;
 -- A song made under another contract can exceed the target contract's draft limits (Crun 5000/1000, fal 3000/500).
 IF char_length(v_lyrics)>(CASE p_provider_contract WHEN 'crun-suno-v1' THEN 5000 ELSE 3000 END)
  OR char_length(v_styles)>(CASE p_provider_contract WHEN 'crun-suno-v1' THEN 1000 ELSE 500 END) THEN
  RETURN jsonb_build_object('ok',false,'code','REUSE_UNAVAILABLE'); END IF;
 SELECT * INTO d FROM public.music_lyric_drafts WHERE user_id=v_user AND provider_contract=p_provider_contract;
 RETURN jsonb_build_object('ok',true,'provider_contract',p_provider_contract,'draft_id',d.id,
  'source',jsonb_build_object('song_id',p_song_id,'version_id',p_version_id,'title',v_title,'source_mode',p.mode,
   'lyrics',v_lyrics,'styles',v_styles,'has_lyrics',v_lyrics<>'','has_styles',v_styles<>''),
  'draft_revision',COALESCE(d.revision,0));
END $$;
REVOKE ALL ON FUNCTION public.music_get_reuse_draft_context(TEXT,UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_reuse_draft_context(TEXT,UUID,UUID,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.music_get_reuse_draft_context(p_auth_id TEXT,p_song_id UUID,p_version_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN RETURN public.music_get_reuse_draft_context(p_auth_id,p_song_id,p_version_id,
 private.music_active_provider_contract('ace-step-1.5')); END $$;
REVOKE ALL ON FUNCTION public.music_get_reuse_draft_context(TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_reuse_draft_context(TEXT,UUID,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.music_apply_reuse_to_draft(
 p_auth_id TEXT,p_song_id UUID,p_version_id UUID,p_draft_id UUID,p_expected_revision INTEGER,
 p_reuse_lyrics BOOLEAN,p_reuse_styles BOOLEAN,p_idempotency_key TEXT,p_provider_contract TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; p public.music_prompt_specs%ROWTYPE; d public.music_lyric_drafts%ROWTYPE;
 rec public.music_reuse_draft_receipts%ROWTYPE; v_lyrics TEXT; v_styles TEXT; out_draft JSONB;
BEGIN
 IF p_provider_contract IS DISTINCT FROM private.music_active_provider_contract('ace-step-1.5') THEN
  RETURN jsonb_build_object('ok',false,'code','CONTRACT_STALE'); END IF;
 IF p_expected_revision IS NULL OR p_expected_revision<0 OR p_reuse_lyrics IS NULL OR p_reuse_styles IS NULL
 OR (NOT p_reuse_lyrics AND NOT p_reuse_styles) OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$'
 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id FOR UPDATE;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
 SELECT * INTO rec FROM public.music_reuse_draft_receipts WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF rec.source_song_id IS DISTINCT FROM p_song_id OR rec.source_version_id IS DISTINCT FROM p_version_id
   OR rec.reuse_lyrics IS DISTINCT FROM p_reuse_lyrics OR rec.reuse_styles IS DISTINCT FROM p_reuse_styles
   OR COALESCE(rec.result_draft->>'provider_contract','fal-ace-v1') IS DISTINCT FROM p_provider_contract
  THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  RETURN jsonb_build_object('ok',true,'provider_contract',p_provider_contract,'draft',rec.result_draft,'idempotent',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.music_song_versions v JOIN public.music_songs s ON s.id=v.song_id
  WHERE v.id=p_version_id AND v.song_id=p_song_id AND v.user_id=v_user AND s.user_id=v_user
   AND s.status='active' AND v.generation_request_id IS NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','REUSE_UNAVAILABLE'); END IF;
 SELECT ps.* INTO p FROM public.music_songs s
 JOIN public.music_song_versions v ON v.id=p_version_id AND v.user_id=v_user AND v.song_id=s.id
 JOIN public.music_generation_requests r ON r.id=v.generation_request_id AND r.user_id=v_user
 JOIN public.music_prompt_specs ps ON ps.id=r.prompt_spec_id AND ps.user_id=v_user
 WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active' AND s.current_version_id=p_version_id FOR SHARE OF s,v,r,ps;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); END IF;
 v_lyrics:=COALESCE(p.lyrics,''); v_styles:=COALESCE(NULLIF(p.styles,''),NULLIF(p.prompt,''),'');
 IF (p_reuse_lyrics AND v_lyrics='') OR (p_reuse_styles AND v_styles='') THEN
  RETURN jsonb_build_object('ok',false,'code','REUSE_UNAVAILABLE'); END IF;
 IF (p_reuse_lyrics AND char_length(v_lyrics)>(CASE p_provider_contract WHEN 'crun-suno-v1' THEN 5000 ELSE 3000 END))
  OR (p_reuse_styles AND char_length(v_styles)>(CASE p_provider_contract WHEN 'crun-suno-v1' THEN 1000 ELSE 500 END)) THEN
  RETURN jsonb_build_object('ok',false,'code','REUSE_UNAVAILABLE'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.model_catalog WHERE id='ace-step-1.5' AND active
  AND NOT gated_flag AND modality='text-to-audio' FOR SHARE) THEN
  RETURN jsonb_build_object('ok',false,'code','MODEL_UNAVAILABLE'); END IF;
 INSERT INTO public.music_lyric_drafts(user_id,provider_contract,model_id) VALUES(v_user,p_provider_contract,'ace-step-1.5')
 ON CONFLICT(user_id,provider_contract) DO NOTHING;
 SELECT * INTO d FROM public.music_lyric_drafts WHERE user_id=v_user AND provider_contract=p_provider_contract FOR UPDATE;
 IF p_draft_id IS NOT NULL AND d.id IS DISTINCT FROM p_draft_id THEN RETURN jsonb_build_object('ok',false,'code','DRAFT_STALE'); END IF;
 IF d.revision IS DISTINCT FROM p_expected_revision THEN RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT',
  'provider_contract',p_provider_contract,'draft',jsonb_build_object('id',d.id,'revision',d.revision)); END IF;
 UPDATE public.music_lyric_drafts SET model_id='ace-step-1.5',
  lyrics=CASE WHEN p_reuse_lyrics THEN v_lyrics ELSE lyrics END,
  styles=CASE WHEN p_reuse_styles THEN v_styles ELSE styles END,revision=revision+1,updated_at=now()
 WHERE id=d.id RETURNING * INTO d;
 out_draft:=jsonb_build_object('id',d.id,'provider_contract',p_provider_contract,'model_id',d.model_id,
  'lyrics',d.lyrics,'styles',d.styles,'title',d.title,'revision',d.revision,'updated_at',d.updated_at);
 INSERT INTO public.music_reuse_draft_receipts(user_id,source_song_id,source_version_id,reuse_lyrics,reuse_styles,idempotency_key,result_draft)
 VALUES(v_user,p_song_id,p_version_id,p_reuse_lyrics,p_reuse_styles,p_idempotency_key,out_draft);
 RETURN jsonb_build_object('ok',true,'provider_contract',p_provider_contract,'draft',out_draft,'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.music_apply_reuse_to_draft(TEXT,UUID,UUID,UUID,INTEGER,BOOLEAN,BOOLEAN,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_apply_reuse_to_draft(TEXT,UUID,UUID,UUID,INTEGER,BOOLEAN,BOOLEAN,TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.music_apply_reuse_to_draft(
 p_auth_id TEXT,p_song_id UUID,p_version_id UUID,p_expected_revision INTEGER,
 p_reuse_lyrics BOOLEAN,p_reuse_styles BOOLEAN,p_idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_contract TEXT; v_draft UUID;
BEGIN
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
 v_contract:=private.music_active_provider_contract('ace-step-1.5');
 SELECT id INTO v_draft FROM public.music_lyric_drafts WHERE user_id=v_user AND provider_contract=v_contract;
 RETURN public.music_apply_reuse_to_draft(p_auth_id,p_song_id,p_version_id,v_draft,p_expected_revision,
  p_reuse_lyrics,p_reuse_styles,p_idempotency_key,v_contract);
END $$;
REVOKE ALL ON FUNCTION public.music_apply_reuse_to_draft(TEXT,UUID,UUID,INTEGER,BOOLEAN,BOOLEAN,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_apply_reuse_to_draft(TEXT,UUID,UUID,INTEGER,BOOLEAN,BOOLEAN,TEXT) TO service_role;

-- Catalog-driven pair admission. The quote and prompt retain the immutable
-- provider contract; a route flip makes an older quote stale.
CREATE OR REPLACE FUNCTION private.music_submit_pair_unbounded(
 p_auth_id TEXT,p_quote_id UUID,p_idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_balance INTEGER; v_recent INTEGER; q public.music_generation_quotes%ROWTYPE;
 p public.music_prompt_specs%ROWTYPE; m public.model_catalog%ROWTYPE; req public.music_generation_requests%ROWTYPE;
 existing public.music_generation_requests%ROWTYPE; one JSONB; two JSONB; job1 UUID; job2 UUID;
 failure JSONB; jobs JSONB; payload JSONB; input JSONB; expected_contract TEXT; v_open BOOLEAN;
BEGIN
 IF p_quote_id IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
 SELECT * INTO existing FROM public.music_generation_requests WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF existing.quote_id IS DISTINCT FROM p_quote_id THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  SELECT COALESCE(jsonb_agg(c.job_id ORDER BY c.ordinal),'[]'::jsonb) INTO jobs
   FROM public.music_generation_candidates c WHERE c.generation_request_id=existing.id;
  SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance
   FROM public.credit_balances WHERE user_id=v_user;
  RETURN jsonb_build_object('ok',true,'request_id',existing.id,'state',existing.status,'job_ids',jobs,
   'balance_after',v_balance,'idempotent',true);
 END IF;
 SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance
  FROM public.credit_balances WHERE user_id=v_user FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NO_BALANCE_ROW'); END IF;
 -- Required second receipt lookup after the money lock.
 SELECT * INTO existing FROM public.music_generation_requests WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF existing.quote_id IS DISTINCT FROM p_quote_id THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  SELECT COALESCE(jsonb_agg(c.job_id ORDER BY c.ordinal),'[]'::jsonb) INTO jobs
   FROM public.music_generation_candidates c WHERE c.generation_request_id=existing.id;
  RETURN jsonb_build_object('ok',true,'request_id',existing.id,'state',existing.status,'job_ids',jobs,
   'balance_after',v_balance,'idempotent',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.users WHERE id=v_user AND frozen_at IS NOT NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','ACCOUNT_FROZEN'); END IF;
 SELECT * INTO q FROM public.music_generation_quotes WHERE id=p_quote_id AND user_id=v_user FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF q.consumed_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_ALREADY_USED'); END IF;
 IF q.expires_at<=now() THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_EXPIRED'); END IF;
 SELECT * INTO p FROM public.music_prompt_specs WHERE id=q.prompt_spec_id AND user_id=v_user;
 SELECT * INTO m FROM public.model_catalog WHERE id=q.model_id FOR SHARE;
 expected_contract:=CASE m.provider_endpoint WHEN 'crun:suno/music-generate' THEN 'crun-suno-v1'
  WHEN 'fal-ai/ace-step' THEN 'fal-ace-v1' WHEN 'fal-ai/ace-step-1.5' THEN 'fal-ace-v1' END;
 IF NOT FOUND OR expected_contract IS NULL OR NOT m.active OR m.gated_flag OR m.modality<>'text-to-audio'
 OR m.provider_endpoint IS DISTINCT FROM q.provider_endpoint OR q.provider_contract IS DISTINCT FROM expected_contract
 OR (expected_contract='crun-suno-v1' AND (m.provider IS DISTINCT FROM 'crun' OR q.model_id NOT IN ('ace-step','ace-step-1.5')))
 OR (expected_contract='fal-ace-v1' AND (m.provider IS DISTINCT FROM 'fal' OR m.provider_endpoint IS DISTINCT FROM CASE q.model_id
      WHEN 'ace-step' THEN 'fal-ai/ace-step' WHEN 'ace-step-1.5' THEN 'fal-ai/ace-step-1.5'
      WHEN 'ace-step-loop' THEN 'fal-ai/ace-step-1.5' END))
 OR p.provider_contract IS DISTINCT FROM q.provider_contract
 OR m.credits_5s*private.music_duration_price_blocks(q.model_id,q.provider_contract,p.duration_seconds)<>q.unit_credits
 OR m.updated_at IS DISTINCT FROM q.catalog_updated_at THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_STALE'); END IF;
 IF q.provider_contract='crun-suno-v1' THEN
  SELECT NOT admission_open INTO v_open FROM public.provider_spend_provider_policy WHERE provider='crun';
  IF COALESCE(v_open,true) OR EXISTS(SELECT 1 FROM public.model_routes r WHERE r.model_id=q.model_id AND r.supplier='crun'
    AND r.endpoint=q.provider_endpoint AND r.breaker_opened_at IS NOT NULL)
   OR EXISTS(SELECT 1 FROM public.crun_suno_model_breakers b WHERE b.endpoint=q.provider_endpoint AND b.suno_model=p.suno_model AND b.is_open)
  THEN RETURN jsonb_build_object('ok',false,'code','MUSIC_UNAVAILABLE','retry_after_seconds',60); END IF;
  IF p.bpm IS NOT NULL OR p.key_scale IS NOT NULL OR p.time_signature IS NOT NULL THEN
   RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
  IF (p.mode='custom' OR p.title IS NOT NULL OR p.styles IS NOT NULL OR p.exclude_styles IS NOT NULL
      OR p.style_influence IS NOT NULL OR p.variety IS NOT NULL OR p.duration_seconds<>60)
     AND NOT p.instrumental AND NULLIF(btrim(COALESCE(p.lyrics,'')),'') IS NULL THEN
   RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 END IF;
 IF q.model_id IN ('ace-step-1.5','ace-step-loop') AND NOT private.music_paid_plan_active(v_user) THEN
  RETURN jsonb_build_object('ok',false,'code','PLAN_UNAVAILABLE'); END IF;
 IF v_balance<q.total_credits THEN RETURN jsonb_build_object('ok',false,'code','INSUFFICIENT_BALANCE'); END IF;
 SELECT count(*) INTO v_recent FROM public.jobs WHERE user_id=v_user AND created_at>now()-interval '60 seconds';
 IF v_recent>8 THEN RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED','retry_after_seconds',60); END IF;
 BEGIN
  INSERT INTO public.music_generation_requests(user_id,quote_id,prompt_spec_id,model_id,idempotency_key,credit_quote)
   VALUES(v_user,q.id,p.id,m.id,p_idempotency_key,q.total_credits) RETURNING * INTO req;
  one:=public.ledger_debit(v_user,p_idempotency_key||'.1',q.unit_credits,'debit:music_generation',m.id,
   jsonb_build_object('prompt',p.prompt,'music_request_id',req.id,'music_candidate_ordinal',1),0,60);
  IF one->>'ok' IS DISTINCT FROM 'true' THEN failure:=one; RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='pair debit one'; END IF;
  two:=public.ledger_debit(v_user,p_idempotency_key||'.2',q.unit_credits,'debit:music_generation',m.id,
   jsonb_build_object('prompt',p.prompt,'music_request_id',req.id,'music_candidate_ordinal',2),0,60);
  IF two->>'ok' IS DISTINCT FROM 'true' THEN failure:=two; RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='pair debit two'; END IF;
  job1:=(one->>'job_id')::UUID; job2:=(two->>'job_id')::UUID;
  INSERT INTO public.music_generation_candidates(user_id,generation_request_id,ordinal,job_id)
   VALUES(v_user,req.id,1,job1),(v_user,req.id,2,job2);
  IF q.provider_contract='crun-suno-v1' THEN
   input:=CASE WHEN p.mode='simple' AND p.title IS NULL AND p.styles IS NULL AND p.exclude_styles IS NULL
      AND p.style_influence IS NULL AND p.variety IS NULL AND p.duration_seconds=60
    THEN jsonb_build_object('mode','simple','prompt',p.prompt,'instrumental',p.instrumental,'suno_model',p.suno_model)
    ELSE jsonb_strip_nulls(jsonb_build_object('mode','custom','instrumental',p.instrumental,'suno_model',p.suno_model,
     'title',p.title,'tags',COALESCE(NULLIF(p.styles,''),p.prompt),'lyrics',CASE WHEN p.instrumental THEN NULL ELSE p.lyrics END,
     'negative_tags',CASE WHEN p.exclude_styles IS NULL THEN NULL ELSE left(p.exclude_styles,200) END,
     'vocal_gender',CASE p.vocal_gender WHEN 'male' THEN 'm' WHEN 'female' THEN 'f' ELSE NULL END,
     'style_weight',CASE WHEN p.style_influence IS NULL THEN NULL ELSE round(p.style_influence::NUMERIC/100,2) END,
     'weirdness_constraint',p.weirdness,'duration',p.duration_seconds,
     'variety',CASE WHEN p.variety IS NULL THEN NULL ELSE round(p.variety::NUMERIC/25)::INTEGER END)) END;
   payload:=jsonb_build_object('model','suno/music-generate','input',input);
   INSERT INTO public.crun_dispatch(job_id,endpoint,payload) VALUES(job1,q.provider_endpoint,payload),(job2,q.provider_endpoint,payload);
  ELSE
   payload:=CASE m.id WHEN 'ace-step' THEN jsonb_build_object('tags',p.prompt,'duration',60)
    ELSE jsonb_build_object('prompt',p.prompt,'duration',60,'thinking',true,'num_outputs',1) END;
   INSERT INTO public.fal_dispatch(job_id,endpoint,payload) VALUES(job1,q.provider_endpoint,payload),(job2,q.provider_endpoint,payload);
  END IF;
  UPDATE public.music_generation_quotes SET consumed_at=now() WHERE id=q.id;
 EXCEPTION WHEN SQLSTATE 'P0001' THEN RETURN COALESCE(failure,jsonb_build_object('ok',false,'code','PAIR_DEBIT_FAILED'));
 END;
 SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance
  FROM public.credit_balances WHERE user_id=v_user;
 RETURN jsonb_build_object('ok',true,'request_id',req.id,'state','debited','job_ids',jsonb_build_array(job1,job2),
  'balance_after',v_balance,'idempotent',false,'provider_contract',q.provider_contract);
END $$;
REVOKE ALL ON FUNCTION private.music_submit_pair_unbounded(TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.music_submit_pair(p_auth_id TEXT,p_quote_id UUID,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_active INTEGER; v_replay BOOLEAN;
BEGIN
 IF p_quote_id IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id FOR UPDATE;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_user::TEXT||':'||p_idempotency_key,0));
 SELECT EXISTS(SELECT 1 FROM public.music_generation_requests WHERE user_id=v_user AND idempotency_key=p_idempotency_key) INTO v_replay;
 IF NOT v_replay THEN
  SELECT count(*) INTO v_active FROM public.music_generation_requests WHERE user_id=v_user AND status IN ('debited','running');
  IF v_active>=4 THEN RETURN jsonb_build_object('ok',false,'code','CONCURRENCY_LIMIT'); END IF;
 END IF;
 RETURN private.music_submit_pair_unbounded(p_auth_id,p_quote_id,p_idempotency_key);
END $$;
REVOKE ALL ON FUNCTION public.music_submit_pair(TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_submit_pair(TEXT,UUID,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.admit_crun_dispatch(p_job_id UUID,p_endpoint TEXT,p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.jobs%ROWTYPE;
BEGIN
 IF p_endpoint<>'crun:suno/music-generate' OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
  OR octet_length(p_payload::TEXT)>65536 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT * INTO j FROM public.jobs WHERE id=p_job_id FOR UPDATE;
 IF NOT FOUND OR j.state<>'DEBITED' OR j.provider_job_id IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','JOB_NOT_ADMISSIBLE'); END IF;
 INSERT INTO public.crun_dispatch(job_id,endpoint,payload) VALUES(p_job_id,p_endpoint,p_payload) ON CONFLICT(job_id) DO NOTHING;
 RETURN jsonb_build_object('ok',true,'job_id',p_job_id);
END $$;
REVOKE ALL ON FUNCTION public.admit_crun_dispatch(UUID,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admit_crun_dispatch(UUID,TEXT,JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_crun_dispatch(p_job_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.crun_dispatch%ROWTYPE; v_open BOOLEAN;
BEGIN
 PERFORM 1 FROM public.jobs j WHERE j.id=p_job_id AND j.state='DEBITED' AND j.provider_job_id IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO d FROM public.crun_dispatch WHERE job_id=p_job_id FOR UPDATE;
 IF NOT FOUND OR d.state<>'READY' OR (d.retry_at IS NOT NULL AND d.retry_at>statement_timestamp()) THEN RETURN NULL; END IF;
 SELECT NOT admission_open INTO v_open FROM public.provider_spend_provider_policy WHERE provider='crun';
 IF COALESCE(v_open,true) OR EXISTS(SELECT 1 FROM public.model_routes r WHERE r.supplier='crun' AND r.endpoint=d.endpoint
    AND r.breaker_opened_at IS NOT NULL) OR EXISTS(SELECT 1 FROM public.crun_suno_model_breakers b
    WHERE b.endpoint=d.endpoint AND b.is_open AND b.suno_model=COALESCE(d.payload->'input'->>'suno_model','v6')) THEN
   RETURN jsonb_build_object('held',true,'code','CRUN_UNAVAILABLE');
 END IF;
 UPDATE public.crun_dispatch SET state='STARTED',attempt_token=gen_random_uuid(),started_at=statement_timestamp(),
   retry_at=NULL,failure_code=NULL WHERE job_id=p_job_id RETURNING * INTO d;
 RETURN jsonb_build_object('job_id',d.job_id,'attempt_token',d.attempt_token,'endpoint',d.endpoint,'payload',d.payload);
END $$;
REVOKE ALL ON FUNCTION public.claim_crun_dispatch(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_crun_dispatch(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_crun_dispatch()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_job UUID;
BEGIN
 SELECT j.id INTO v_job FROM public.jobs j JOIN public.crun_dispatch d ON d.job_id=j.id
 WHERE j.state='DEBITED' AND j.provider_job_id IS NULL AND d.state='READY'
  AND (d.retry_at IS NULL OR d.retry_at<=statement_timestamp())
  AND NOT EXISTS(SELECT 1 FROM public.crun_suno_model_breakers b WHERE b.endpoint=d.endpoint AND b.is_open
    AND b.suno_model=COALESCE(d.payload->'input'->>'suno_model','v6'))
 ORDER BY d.created_at,d.job_id LIMIT 1 FOR UPDATE OF j SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN public.claim_crun_dispatch(v_job);
END $$;
REVOKE ALL ON FUNCTION public.claim_crun_dispatch() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_crun_dispatch() TO service_role;

CREATE OR REPLACE FUNCTION public.record_crun_dispatch(
 p_job_id UUID,p_attempt_token UUID,p_outcome TEXT,p_provider_job_id TEXT DEFAULT NULL,
 p_failure_code TEXT DEFAULT NULL,p_retry_after_seconds INTEGER DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.crun_dispatch%ROWTYPE;
BEGIN
 IF p_outcome NOT IN ('ACCEPTED','REJECTED','UNKNOWN','DEFERRED','READY')
 OR p_attempt_token IS NULL OR (p_failure_code IS NOT NULL AND p_failure_code !~ '^[a-z0-9_]{1,64}$')
 OR (p_outcome='ACCEPTED' AND (p_provider_job_id IS NULL OR p_provider_job_id !~ '^[A-Za-z0-9._-]{1,128}$'))
 OR (p_outcome<>'ACCEPTED' AND p_provider_job_id IS NOT NULL)
 OR (p_outcome='DEFERRED' AND COALESCE(p_retry_after_seconds,0) NOT BETWEEN 1 AND 600)
 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_OUTCOME'); END IF;
 PERFORM 1 FROM public.jobs WHERE id=p_job_id FOR UPDATE;
 SELECT * INTO d FROM public.crun_dispatch WHERE job_id=p_job_id FOR UPDATE;
 IF d.state=p_outcome AND d.provider_job_id IS NOT DISTINCT FROM p_provider_job_id THEN
  RETURN jsonb_build_object('ok',true,'idempotent',true); END IF;
 IF NOT FOUND OR d.attempt_token IS DISTINCT FROM p_attempt_token THEN
  RETURN jsonb_build_object('ok',false,'code','ATTEMPT_MISMATCH'); END IF;
 -- A stale STARTED becomes UNKNOWN exactly once. UNKNOWN is operator-fenced
 -- and may only leave through reconcile_crun_dispatch_unknown.
 IF d.state NOT IN ('STARTED','UNKNOWN') OR (d.state='UNKNOWN' AND p_outcome<>'ACCEPTED') THEN
  RETURN jsonb_build_object('ok',false,'code','OUTCOME_CONFLICT'); END IF;
 IF p_outcome='DEFERRED' THEN
  UPDATE public.crun_dispatch SET state='DEFERRED',attempt_token=NULL,attempt_count=attempt_count+1,
   retry_at=statement_timestamp()+make_interval(secs=>p_retry_after_seconds),failure_code=COALESCE(p_failure_code,'provider_rate_limited'),
   resolved_at=statement_timestamp() WHERE job_id=p_job_id;
 ELSIF p_outcome='READY' THEN
  UPDATE public.crun_dispatch SET state='READY',attempt_token=NULL,retry_at=NULL,failure_code=p_failure_code,
   resolved_at=statement_timestamp() WHERE job_id=p_job_id;
 ELSE
  UPDATE public.crun_dispatch SET state=p_outcome,provider_job_id=p_provider_job_id,failure_code=p_failure_code,
   resolved_at=statement_timestamp(),recovery_checked_at=NULL WHERE job_id=p_job_id;
 END IF;
 IF p_outcome='UNKNOWN' THEN UPDATE public.jobs SET error_code='provider_outcome_unknown',updated_at=statement_timestamp()
  WHERE id=p_job_id AND state='DEBITED' AND provider_job_id IS NULL; END IF;
 RETURN jsonb_build_object('ok',true,'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.record_crun_dispatch(UUID,UUID,TEXT,TEXT,TEXT,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_crun_dispatch(UUID,UUID,TEXT,TEXT,TEXT,INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.recover_crun_dispatch(p_limit INTEGER DEFAULT 25)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v RECORD; dd public.crun_dispatch%ROWTYPE; jj public.jobs%ROWTYPE; r JSONB;
 processed INTEGER:=0; failed INTEGER:=0; transitioned BIGINT:=0; terminal_code TEXT;
BEGIN
 FOR v IN SELECT j.id,j.user_id,j.credits,j.state AS job_state,j.provider_job_id AS job_handle,
   d.state,d.provider_job_id,d.attempt_count,d.created_at,d.started_at,d.failure_code
  FROM public.jobs j JOIN public.crun_dispatch d ON d.job_id=j.id
  WHERE (d.recovery_checked_at IS NULL OR d.recovery_checked_at<statement_timestamp()-interval '30 seconds')
   AND ((d.state='STARTED' AND d.started_at<statement_timestamp()-interval '2 minutes')
    OR (d.state='ACCEPTED' AND d.projected_at IS NULL) OR d.state='REJECTED'
    OR (d.state='DEFERRED' AND (d.retry_at<=statement_timestamp() OR d.attempt_count>=5 OR d.created_at<statement_timestamp()-interval '20 minutes'))
    OR (d.state='READY' AND d.created_at<statement_timestamp()-interval '20 minutes'))
  ORDER BY COALESCE(d.recovery_checked_at,d.created_at),d.job_id LIMIT GREATEST(1,LEAST(COALESCE(p_limit,25),100))
  FOR UPDATE OF j SKIP LOCKED
 LOOP
  SELECT * INTO dd FROM public.crun_dispatch WHERE job_id=v.id FOR UPDATE;
  SELECT * INTO jj FROM public.jobs WHERE id=v.id;
  BEGIN
   transitioned:=0;
   IF dd.state='STARTED' AND dd.started_at<statement_timestamp()-interval '2 minutes' THEN
    UPDATE public.crun_dispatch SET state='UNKNOWN',resolved_at=statement_timestamp(),failure_code='provider_outcome_unknown'
     WHERE job_id=v.id AND state='STARTED' AND started_at<statement_timestamp()-interval '2 minutes';
    UPDATE public.jobs SET error_code='provider_outcome_unknown',updated_at=statement_timestamp()
     WHERE id=v.id AND state='DEBITED' AND provider_job_id IS NULL;
   ELSIF dd.state='ACCEPTED' THEN
    IF jj.state='DEBITED' AND jj.provider_job_id IS NULL THEN
     r:=public.job_submitted(v.id,'crun',dd.provider_job_id);
     IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'crun projection refused'; END IF;
     UPDATE public.jobs SET error_code=NULL WHERE id=v.id AND error_code='provider_outcome_unknown';
    ELSIF jj.provider_job_id IS NOT NULL AND jj.provider_job_id IS DISTINCT FROM dd.provider_job_id THEN
     RAISE EXCEPTION 'crun handle conflict';
    END IF;
    UPDATE public.crun_dispatch SET projected_at=statement_timestamp(),last_authoritative_status='pending' WHERE job_id=v.id;
   ELSIF dd.state='DEFERRED' AND dd.retry_at<=statement_timestamp() AND dd.attempt_count<5
     AND dd.created_at>=statement_timestamp()-interval '20 minutes' THEN
    UPDATE public.crun_dispatch SET state='READY',retry_at=NULL,recovery_checked_at=statement_timestamp() WHERE job_id=v.id;
   ELSIF (dd.state='DEFERRED' AND (dd.attempt_count>=5 OR dd.created_at<statement_timestamp()-interval '20 minutes'))
      OR (dd.state='READY' AND dd.created_at<statement_timestamp()-interval '20 minutes') THEN
    terminal_code:=CASE WHEN dd.state='DEFERRED' THEN 'supplier_busy' ELSE 'supplier_unavailable' END;
    UPDATE public.crun_dispatch SET state='REJECTED',failure_code=terminal_code,resolved_at=statement_timestamp()
     WHERE job_id=v.id AND state=dd.state;
    GET DIAGNOSTICS transitioned=ROW_COUNT;
    IF transitioned=1 AND jj.state='DEBITED' THEN
     UPDATE public.jobs SET error_code=terminal_code,updated_at=statement_timestamp() WHERE id=v.id AND state='DEBITED';
     r:=public.ledger_refund(v.id,jj.user_id,jj.credits,'refund:crun_submit_rejected');
     IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'crun refund refused'; END IF;
     UPDATE public.crun_dispatch SET state='CLOSED',projected_at=statement_timestamp() WHERE job_id=v.id AND state='REJECTED';
    END IF;
   ELSIF dd.state='REJECTED' THEN
    terminal_code:=COALESCE(dd.failure_code,'provider_submit_failed');
    IF jj.state='DEBITED' THEN
     UPDATE public.jobs SET error_code=terminal_code,updated_at=statement_timestamp() WHERE id=v.id AND state='DEBITED';
     r:=public.ledger_refund(v.id,jj.user_id,jj.credits,'refund:crun_submit_rejected');
     IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'crun refund refused'; END IF;
    END IF;
    UPDATE public.crun_dispatch SET state='CLOSED',projected_at=statement_timestamp() WHERE job_id=v.id AND state='REJECTED';
   END IF;
  EXCEPTION WHEN OTHERS THEN failed:=failed+1; END;
  UPDATE public.crun_dispatch SET recovery_checked_at=statement_timestamp() WHERE job_id=v.id;
  processed:=processed+1;
 END LOOP;
 RETURN jsonb_build_object('ok',failed=0,'processed',processed,'failed',failed);
END $$;
REVOKE ALL ON FUNCTION public.recover_crun_dispatch(INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recover_crun_dispatch(INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_crun_dispatch_unknown(
 p_job_id UUID,p_attempt_token UUID,p_outcome TEXT,p_provider_job_id TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.jobs%ROWTYPE; d public.crun_dispatch%ROWTYPE; r JSONB;
BEGIN
 IF p_outcome NOT IN ('ACCEPTED','REJECTED') OR p_attempt_token IS NULL
 OR (p_outcome='ACCEPTED' AND (p_provider_job_id IS NULL OR p_provider_job_id !~ '^[A-Za-z0-9._-]{1,128}$'))
 OR (p_outcome='REJECTED' AND p_provider_job_id IS NOT NULL)
 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_OUTCOME'); END IF;
 SELECT * INTO j FROM public.jobs WHERE id=p_job_id FOR UPDATE;
 SELECT * INTO d FROM public.crun_dispatch WHERE job_id=p_job_id FOR UPDATE;
 IF NOT FOUND OR d.attempt_token IS DISTINCT FROM p_attempt_token THEN
  RETURN jsonb_build_object('ok',false,'code','ATTEMPT_MISMATCH'); END IF;
 IF d.state='ACCEPTED' AND p_outcome='ACCEPTED' AND d.provider_job_id=p_provider_job_id THEN
  RETURN jsonb_build_object('ok',true,'idempotent',true); END IF;
 IF d.state='CLOSED' AND p_outcome='REJECTED' AND d.provider_job_id IS NULL
  AND d.failure_code='provider_submit_failed' THEN RETURN jsonb_build_object('ok',true,'idempotent',true); END IF;
 IF d.state<>'UNKNOWN' OR j.state<>'DEBITED' OR j.provider_job_id IS NOT NULL THEN
  RETURN jsonb_build_object('ok',false,'code','JOB_NOT_RECONCILABLE'); END IF;
 IF p_outcome='REJECTED' AND d.resolved_at>statement_timestamp()-interval '10 minutes' THEN
  RETURN jsonb_build_object('ok',false,'code','UNKNOWN_TOO_YOUNG'); END IF;
 IF p_outcome='ACCEPTED' THEN
  UPDATE public.crun_dispatch SET state='ACCEPTED',provider_job_id=p_provider_job_id,resolved_at=statement_timestamp() WHERE job_id=p_job_id;
  r:=public.job_submitted(p_job_id,'crun',p_provider_job_id);
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'crun reconcile projection refused'; END IF;
  UPDATE public.jobs SET error_code=NULL WHERE id=p_job_id;
  UPDATE public.crun_dispatch SET projected_at=statement_timestamp(),last_authoritative_status='pending' WHERE job_id=p_job_id;
 ELSE
  UPDATE public.jobs SET error_code='provider_submit_failed',updated_at=statement_timestamp() WHERE id=p_job_id;
  r:=public.ledger_refund(p_job_id,j.user_id,j.credits,'refund:crun_unknown_reconciled');
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'crun reconcile refund refused'; END IF;
  UPDATE public.crun_dispatch SET state='CLOSED',failure_code='provider_submit_failed',resolved_at=statement_timestamp(),projected_at=statement_timestamp()
   WHERE job_id=p_job_id;
 END IF;
 RETURN jsonb_build_object('ok',true,'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.reconcile_crun_dispatch_unknown(UUID,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_crun_dispatch_unknown(UUID,UUID,TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.record_crun_task_failure(p_job_id UUID,p_provider_job_id TEXT,p_error_code TEXT DEFAULT 'provider_task_failed')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.jobs%ROWTYPE; d public.crun_dispatch%ROWTYPE; r JSONB;
BEGIN
 IF p_error_code !~ '^[a-z0-9_]{1,64}$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT * INTO j FROM public.jobs WHERE id=p_job_id FOR UPDATE;
 SELECT * INTO d FROM public.crun_dispatch WHERE job_id=p_job_id FOR UPDATE;
 IF NOT FOUND OR d.provider_job_id IS DISTINCT FROM p_provider_job_id
  OR j.provider IS DISTINCT FROM 'crun' OR j.provider_job_id IS DISTINCT FROM p_provider_job_id THEN
  RETURN jsonb_build_object('ok',false,'code','JOB_NOT_FAILABLE'); END IF;
 IF d.state='CLOSED' AND j.state='REFUNDED' THEN RETURN jsonb_build_object('ok',true,'idempotent',true); END IF;
 IF d.state<>'ACCEPTED' THEN RETURN jsonb_build_object('ok',false,'code','JOB_NOT_FAILABLE'); END IF;
 IF j.state NOT IN ('SUBMITTED','FAILOVER') THEN RETURN jsonb_build_object('ok',false,'code','JOB_NOT_FAILABLE'); END IF;
 UPDATE public.jobs SET state='FAILED',error_code=p_error_code,updated_at=statement_timestamp() WHERE id=p_job_id;
 r:=public.ledger_refund(p_job_id,j.user_id,j.credits,'refund:crun_task_failed');
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'crun task refund refused'; END IF;
 UPDATE public.crun_dispatch SET state='CLOSED',failure_code=p_error_code,last_authoritative_status='failed',
  resolved_at=statement_timestamp(),projected_at=statement_timestamp() WHERE job_id=p_job_id;
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.record_crun_task_failure(UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_crun_task_failure(UUID,TEXT,TEXT) TO service_role;

-- Terminal job states close ACCEPTED dispatches. FAILED is deliberately
-- included so the existing unpaid-failure sweep can repair a failed refund;
-- SUCCEEDED remains live until storage succeeds or the bounded asset recovery
-- path below records an authoritative terminal.
CREATE OR REPLACE FUNCTION private.close_crun_dispatch_on_terminal_job()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.state IN ('STORED','FAILED','REFUNDED') AND OLD.state IS DISTINCT FROM NEW.state THEN
  UPDATE public.crun_dispatch SET state='CLOSED',resolved_at=statement_timestamp(),
   projected_at=COALESCE(projected_at,statement_timestamp())
   WHERE job_id=NEW.id AND state='ACCEPTED';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.close_crun_dispatch_on_terminal_job() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS jobs_close_crun_dispatch_terminal ON public.jobs;
CREATE TRIGGER jobs_close_crun_dispatch_terminal AFTER UPDATE OF state ON public.jobs
 FOR EACH ROW EXECUTE FUNCTION private.close_crun_dispatch_on_terminal_job();

CREATE OR REPLACE FUNCTION public.record_crun_asset_failure(p_job_id UUID,p_provider_job_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.jobs%ROWTYPE; d public.crun_dispatch%ROWTYPE; r JSONB;
BEGIN
 SELECT * INTO j FROM public.jobs WHERE id=p_job_id FOR UPDATE;
 SELECT * INTO d FROM public.crun_dispatch WHERE job_id=p_job_id FOR UPDATE;
 IF d.state='CLOSED' AND j.state='REFUNDED' AND d.failure_code='asset_store_failed' THEN
  RETURN jsonb_build_object('ok',true,'idempotent',true); END IF;
 IF NOT FOUND OR d.state<>'ACCEPTED' OR d.provider_job_id IS DISTINCT FROM p_provider_job_id
  OR j.state<>'SUCCEEDED' OR j.provider_job_id IS DISTINCT FROM p_provider_job_id THEN
  RETURN jsonb_build_object('ok',false,'code','JOB_NOT_FAILABLE'); END IF;
 UPDATE public.jobs SET state='FAILED',error_code='asset_store_failed',updated_at=statement_timestamp() WHERE id=p_job_id;
 r:=public.ledger_refund(p_job_id,j.user_id,j.credits,'refund:crun_asset_store_failed');
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'crun asset refund refused'; END IF;
 UPDATE public.crun_dispatch SET state='CLOSED',failure_code='asset_store_failed',last_authoritative_status='success',
  resolved_at=statement_timestamp(),projected_at=statement_timestamp() WHERE job_id=p_job_id;
 RETURN r||jsonb_build_object('idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.record_crun_asset_failure(UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_crun_asset_failure(UUID,TEXT) TO service_role;

-- Every nonterminal Crun dispatch is held across every generic sweep branch,
-- including projected ACCEPTED rows and the 120-minute submitted timeout.
CREATE OR REPLACE FUNCTION public.sweep_stuck_jobs(
 p_debited_minutes INTEGER DEFAULT 15,p_submitted_minutes INTEGER DEFAULT 120,
 p_limit INTEGER DEFAULT 200,p_succeeded_minutes INTEGER DEFAULT 60
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_job RECORD; v_refunded INTEGER:=0; v_failed INTEGER:=0; v_unstored INTEGER:=0; v_unpaid INTEGER:=0; v_res JSONB;
BEGIN
 FOR v_job IN SELECT j.id,j.user_id,j.credits,j.state FROM public.jobs j
  WHERE j.inputs->>'kind' IS DISTINCT FROM 'speech_analysis'
   AND NOT EXISTS(SELECT 1 FROM public.crun_dispatch d WHERE d.job_id=j.id
    AND d.state IN ('READY','STARTED','ACCEPTED','UNKNOWN','DEFERRED'))
   AND ((j.state='DEBITED' AND j.updated_at<now()-make_interval(mins=>p_debited_minutes)
      AND NOT(j.error_code IS NOT DISTINCT FROM 'provider_outcome_unknown' AND EXISTS(
       SELECT 1 FROM public.provider_spend_reservations r WHERE r.user_id=j.user_id
        AND (r.effect_key=j.idempotency_key OR starts_with(r.effect_key,j.idempotency_key||':a')))))
    OR (j.state IN ('SUBMITTED','FAILOVER') AND j.updated_at<now()-make_interval(mins=>p_submitted_minutes))
    OR (j.state='SUCCEEDED' AND j.updated_at<now()-make_interval(mins=>p_succeeded_minutes)
      AND NOT EXISTS(SELECT 1 FROM public.assets a WHERE a.job_id=j.id))
    OR (j.state='FAILED' AND j.credits>0 AND j.updated_at<now()-make_interval(mins=>p_debited_minutes)
      AND NOT EXISTS(SELECT 1 FROM public.ledger_entries le WHERE le.job_id=j.id AND le.delta>0)))
  ORDER BY j.updated_at LIMIT p_limit FOR UPDATE OF j SKIP LOCKED
 LOOP
  IF v_job.state IN ('SUBMITTED','FAILOVER') THEN UPDATE public.jobs SET state='FAILED',error_code='stuck_timeout',updated_at=now() WHERE id=v_job.id; v_failed:=v_failed+1;
  ELSIF v_job.state='SUCCEEDED' THEN UPDATE public.jobs SET state='FAILED',error_code='asset_store_failed',updated_at=now() WHERE id=v_job.id; v_unstored:=v_unstored+1;
  ELSIF v_job.state='FAILED' THEN v_unpaid:=v_unpaid+1; END IF;
  v_res:=public.ledger_refund(v_job.id,v_job.user_id,v_job.credits,CASE v_job.state
   WHEN 'DEBITED' THEN 'refund:stuck_debited' WHEN 'SUCCEEDED' THEN 'refund:asset_store_failed'
   WHEN 'FAILED' THEN 'refund:failed_unpaid' ELSE 'refund:stuck_submitted' END);
  IF (v_res->>'ok')::BOOLEAN AND NOT COALESCE((v_res->>'idempotent')::BOOLEAN,false) THEN v_refunded:=v_refunded+1; END IF;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'failed',v_failed,'unstored',v_unstored,'unpaid_failures',v_unpaid,'refunded',v_refunded);
END $$;
REVOKE ALL ON FUNCTION public.sweep_stuck_jobs(INTEGER,INTEGER,INTEGER,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_stuck_jobs(INTEGER,INTEGER,INTEGER,INTEGER) TO service_role;

COMMIT;
