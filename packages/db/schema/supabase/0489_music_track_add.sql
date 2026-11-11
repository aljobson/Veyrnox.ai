-- Add a separate vocal or instrumental part to an existing song through
-- Mureka v8. The provider contract is deliberately two-stage: first upload
-- the owner-resolved MP3 ($0.01), then generate exactly one matching track
-- ($0.09). The result is a private standalone part, never an implicit mix.
-- Both catalog rows remain inactive until a billed acceptance run succeeds.

INSERT INTO public.model_catalog
  (id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,
   cost_unit,billing_seconds,gated_flag,active)
VALUES
  ('mureka-audio-upload','Mureka Audio Upload','fal','mureka/api/files/upload',
   'audio-to-audio',1,0.0100,'per_generation',NULL,false,false),
  ('mureka-track-add-v8','Mureka v8 Matching Track','fal','mureka/v8/generate/track',
   'audio-to-audio',6,0.0900,'per_generation',NULL,false,false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.music_track_add_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  song_id UUID NOT NULL,
  source_version_id UUID NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('vocals','instrumental')),
  prompt TEXT NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 500),
  lyrics TEXT,
  vocal_gender TEXT NOT NULL CHECK (vocal_gender IN ('auto','female','male')),
  source_duration_seconds NUMERIC(9,3) NOT NULL CHECK (source_duration_seconds>0 AND source_duration_seconds<=120),
  source_size_bytes BIGINT NOT NULL CHECK (source_size_bytes>0 AND source_size_bytes<=10485760),
  upload_model_id TEXT NOT NULL REFERENCES public.model_catalog(id) ON DELETE RESTRICT,
  upload_endpoint TEXT NOT NULL CHECK (upload_endpoint='mureka/api/files/upload'),
  upload_credits INTEGER NOT NULL CHECK (upload_credits=1),
  upload_catalog_updated_at TIMESTAMPTZ NOT NULL,
  track_model_id TEXT NOT NULL REFERENCES public.model_catalog(id) ON DELETE RESTRICT,
  track_endpoint TEXT NOT NULL CHECK (track_endpoint='mureka/v8/generate/track'),
  track_credits INTEGER NOT NULL CHECK (track_credits=6),
  track_catalog_updated_at TIMESTAMPTZ NOT NULL,
  source_rights_version TEXT NOT NULL CHECK (source_rights_version='music-track-add-source-rights-v1'),
  lyrics_rights_version TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at>created_at),
  CHECK ((mode='vocals' AND lyrics IS NOT NULL AND char_length(lyrics) BETWEEN 1 AND 3000
      AND lyrics_rights_version='music-track-add-lyrics-rights-v1')
    OR (mode='instrumental' AND lyrics IS NULL AND lyrics_rights_version IS NULL AND vocal_gender='auto')),
  CONSTRAINT music_track_add_quotes_song_owner_fk FOREIGN KEY(song_id,user_id)
    REFERENCES public.music_songs(id,user_id) ON DELETE RESTRICT,
  CONSTRAINT music_track_add_quotes_version_owner_fk FOREIGN KEY(source_version_id,user_id,song_id)
    REFERENCES public.music_song_versions(id,user_id,song_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.music_track_add_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  quote_id UUID NOT NULL UNIQUE REFERENCES public.music_track_add_quotes(id) ON DELETE RESTRICT,
  song_id UUID NOT NULL,
  source_version_id UUID NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('vocals','instrumental')),
  upload_job_id UUID NOT NULL UNIQUE REFERENCES public.jobs(id) ON DELETE RESTRICT,
  track_job_id UUID NOT NULL UNIQUE REFERENCES public.jobs(id) ON DELETE RESTRICT,
  upload_model_id TEXT NOT NULL REFERENCES public.model_catalog(id) ON DELETE RESTRICT,
  track_model_id TEXT NOT NULL REFERENCES public.model_catalog(id) ON DELETE RESTRICT,
  upload_credits INTEGER NOT NULL CHECK (upload_credits=1),
  track_credits INTEGER NOT NULL CHECK (track_credits=6),
  idempotency_key TEXT NOT NULL CHECK (idempotency_key~'^[A-Za-z0-9._-]{8,120}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id,idempotency_key),
  CHECK (upload_job_id<>track_job_id),
  CONSTRAINT music_track_add_requests_song_owner_fk FOREIGN KEY(song_id,user_id)
    REFERENCES public.music_songs(id,user_id) ON DELETE RESTRICT,
  CONSTRAINT music_track_add_requests_version_owner_fk FOREIGN KEY(source_version_id,user_id,song_id)
    REFERENCES public.music_song_versions(id,user_id,song_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS music_track_add_quotes_user_created_idx
  ON public.music_track_add_quotes(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS music_track_add_requests_user_created_idx
  ON public.music_track_add_requests(user_id,created_at DESC);

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['music_track_add_quotes','music_track_add_requests'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',t||'_owner_read',t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (private.music_owns_user(user_id))',t||'_owner_read',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.%I TO service_role',t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.music_get_track_add_source_context(
  p_auth_id TEXT,p_song_id UUID,p_version_id UUID
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_row JSONB;
BEGIN
  SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  SELECT jsonb_build_object('ok',true,'r2_key',a.r2_key,'mime_type',a.mime_type,'size_bytes',a.size_bytes)
  INTO v_row FROM public.music_songs s
  JOIN public.music_song_versions v ON v.id=p_version_id AND v.user_id=v_user AND v.song_id=s.id
  JOIN public.assets a ON a.id=v.audio_asset_id
  WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active'
    AND s.current_version_id=p_version_id AND a.mime_type='audio/mpeg' AND a.size_bytes<=10485760;
  RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','FORMAT_UNAVAILABLE'));
END $$;

CREATE OR REPLACE FUNCTION public.music_create_track_add_quote(
  p_auth_id TEXT,p_song_id UUID,p_version_id UUID,p_mode TEXT,p_prompt TEXT,p_lyrics TEXT,p_vocal_gender TEXT,
  p_rights_confirmed BOOLEAN,p_lyrics_rights_confirmed BOOLEAN,
  p_source_duration_seconds NUMERIC,p_source_size_bytes BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_upload public.model_catalog%ROWTYPE; v_track public.model_catalog%ROWTYPE;
 v_quote public.music_track_add_quotes%ROWTYPE; v_balance INTEGER;
BEGIN
  p_prompt:=btrim(COALESCE(p_prompt,'')); p_lyrics:=NULLIF(btrim(COALESCE(p_lyrics,'')),'');
  IF p_song_id IS NULL OR p_version_id IS NULL OR p_mode NOT IN ('vocals','instrumental')
    OR char_length(p_prompt) NOT BETWEEN 1 AND 500 OR p_vocal_gender NOT IN ('auto','female','male')
    OR p_rights_confirmed IS DISTINCT FROM true
    OR p_source_duration_seconds NOT BETWEEN 0.001 AND 120 OR p_source_size_bytes NOT BETWEEN 1 AND 10485760
    OR (p_mode='vocals' AND (p_lyrics IS NULL OR char_length(p_lyrics)>3000 OR p_lyrics_rights_confirmed IS DISTINCT FROM true))
    OR (p_mode='instrumental' AND (p_lyrics IS NOT NULL OR p_vocal_gender<>'auto' OR p_lyrics_rights_confirmed IS DISTINCT FROM false)) THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
  SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
  IF NOT private.music_paid_plan_active(v_user) THEN RETURN jsonb_build_object('ok',false,'code','PLAN_UNAVAILABLE'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.music_songs s
    JOIN public.music_song_versions v ON v.id=p_version_id AND v.user_id=v_user AND v.song_id=s.id
    JOIN public.assets a ON a.id=v.audio_asset_id
    WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active' AND s.current_version_id=p_version_id
      AND a.mime_type='audio/mpeg' AND a.size_bytes<=10485760 FOR SHARE OF s,v,a) THEN
    RETURN jsonb_build_object('ok',false,'code','FORMAT_UNAVAILABLE'); END IF;
  IF (SELECT count(*) FROM public.music_track_add_quotes WHERE user_id=v_user AND created_at>now()-interval '60 seconds')>=10 THEN
    RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED','retry_after_seconds',60); END IF;
  SELECT * INTO v_upload FROM public.model_catalog WHERE id='mureka-audio-upload';
  SELECT * INTO v_track FROM public.model_catalog WHERE id='mureka-track-add-v8';
  IF v_upload.id IS NULL OR NOT v_upload.active OR v_upload.gated_flag OR v_upload.provider<>'fal'
    OR v_upload.provider_endpoint<>'mureka/api/files/upload' OR v_upload.modality<>'audio-to-audio'
    OR v_upload.credits_5s<>1 OR v_upload.provider_cost_per_unit<>0.0100::numeric
    OR v_upload.cost_unit<>'per_generation' OR v_upload.billing_seconds IS NOT NULL
    OR v_track.id IS NULL OR NOT v_track.active OR v_track.gated_flag OR v_track.provider<>'fal'
    OR v_track.provider_endpoint<>'mureka/v8/generate/track' OR v_track.modality<>'audio-to-audio'
    OR v_track.credits_5s<>6 OR v_track.provider_cost_per_unit<>0.0900::numeric
    OR v_track.cost_unit<>'per_generation' OR v_track.billing_seconds IS NOT NULL THEN
    RETURN jsonb_build_object('ok',false,'code','MODEL_UNAVAILABLE'); END IF;
  SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END
    INTO v_balance FROM public.credit_balances WHERE user_id=v_user;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NO_BALANCE_ROW'); END IF;
  INSERT INTO public.music_track_add_quotes(user_id,song_id,source_version_id,mode,prompt,lyrics,vocal_gender,
    source_duration_seconds,source_size_bytes,upload_model_id,upload_endpoint,upload_credits,
    upload_catalog_updated_at,track_model_id,track_endpoint,track_credits,track_catalog_updated_at,
    source_rights_version,lyrics_rights_version,expires_at)
  VALUES(v_user,p_song_id,p_version_id,p_mode,p_prompt,CASE WHEN p_mode='vocals' THEN p_lyrics END,p_vocal_gender,
    p_source_duration_seconds,p_source_size_bytes,v_upload.id,v_upload.provider_endpoint,1,v_upload.updated_at,
    v_track.id,v_track.provider_endpoint,6,v_track.updated_at,'music-track-add-source-rights-v1',
    CASE WHEN p_mode='vocals' THEN 'music-track-add-lyrics-rights-v1' END,now()+interval '5 minutes')
  RETURNING * INTO v_quote;
  RETURN jsonb_build_object('ok',true,'quote_id',v_quote.id,'mode',v_quote.mode,
    'source_duration_seconds',v_quote.source_duration_seconds,'upload_credits',1,'track_credits',6,
    'total_credits',7,'balance',v_balance,'balance_after',v_balance-7,'affordable',v_balance>=7,
    'expires_at',v_quote.expires_at);
END $$;

CREATE OR REPLACE FUNCTION public.music_get_track_add_dispatch_context(
  p_auth_id TEXT,p_song_id UUID,p_quote_id UUID,p_idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_existing public.music_track_add_requests%ROWTYPE;
 v_quote public.music_track_add_quotes%ROWTYPE; v_upload public.jobs%ROWTYPE; v_track public.jobs%ROWTYPE; v_row JSONB;
BEGIN
  IF p_idempotency_key!~'^[A-Za-z0-9._-]{8,120}$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
  SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  SELECT * INTO v_existing FROM public.music_track_add_requests WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.quote_id IS DISTINCT FROM p_quote_id THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
    SELECT * INTO v_upload FROM public.jobs WHERE id=v_existing.upload_job_id;
    SELECT * INTO v_track FROM public.jobs WHERE id=v_existing.track_job_id;
    RETURN jsonb_build_object('ok',true,'idempotent',true,'request_id',v_existing.id,
      'upload_job_id',v_existing.upload_job_id,'track_job_id',v_existing.track_job_id,
      'state',CASE WHEN v_track.state='STORED' THEN 'ready' WHEN v_upload.state='REFUNDED' OR v_track.state='REFUNDED' THEN 'refunded'
        WHEN v_upload.state='FAILED' OR v_track.state='FAILED' THEN 'failed'
        WHEN v_upload.state IN ('SUBMITTED','SUCCEEDED','STORED') OR v_track.state IN ('SUBMITTED','SUCCEEDED') THEN 'running' ELSE 'queued' END);
  END IF;
  SELECT * INTO v_quote FROM public.music_track_add_quotes WHERE id=p_quote_id AND user_id=v_user AND song_id=p_song_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  SELECT jsonb_build_object('ok',true,'idempotent',false,'r2_key',a.r2_key,'mime_type',a.mime_type,
    'source_duration_seconds',v_quote.source_duration_seconds,'source_size_bytes',v_quote.source_size_bytes)
  INTO v_row FROM public.music_songs s JOIN public.music_song_versions v
    ON v.id=v_quote.source_version_id AND v.user_id=v_user AND v.song_id=s.id
  JOIN public.assets a ON a.id=v.audio_asset_id
  WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active' AND s.current_version_id=v_quote.source_version_id
    AND a.mime_type='audio/mpeg' AND a.size_bytes=v_quote.source_size_bytes;
  RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','REVISION_CONFLICT'));
END $$;

CREATE OR REPLACE FUNCTION public.music_submit_track_add_request(
  p_auth_id TEXT,p_song_id UUID,p_quote_id UUID,p_idempotency_key TEXT,p_source_audio_url TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_balance INTEGER; v_active INTEGER; v_recent INTEGER;
 v_quote public.music_track_add_quotes%ROWTYPE; v_upload_model public.model_catalog%ROWTYPE; v_track_model public.model_catalog%ROWTYPE;
 v_existing public.music_track_add_requests%ROWTYPE; v_request public.music_track_add_requests%ROWTYPE;
 v_upload_debit JSONB; v_track_debit JSONB; v_upload_job UUID; v_track_job UUID;
BEGIN
  IF p_song_id IS NULL OR p_quote_id IS NULL OR p_idempotency_key!~'^[A-Za-z0-9._-]{8,120}$'
    OR p_source_audio_url IS NULL OR p_source_audio_url!~'^https://[^[:space:]]{1,2000}$' THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
  SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id FOR UPDATE;
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
  SELECT * INTO v_existing FROM public.music_track_add_requests WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.quote_id IS DISTINCT FROM p_quote_id THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
    SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance FROM public.credit_balances WHERE user_id=v_user;
    RETURN jsonb_build_object('ok',true,'request_id',v_existing.id,'upload_job_id',v_existing.upload_job_id,
      'track_job_id',v_existing.track_job_id,'state','queued','balance_after',v_balance,'idempotent',true);
  END IF;
  SELECT count(*) INTO v_active FROM public.music_track_add_requests r
    JOIN public.jobs u ON u.id=r.upload_job_id JOIN public.jobs t ON t.id=r.track_job_id
    WHERE r.user_id=v_user AND (u.state IN ('DEBITED','SUBMITTED','SUCCEEDED') OR t.state IN ('DEBITED','SUBMITTED','SUCCEEDED'));
  IF v_active>=2 THEN RETURN jsonb_build_object('ok',false,'code','CONCURRENCY_LIMIT'); END IF;
  SELECT count(*) INTO v_recent FROM public.jobs WHERE user_id=v_user AND created_at>now()-interval '60 seconds';
  IF v_recent>7 THEN RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED','retry_after_seconds',60); END IF;
  SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END
    INTO v_balance FROM public.credit_balances WHERE user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NO_BALANCE_ROW'); END IF;
  IF EXISTS(SELECT 1 FROM public.users WHERE id=v_user AND frozen_at IS NOT NULL) THEN RETURN jsonb_build_object('ok',false,'code','ACCOUNT_FROZEN'); END IF;
  SELECT * INTO v_quote FROM public.music_track_add_quotes WHERE id=p_quote_id AND user_id=v_user AND song_id=p_song_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  IF v_quote.consumed_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_ALREADY_USED'); END IF;
  IF v_quote.expires_at<=now() THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_EXPIRED'); END IF;
  IF NOT private.music_paid_plan_active(v_user) THEN RETURN jsonb_build_object('ok',false,'code','PLAN_UNAVAILABLE'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.music_songs WHERE id=p_song_id AND user_id=v_user
    AND status='active' AND current_version_id=v_quote.source_version_id FOR SHARE) THEN
    RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); END IF;
  SELECT * INTO v_upload_model FROM public.model_catalog WHERE id=v_quote.upload_model_id FOR SHARE;
  SELECT * INTO v_track_model FROM public.model_catalog WHERE id=v_quote.track_model_id FOR SHARE;
  IF v_upload_model.id IS NULL OR NOT v_upload_model.active OR v_upload_model.gated_flag
    OR v_upload_model.provider<>'fal' OR v_upload_model.provider_endpoint<>'mureka/api/files/upload'
    OR v_upload_model.credits_5s<>1 OR v_upload_model.provider_cost_per_unit<>0.0100::numeric
    OR v_upload_model.cost_unit<>'per_generation' OR v_upload_model.billing_seconds IS NOT NULL
    OR v_upload_model.updated_at IS DISTINCT FROM v_quote.upload_catalog_updated_at
    OR v_track_model.id IS NULL OR NOT v_track_model.active OR v_track_model.gated_flag
    OR v_track_model.provider<>'fal' OR v_track_model.provider_endpoint<>'mureka/v8/generate/track'
    OR v_track_model.credits_5s<>6 OR v_track_model.provider_cost_per_unit<>0.0900::numeric
    OR v_track_model.cost_unit<>'per_generation' OR v_track_model.billing_seconds IS NOT NULL
    OR v_track_model.updated_at IS DISTINCT FROM v_quote.track_catalog_updated_at
    OR v_quote.upload_credits<>1 OR v_quote.track_credits<>6 THEN
    RETURN jsonb_build_object('ok',false,'code','QUOTE_STALE'); END IF;
  IF v_balance<7 THEN RETURN jsonb_build_object('ok',false,'code','INSUFFICIENT_BALANCE'); END IF;
  BEGIN
    v_upload_debit:=public.ledger_debit(v_user,p_idempotency_key||'.upload',1,'debit:music_track_upload',
      v_upload_model.id,jsonb_build_object('music_track_add_quote_id',v_quote.id,'source_version_id',v_quote.source_version_id),0,120);
    IF v_upload_debit->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='track upload debit refused'; END IF;
    v_upload_job:=(v_upload_debit->>'job_id')::uuid;
    v_track_debit:=public.ledger_debit(v_user,p_idempotency_key||'.track',6,'debit:music_track_add',
      v_track_model.id,jsonb_build_object('music_track_add_quote_id',v_quote.id,'source_version_id',v_quote.source_version_id,'mode',v_quote.mode),0,120);
    IF v_track_debit->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='track generation debit refused'; END IF;
    v_track_job:=(v_track_debit->>'job_id')::uuid;
    INSERT INTO public.music_track_add_requests(user_id,quote_id,song_id,source_version_id,mode,
      upload_job_id,track_job_id,upload_model_id,track_model_id,upload_credits,track_credits,idempotency_key)
    VALUES(v_user,v_quote.id,p_song_id,v_quote.source_version_id,v_quote.mode,v_upload_job,v_track_job,
      v_upload_model.id,v_track_model.id,1,6,p_idempotency_key) RETURNING * INTO v_request;
    INSERT INTO public.fal_dispatch(job_id,endpoint,payload) VALUES(v_upload_job,v_quote.upload_endpoint,
      jsonb_build_object('file_url',p_source_audio_url,'purpose','audio'));
    UPDATE public.music_track_add_quotes SET consumed_at=now() WHERE id=v_quote.id;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    RETURN COALESCE(v_track_debit,v_upload_debit,jsonb_build_object('ok',false,'code','DEBIT_FAILED'));
  END;
  SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance FROM public.credit_balances WHERE user_id=v_user;
  RETURN jsonb_build_object('ok',true,'request_id',v_request.id,'upload_job_id',v_upload_job,
    'track_job_id',v_track_job,'state','queued','balance_after',v_balance,'idempotent',false);
END $$;

CREATE OR REPLACE FUNCTION public.music_advance_track_add_upload(
  p_provider_job_id TEXT,p_upload_audio_id TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_request public.music_track_add_requests%ROWTYPE; v_quote public.music_track_add_quotes%ROWTYPE;
 v_upload public.jobs%ROWTYPE; v_track public.jobs%ROWTYPE; v_payload JSONB;
BEGIN
  IF p_provider_job_id IS NULL OR p_upload_audio_id!~'^[A-Za-z0-9_-]{1,128}$' THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_OUTPUT'); END IF;
  SELECT r.* INTO v_request
  FROM public.music_track_add_requests r JOIN public.music_track_add_quotes q ON q.id=r.quote_id
  JOIN public.jobs u ON u.id=r.upload_job_id JOIN public.jobs t ON t.id=r.track_job_id
  WHERE u.provider='fal' AND u.provider_job_id=p_provider_job_id FOR UPDATE OF u,t;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','REQUEST_NOT_FOUND'); END IF;
  SELECT * INTO v_quote FROM public.music_track_add_quotes WHERE id=v_request.quote_id;
  SELECT * INTO v_upload FROM public.jobs WHERE id=v_request.upload_job_id;
  SELECT * INTO v_track FROM public.jobs WHERE id=v_request.track_job_id;
  IF v_request.upload_model_id<>'mureka-audio-upload' OR v_request.track_model_id<>'mureka-track-add-v8' THEN
    RETURN jsonb_build_object('ok',false,'code','MODEL_MISMATCH'); END IF;
  IF v_upload.state='STORED' AND EXISTS(SELECT 1 FROM public.fal_dispatch WHERE job_id=v_track.id) THEN
    RETURN jsonb_build_object('ok',true,'request_id',v_request.id,'track_job_id',v_track.id,'idempotent',true); END IF;
  IF v_upload.state<>'SUCCEEDED' OR v_track.state<>'DEBITED' THEN RETURN jsonb_build_object('ok',false,'code','BAD_STATE'); END IF;
  v_payload:=jsonb_build_object('upload_audio_id',p_upload_audio_id,
    'generate_type',CASE WHEN v_quote.mode='vocals' THEN 'Vocals' ELSE 'Instrumental' END,
    'prompt',v_quote.prompt,'enable_safety_checker',true);
  IF v_quote.mode='vocals' THEN v_payload:=v_payload||jsonb_build_object('lyrics',v_quote.lyrics); END IF;
  IF v_quote.mode='vocals' AND v_quote.vocal_gender<>'auto' THEN
    v_payload:=v_payload||jsonb_build_object('vocal_gender',v_quote.vocal_gender); END IF;
  INSERT INTO public.fal_dispatch(job_id,endpoint,payload) VALUES(v_track.id,v_quote.track_endpoint,v_payload);
  UPDATE public.jobs SET state='STORED',updated_at=now() WHERE id=v_upload.id AND state='SUCCEEDED';
  RETURN jsonb_build_object('ok',true,'request_id',v_request.id,'track_job_id',v_track.id,'idempotent',false);
END $$;

CREATE OR REPLACE FUNCTION public.music_fail_track_add_upload(
  p_provider_job_id TEXT,p_error_code TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_request public.music_track_add_requests%ROWTYPE; v_upload public.jobs%ROWTYPE; v_track public.jobs%ROWTYPE;
 v_upload_refund JSONB; v_track_refund JSONB;
BEGIN
  SELECT r.* INTO v_request FROM public.music_track_add_requests r
  JOIN public.jobs u ON u.id=r.upload_job_id JOIN public.jobs t ON t.id=r.track_job_id
  WHERE u.provider='fal' AND u.provider_job_id=p_provider_job_id FOR UPDATE OF u,t;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','REQUEST_NOT_FOUND'); END IF;
  SELECT * INTO v_upload FROM public.jobs WHERE id=v_request.upload_job_id;
  SELECT * INTO v_track FROM public.jobs WHERE id=v_request.track_job_id;
  IF v_request.upload_model_id<>'mureka-audio-upload' OR v_request.track_model_id<>'mureka-track-add-v8' THEN
    RETURN jsonb_build_object('ok',false,'code','MODEL_MISMATCH'); END IF;
  UPDATE public.jobs SET state='FAILED',error_code=left(COALESCE(p_error_code,'provider_error'),128),updated_at=now()
    WHERE id=v_upload.id AND state IN ('SUBMITTED','SUCCEEDED');
  UPDATE public.jobs SET state='FAILED',error_code='upstream_upload_failed',updated_at=now()
    WHERE id=v_track.id AND state='DEBITED';
  v_upload_refund:=public.ledger_refund(v_upload.id,v_request.user_id,v_request.upload_credits,'refund:music_track_upload_failed');
  v_track_refund:=public.ledger_refund(v_track.id,v_request.user_id,v_request.track_credits,'refund:music_track_upload_failed');
  IF v_upload_refund->>'ok' IS DISTINCT FROM 'true' OR v_track_refund->>'ok' IS DISTINCT FROM 'true' THEN
    RETURN jsonb_build_object('ok',false,'code','REFUND_FAILED','upload',v_upload_refund,'track',v_track_refund); END IF;
  RETURN jsonb_build_object('ok',true,'request_id',v_request.id,'upload_refund',v_upload_refund,'track_refund',v_track_refund);
END $$;

CREATE OR REPLACE FUNCTION public.music_get_track_add_request(p_auth_id TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_row JSONB;
BEGIN
  SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  SELECT jsonb_build_object('id',r.id,'song_id',r.song_id,'source_version_id',r.source_version_id,
    'mode',r.mode,'upload_job_id',r.upload_job_id,'track_job_id',r.track_job_id,
    'upload_credits',r.upload_credits,'track_credits',r.track_credits,'created_at',r.created_at,
    'state',CASE WHEN t.state='STORED' AND a.id IS NOT NULL THEN 'ready'
      WHEN u.state='REFUNDED' OR t.state='REFUNDED' THEN 'refunded'
      WHEN u.state='FAILED' OR t.state='FAILED' THEN 'failed'
      WHEN u.state IN ('SUBMITTED','SUCCEEDED','STORED') OR t.state IN ('SUBMITTED','SUCCEEDED') THEN 'running' ELSE 'queued' END,
    'stage',CASE WHEN u.state NOT IN ('STORED','REFUNDED') THEN 'source_upload'
      WHEN t.state='STORED' AND a.id IS NOT NULL THEN 'complete' ELSE 'part_generation' END)
  INTO v_row FROM public.music_track_add_requests r JOIN public.jobs u ON u.id=r.upload_job_id
  JOIN public.jobs t ON t.id=r.track_job_id LEFT JOIN public.assets a ON a.job_id=t.id
  WHERE r.id=p_request_id AND r.user_id=v_user;
  IF v_row IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok',true,'request',v_row);
END $$;

CREATE OR REPLACE FUNCTION public.music_get_track_add_asset_context(
  p_auth_id TEXT,p_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_row JSONB;
BEGIN
  SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
  SELECT jsonb_build_object('ok',true,'r2_key',a.r2_key,'mime_type',a.mime_type,
    'size_bytes',a.size_bytes,'song_id',r.song_id,'mode',r.mode)
  INTO v_row FROM public.music_track_add_requests r
  JOIN public.jobs j ON j.id=r.track_job_id AND j.state='STORED'
  JOIN public.assets a ON a.job_id=j.id
  WHERE r.id=p_request_id AND r.user_id=v_user AND a.mime_type IN ('audio/mpeg','audio/wav');
  RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','NOT_FOUND'));
END $$;

REVOKE ALL ON FUNCTION public.music_get_track_add_source_context(TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_create_track_add_quote(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,BOOLEAN,BOOLEAN,NUMERIC,BIGINT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_get_track_add_dispatch_context(TEXT,UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_submit_track_add_request(TEXT,UUID,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_advance_track_add_upload(TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_fail_track_add_upload(TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_get_track_add_request(TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_get_track_add_asset_context(TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_track_add_source_context(TEXT,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_create_track_add_quote(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,BOOLEAN,BOOLEAN,NUMERIC,BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_get_track_add_dispatch_context(TEXT,UUID,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_submit_track_add_request(TEXT,UUID,UUID,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_advance_track_add_upload(TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_fail_track_add_upload(TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_get_track_add_request(TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_get_track_add_asset_context(TEXT,UUID) TO service_role;
