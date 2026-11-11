-- Rights-bound target/residual separation through fal SAM Audio.
-- The provider bills $0.05 per started 30 seconds. The inactive catalog row
-- freezes the 120-second maximum ($0.20); quote tiers charge 4/7/10/13 credits.
-- Activation waits for a billed run proving both WAV outputs and settlement.

INSERT INTO public.model_catalog
    (id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,
     cost_unit,billing_seconds,gated_flag,active)
VALUES ('sam-audio-target-stem','SAM Audio Target + Residual','fal','fal-ai/sam-audio/separate',
    'audio-to-audio',13,0.2000,'per_generation',NULL,false,false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.music_target_stem_quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    song_id UUID NOT NULL,
    source_version_id UUID NOT NULL,
    model_id TEXT NOT NULL REFERENCES public.model_catalog(id) ON DELETE RESTRICT,
    provider_endpoint TEXT NOT NULL CHECK (provider_endpoint='fal-ai/sam-audio/separate'),
    instrument TEXT NOT NULL CHECK (instrument IN
      ('vocals','drums','bass','guitar','piano','strings','synthesizer','brass','woodwinds')),
    provider_prompt TEXT NOT NULL CHECK (char_length(provider_prompt) BETWEEN 1 AND 80),
    source_duration_seconds NUMERIC(9,3) NOT NULL CHECK (source_duration_seconds>0 AND source_duration_seconds<=120),
    unit_credits INTEGER NOT NULL CHECK (unit_credits IN (4,7,10,13)),
    catalog_updated_at TIMESTAMPTZ NOT NULL,
    source_rights_version TEXT NOT NULL CHECK (source_rights_version='music-target-stem-rights-v1'),
    expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at>created_at),
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT music_target_stem_quotes_song_owner_fk FOREIGN KEY(song_id,user_id)
      REFERENCES public.music_songs(id,user_id) ON DELETE RESTRICT,
    CONSTRAINT music_target_stem_quotes_version_owner_fk FOREIGN KEY(source_version_id,user_id,song_id)
      REFERENCES public.music_song_versions(id,user_id,song_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.music_target_stem_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    quote_id UUID NOT NULL UNIQUE REFERENCES public.music_target_stem_quotes(id) ON DELETE RESTRICT,
    song_id UUID NOT NULL,
    source_version_id UUID NOT NULL,
    job_id UUID NOT NULL UNIQUE REFERENCES public.jobs(id) ON DELETE RESTRICT,
    model_id TEXT NOT NULL REFERENCES public.model_catalog(id) ON DELETE RESTRICT,
    instrument TEXT NOT NULL CHECK (instrument IN
      ('vocals','drums','bass','guitar','piano','strings','synthesizer','brass','woodwinds')),
    credit_quote INTEGER NOT NULL CHECK (credit_quote IN (4,7,10,13)),
    idempotency_key TEXT NOT NULL CHECK (idempotency_key~'^[A-Za-z0-9._-]{8,120}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id,idempotency_key),
    CONSTRAINT music_target_stem_requests_song_owner_fk FOREIGN KEY(song_id,user_id)
      REFERENCES public.music_songs(id,user_id) ON DELETE RESTRICT,
    CONSTRAINT music_target_stem_requests_version_owner_fk FOREIGN KEY(source_version_id,user_id,song_id)
      REFERENCES public.music_song_versions(id,user_id,song_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.music_target_stem_assets (
    request_id UUID PRIMARY KEY REFERENCES public.music_target_stem_requests(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    target_asset_id UUID NOT NULL UNIQUE REFERENCES public.assets(id) ON DELETE RESTRICT,
    residual_asset_id UUID NOT NULL UNIQUE REFERENCES public.assets(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (target_asset_id<>residual_asset_id)
);

CREATE INDEX IF NOT EXISTS music_target_stem_quotes_user_created_idx
    ON public.music_target_stem_quotes(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS music_target_stem_requests_user_created_idx
    ON public.music_target_stem_requests(user_id,created_at DESC);

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['music_target_stem_quotes','music_target_stem_requests','music_target_stem_assets'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',t||'_owner_read',t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (private.music_owns_user(user_id))',t||'_owner_read',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.%I TO service_role',t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.music_get_target_stem_source_context(
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
    AND s.current_version_id=p_version_id AND a.mime_type IN ('audio/mpeg','audio/wav');
  RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','FORMAT_UNAVAILABLE'));
END $$;

CREATE OR REPLACE FUNCTION public.music_create_target_stem_quote(
  p_auth_id TEXT,p_song_id UUID,p_version_id UUID,p_instrument TEXT,
  p_rights_confirmed BOOLEAN,p_source_duration_seconds NUMERIC
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_model public.model_catalog%ROWTYPE; v_quote public.music_target_stem_quotes%ROWTYPE;
 v_balance INTEGER; v_credits INTEGER; v_prompt TEXT;
BEGIN
  IF p_song_id IS NULL OR p_version_id IS NULL OR p_rights_confirmed IS DISTINCT FROM true
    OR p_instrument NOT IN ('vocals','drums','bass','guitar','piano','strings','synthesizer','brass','woodwinds')
    OR p_source_duration_seconds NOT BETWEEN 0.001 AND 120 THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
  SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
  IF NOT private.music_paid_plan_active(v_user) THEN RETURN jsonb_build_object('ok',false,'code','PLAN_UNAVAILABLE'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.music_songs s
    JOIN public.music_song_versions v ON v.id=p_version_id AND v.user_id=v_user AND v.song_id=s.id
    JOIN public.assets a ON a.id=v.audio_asset_id
    WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active' AND s.current_version_id=p_version_id
      AND a.mime_type IN ('audio/mpeg','audio/wav') FOR SHARE OF s,v,a) THEN
    RETURN jsonb_build_object('ok',false,'code','FORMAT_UNAVAILABLE'); END IF;
  IF (SELECT count(*) FROM public.music_target_stem_quotes
    WHERE user_id=v_user AND created_at>now()-interval '60 seconds')>=10 THEN
    RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED','retry_after_seconds',60); END IF;
  SELECT * INTO v_model FROM public.model_catalog WHERE id='sam-audio-target-stem';
  IF NOT FOUND OR NOT v_model.active OR v_model.gated_flag OR v_model.provider<>'fal'
    OR v_model.provider_endpoint<>'fal-ai/sam-audio/separate' OR v_model.modality<>'audio-to-audio'
    OR v_model.credits_5s<>13 OR v_model.provider_cost_per_unit<>0.2000::numeric
    OR v_model.cost_unit<>'per_generation' OR v_model.billing_seconds IS NOT NULL THEN
    RETURN jsonb_build_object('ok',false,'code','MODEL_UNAVAILABLE'); END IF;
  v_credits:=CASE WHEN p_source_duration_seconds<=30 THEN 4 WHEN p_source_duration_seconds<=60 THEN 7
    WHEN p_source_duration_seconds<=90 THEN 10 ELSE 13 END;
  v_prompt:=CASE p_instrument WHEN 'vocals' THEN 'singing vocals' WHEN 'drums' THEN 'drum kit and percussion'
    WHEN 'bass' THEN 'bass instrument' WHEN 'guitar' THEN 'guitar playing' WHEN 'piano' THEN 'piano playing'
    WHEN 'strings' THEN 'string instruments' WHEN 'synthesizer' THEN 'synthesizer'
    WHEN 'brass' THEN 'brass instruments' ELSE 'woodwind instruments' END;
  SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END
  INTO v_balance FROM public.credit_balances WHERE user_id=v_user;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NO_BALANCE_ROW'); END IF;
  INSERT INTO public.music_target_stem_quotes(user_id,song_id,source_version_id,model_id,
    provider_endpoint,instrument,provider_prompt,source_duration_seconds,unit_credits,
    catalog_updated_at,source_rights_version,expires_at)
  VALUES(v_user,p_song_id,p_version_id,v_model.id,v_model.provider_endpoint,p_instrument,v_prompt,
    p_source_duration_seconds,v_credits,v_model.updated_at,'music-target-stem-rights-v1',now()+interval '5 minutes')
  RETURNING * INTO v_quote;
  RETURN jsonb_build_object('ok',true,'quote_id',v_quote.id,'model_id',v_quote.model_id,
    'instrument',v_quote.instrument,'source_duration_seconds',v_quote.source_duration_seconds,
    'total_credits',v_quote.unit_credits,'balance',v_balance,'balance_after',v_balance-v_quote.unit_credits,
    'affordable',v_balance>=v_quote.unit_credits,'expires_at',v_quote.expires_at);
END $$;

CREATE OR REPLACE FUNCTION public.music_get_target_stem_dispatch_context(
  p_auth_id TEXT,p_song_id UUID,p_quote_id UUID,p_idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_existing public.music_target_stem_requests%ROWTYPE;
 v_quote public.music_target_stem_quotes%ROWTYPE; v_job public.jobs%ROWTYPE; v_row JSONB;
BEGIN
  IF p_idempotency_key!~'^[A-Za-z0-9._-]{8,120}$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
  SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  SELECT * INTO v_existing FROM public.music_target_stem_requests WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.quote_id IS DISTINCT FROM p_quote_id THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
    SELECT * INTO v_job FROM public.jobs WHERE id=v_existing.job_id;
    RETURN jsonb_build_object('ok',true,'idempotent',true,'request_id',v_existing.id,
      'job_id',v_existing.job_id,'state',CASE WHEN v_job.state='STORED' THEN 'ready'
      WHEN v_job.state='REFUNDED' THEN 'refunded' WHEN v_job.state='FAILED' THEN 'failed'
      WHEN v_job.state IN ('SUBMITTED','SUCCEEDED') THEN 'running' ELSE 'queued' END);
  END IF;
  SELECT * INTO v_quote FROM public.music_target_stem_quotes
    WHERE id=p_quote_id AND user_id=v_user AND song_id=p_song_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  SELECT jsonb_build_object('ok',true,'idempotent',false,'r2_key',a.r2_key,'mime_type',a.mime_type,
    'source_duration_seconds',v_quote.source_duration_seconds) INTO v_row
  FROM public.music_songs s JOIN public.music_song_versions v
    ON v.id=v_quote.source_version_id AND v.user_id=v_user AND v.song_id=s.id
  JOIN public.assets a ON a.id=v.audio_asset_id
  WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active'
    AND s.current_version_id=v_quote.source_version_id AND a.mime_type IN ('audio/mpeg','audio/wav');
  RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','REVISION_CONFLICT'));
END $$;

CREATE OR REPLACE FUNCTION public.music_submit_target_stem_request(
  p_auth_id TEXT,p_song_id UUID,p_quote_id UUID,p_idempotency_key TEXT,p_source_audio_url TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_balance INTEGER; v_active INTEGER; v_recent INTEGER;
 v_quote public.music_target_stem_quotes%ROWTYPE; v_model public.model_catalog%ROWTYPE;
 v_existing public.music_target_stem_requests%ROWTYPE; v_request public.music_target_stem_requests%ROWTYPE;
 v_debit JSONB; v_job UUID;
BEGIN
  IF p_song_id IS NULL OR p_quote_id IS NULL OR p_idempotency_key!~'^[A-Za-z0-9._-]{8,120}$'
    OR p_source_audio_url IS NULL OR p_source_audio_url!~'^https://[^[:space:]]{1,2000}$' THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
  SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id FOR UPDATE;
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
  SELECT * INTO v_existing FROM public.music_target_stem_requests WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.quote_id IS DISTINCT FROM p_quote_id THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
    SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance FROM public.credit_balances WHERE user_id=v_user;
    RETURN jsonb_build_object('ok',true,'request_id',v_existing.id,'job_id',v_existing.job_id,
      'state','queued','balance_after',v_balance,'idempotent',true);
  END IF;
  SELECT (SELECT count(*) FROM public.music_target_stem_requests r JOIN public.jobs j ON j.id=r.job_id
      WHERE r.user_id=v_user AND j.state IN ('CREATED','SUBMITTED','SUCCEEDED'))
    +(SELECT count(*) FROM public.music_stem_requests r JOIN public.jobs j ON j.id=r.job_id
      WHERE r.user_id=v_user AND j.state IN ('CREATED','SUBMITTED','SUCCEEDED')) INTO v_active;
  IF v_active>=2 THEN RETURN jsonb_build_object('ok',false,'code','CONCURRENCY_LIMIT'); END IF;
  SELECT count(*) INTO v_recent FROM public.jobs WHERE user_id=v_user AND created_at>now()-interval '60 seconds';
  IF v_recent>8 THEN RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED','retry_after_seconds',60); END IF;
  SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END
    INTO v_balance FROM public.credit_balances WHERE user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NO_BALANCE_ROW'); END IF;
  IF EXISTS(SELECT 1 FROM public.users WHERE id=v_user AND frozen_at IS NOT NULL) THEN RETURN jsonb_build_object('ok',false,'code','ACCOUNT_FROZEN'); END IF;
  SELECT * INTO v_quote FROM public.music_target_stem_quotes WHERE id=p_quote_id AND user_id=v_user AND song_id=p_song_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  IF v_quote.consumed_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_ALREADY_USED'); END IF;
  IF v_quote.expires_at<=now() THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_EXPIRED'); END IF;
  IF NOT private.music_paid_plan_active(v_user) THEN RETURN jsonb_build_object('ok',false,'code','PLAN_UNAVAILABLE'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.music_songs WHERE id=p_song_id AND user_id=v_user
    AND status='active' AND current_version_id=v_quote.source_version_id FOR SHARE) THEN
    RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); END IF;
  SELECT * INTO v_model FROM public.model_catalog WHERE id=v_quote.model_id FOR SHARE;
  IF NOT FOUND OR NOT v_model.active OR v_model.gated_flag OR v_model.provider<>'fal'
    OR v_model.id<>'sam-audio-target-stem' OR v_model.provider_endpoint<>'fal-ai/sam-audio/separate'
    OR v_model.modality<>'audio-to-audio' OR v_model.credits_5s<>13
    OR v_model.provider_cost_per_unit<>0.2000::numeric OR v_model.cost_unit<>'per_generation'
    OR v_model.billing_seconds IS NOT NULL OR v_model.updated_at IS DISTINCT FROM v_quote.catalog_updated_at
    OR v_quote.unit_credits<>CASE WHEN v_quote.source_duration_seconds<=30 THEN 4
      WHEN v_quote.source_duration_seconds<=60 THEN 7 WHEN v_quote.source_duration_seconds<=90 THEN 10 ELSE 13 END THEN
    RETURN jsonb_build_object('ok',false,'code','QUOTE_STALE'); END IF;
  IF v_balance<v_quote.unit_credits THEN RETURN jsonb_build_object('ok',false,'code','INSUFFICIENT_BALANCE'); END IF;
  BEGIN
    v_debit:=public.ledger_debit(v_user,p_idempotency_key,v_quote.unit_credits,'debit:music_target_stem',
      v_model.id,jsonb_build_object('music_target_stem_quote_id',v_quote.id,
      'source_version_id',v_quote.source_version_id,'instrument',v_quote.instrument),0,120);
    IF v_debit->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='target stem debit refused'; END IF;
    v_job:=(v_debit->>'job_id')::uuid;
    INSERT INTO public.music_target_stem_requests(user_id,quote_id,song_id,source_version_id,
      job_id,model_id,instrument,credit_quote,idempotency_key)
    VALUES(v_user,v_quote.id,p_song_id,v_quote.source_version_id,v_job,v_model.id,v_quote.instrument,
      v_quote.unit_credits,p_idempotency_key) RETURNING * INTO v_request;
    INSERT INTO public.fal_dispatch(job_id,endpoint,payload) VALUES(v_job,v_quote.provider_endpoint,
      jsonb_build_object('audio_url',p_source_audio_url,'prompt',v_quote.provider_prompt,
      'predict_spans',true,'reranking_candidates',1,'acceleration','balanced',
      'max_chunk_duration',60,'chunk_overlap',5,'output_format','wav'));
    UPDATE public.music_target_stem_quotes SET consumed_at=now() WHERE id=v_quote.id;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN RETURN COALESCE(v_debit,jsonb_build_object('ok',false,'code','DEBIT_FAILED')); END;
  SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance FROM public.credit_balances WHERE user_id=v_user;
  RETURN jsonb_build_object('ok',true,'request_id',v_request.id,'job_id',v_job,
    'state','queued','balance_after',v_balance,'idempotent',false);
END $$;

CREATE OR REPLACE FUNCTION public.music_store_target_stem_pair(
  p_provider_job_id TEXT,p_provider TEXT,
  p_target_r2_key TEXT,p_target_mime_type TEXT,p_target_size_bytes BIGINT,p_target_sha256 TEXT,
  p_residual_r2_key TEXT,p_residual_mime_type TEXT,p_residual_size_bytes BIGINT,p_residual_sha256 TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_request public.music_target_stem_requests%ROWTYPE; v_job public.jobs%ROWTYPE;
 v_existing public.music_target_stem_assets%ROWTYPE; v_target UUID; v_residual UUID;
BEGIN
  IF p_provider<>'fal' OR p_target_r2_key=p_residual_r2_key OR p_target_mime_type<>'audio/wav' -- gitleaks:allow -- provider and MIME contract, not a credential
    OR p_residual_mime_type<>'audio/wav' OR p_target_size_bytes<=0 OR p_residual_size_bytes<=0
    OR p_target_sha256!~'^[0-9a-f]{64}$' OR p_residual_sha256!~'^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_OUTPUTS'); END IF;
  SELECT r.* INTO v_request FROM public.music_target_stem_requests r
    JOIN public.jobs j ON j.id=r.job_id WHERE j.provider=p_provider AND j.provider_job_id=p_provider_job_id FOR UPDATE OF j;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','REQUEST_NOT_FOUND'); END IF;
  SELECT * INTO v_job FROM public.jobs WHERE id=v_request.job_id;
  SELECT * INTO v_existing FROM public.music_target_stem_assets WHERE request_id=v_request.id;
  IF FOUND THEN RETURN jsonb_build_object('ok',true,'request_id',v_request.id,'idempotent',true); END IF;
  IF v_job.state<>'SUCCEEDED' THEN RETURN jsonb_build_object('ok',false,'code','JOB_NOT_SUCCEEDED'); END IF;
  INSERT INTO public.assets(job_id,r2_key,mime_type,size_bytes,sha256)
    VALUES(v_job.id,p_target_r2_key,p_target_mime_type,p_target_size_bytes,p_target_sha256)
    ON CONFLICT(r2_key) DO UPDATE SET sha256=COALESCE(public.assets.sha256,EXCLUDED.sha256)
    WHERE public.assets.job_id=EXCLUDED.job_id AND public.assets.mime_type=EXCLUDED.mime_type
      AND public.assets.size_bytes=EXCLUDED.size_bytes
    RETURNING id INTO v_target;
  IF v_target IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='target stem output conflict'; END IF;
  INSERT INTO public.assets(job_id,r2_key,mime_type,size_bytes,sha256)
    VALUES(v_job.id,p_residual_r2_key,p_residual_mime_type,p_residual_size_bytes,p_residual_sha256)
    ON CONFLICT(r2_key) DO UPDATE SET sha256=COALESCE(public.assets.sha256,EXCLUDED.sha256)
    WHERE public.assets.job_id=EXCLUDED.job_id AND public.assets.mime_type=EXCLUDED.mime_type
      AND public.assets.size_bytes=EXCLUDED.size_bytes
    RETURNING id INTO v_residual;
  IF v_residual IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='residual stem output conflict'; END IF;
  INSERT INTO public.music_target_stem_assets(request_id,user_id,target_asset_id,residual_asset_id)
    VALUES(v_request.id,v_request.user_id,v_target,v_residual);
  UPDATE public.jobs SET state='STORED',updated_at=now() WHERE id=v_job.id AND state='SUCCEEDED';
  RETURN jsonb_build_object('ok',true,'request_id',v_request.id,'target_asset_id',v_target,'residual_asset_id',v_residual);
END $$;

CREATE OR REPLACE FUNCTION public.music_get_target_stem_request(p_auth_id TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_row JSONB;
BEGIN
  SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  SELECT jsonb_build_object('id',r.id,'song_id',r.song_id,'source_version_id',r.source_version_id,
    'job_id',r.job_id,'model_id',r.model_id,'instrument',r.instrument,'credits',r.credit_quote,
    'created_at',r.created_at,'state',CASE WHEN p.request_id IS NOT NULL AND j.state='STORED' THEN 'ready'
      WHEN j.state='REFUNDED' THEN 'refunded' WHEN j.state='FAILED' THEN 'failed'
      WHEN j.state IN ('SUBMITTED','SUCCEEDED') THEN 'running' ELSE 'queued' END,
    'outputs',CASE WHEN p.request_id IS NOT NULL AND j.state='STORED' THEN jsonb_build_array('target','residual') ELSE '[]'::jsonb END)
  INTO v_row FROM public.music_target_stem_requests r JOIN public.jobs j ON j.id=r.job_id
  LEFT JOIN public.music_target_stem_assets p ON p.request_id=r.id
  WHERE r.id=p_request_id AND r.user_id=v_user;
  IF v_row IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok',true,'request',v_row);
END $$;

CREATE OR REPLACE FUNCTION public.music_get_target_stem_asset_context(
  p_auth_id TEXT,p_request_id UUID,p_kind TEXT
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_row JSONB;
BEGIN
  IF p_kind NOT IN ('target','residual') THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
  SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
  SELECT jsonb_build_object('ok',true,'r2_key',a.r2_key,'mime_type',a.mime_type,
    'size_bytes',a.size_bytes,'song_id',r.song_id,'instrument',r.instrument)
  INTO v_row FROM public.music_target_stem_requests r
  JOIN public.jobs j ON j.id=r.job_id AND j.state='STORED'
  JOIN public.music_target_stem_assets p ON p.request_id=r.id
  JOIN public.assets a ON a.id=CASE WHEN p_kind='target' THEN p.target_asset_id ELSE p.residual_asset_id END
  WHERE r.id=p_request_id AND r.user_id=v_user;
  RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','NOT_FOUND'));
END $$;

REVOKE ALL ON FUNCTION public.music_get_target_stem_source_context(TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_create_target_stem_quote(TEXT,UUID,UUID,TEXT,BOOLEAN,NUMERIC) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_get_target_stem_dispatch_context(TEXT,UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_submit_target_stem_request(TEXT,UUID,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_store_target_stem_pair(TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,BIGINT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_get_target_stem_request(TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_get_target_stem_asset_context(TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_target_stem_source_context(TEXT,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_create_target_stem_quote(TEXT,UUID,UUID,TEXT,BOOLEAN,NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_get_target_stem_dispatch_context(TEXT,UUID,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_submit_target_stem_request(TEXT,UUID,UUID,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_store_target_stem_pair(TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,BIGINT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_get_target_stem_request(TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_get_target_stem_asset_context(TEXT,UUID,TEXT) TO service_role;
