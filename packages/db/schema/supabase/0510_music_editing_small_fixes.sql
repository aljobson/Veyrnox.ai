-- 0510: four small Music editing fixes found by the 2026-11-13 audit.
--
-- Each function below is recreated from its latest definition with only the change
-- described above it. No ledger or balance write is added; debits still go through
-- ledger_debit. Idempotent: OR REPLACE, explicit revoke and grant.


-- 1. Downloads. A version is unrendered only while it is a preview-only crop (0464).
--    Cover, Extend, Replace and Add section versions carry a real provider file but no
--    render_state, so 0472's rule answered render_required for every one of them.

CREATE OR REPLACE FUNCTION public.music_get_version_exportability(p_auth_id TEXT,p_song_id UUID,p_version_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    SELECT COALESCE((SELECT jsonb_build_object('ok',true,
        'rendered',COALESCE(v.provenance->>'render_state','canonical')<>'preview_only','operation',v.operation)
    FROM public.music_song_versions v JOIN public.music_songs s ON s.id=v.song_id AND s.user_id=v.user_id
    JOIN public.users u ON u.id=v.user_id WHERE u.auth_id=p_auth_id AND s.id=p_song_id AND v.id=p_version_id),
    jsonb_build_object('ok',false,'code','NOT_FOUND'));
$$;
REVOKE ALL ON FUNCTION public.music_get_version_exportability(TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_version_exportability(TEXT,UUID,UUID) TO service_role;

-- 2. Track add. If the upload debit succeeded and the track debit then RAISED (an
--    in-flight or provider-spend guard on the jobs insert), the handler returned the
--    upload's ok:true for work that had just been rolled back, and the route answered 202.

CREATE OR REPLACE FUNCTION public.music_submit_track_add_request(
  p_auth_id TEXT,p_song_id UUID,p_quote_id UUID,p_idempotency_key TEXT,p_source_audio_url TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_balance INTEGER; v_active INTEGER; v_recent INTEGER;
 v_quote public.music_track_add_quotes%ROWTYPE; v_upload_model public.model_catalog%ROWTYPE; v_track_model public.model_catalog%ROWTYPE;
 v_existing public.music_track_add_requests%ROWTYPE; v_request public.music_track_add_requests%ROWTYPE;
 v_upload_debit JSONB; v_track_debit JSONB; v_upload_job UUID; v_track_job UUID;
BEGIN
  IF p_song_id IS NULL OR p_quote_id IS NULL OR p_idempotency_key!~'^[A-Za-z0-9._-]{8,120}$'
    OR p_source_audio_url IS NULL OR (p_source_audio_url !~ '^https://[^[:space:]]+$' OR length(p_source_audio_url) > 2008) THEN
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
    -- The block rolled both debits back. Report the refusal, never the upload's ok:true.
    RETURN CASE
      WHEN v_track_debit IS NOT NULL AND v_track_debit->>'ok' IS DISTINCT FROM 'true' THEN v_track_debit
      WHEN v_upload_debit IS NOT NULL AND v_upload_debit->>'ok' IS DISTINCT FROM 'true' THEN v_upload_debit
      ELSE jsonb_build_object('ok',false,'code','DEBIT_FAILED') END;
  END;
  SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance FROM public.credit_balances WHERE user_id=v_user;
  RETURN jsonb_build_object('ok',true,'request_id',v_request.id,'upload_job_id',v_upload_job,
    'track_job_id',v_track_job,'state','queued','balance_after',v_balance,'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.music_submit_track_add_request(TEXT,UUID,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_submit_track_add_request(TEXT,UUID,UUID,TEXT,TEXT) TO service_role;

-- 3. Target stems. The quote took its tier from the unrounded duration and stored it
--    rounded to 3 places; submit recomputes the tier from the stored value. A duration in
--    (30, 30.0005), (60, 60.0005) or (90, 90.0005) could never be submitted.

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
  -- The tier is taken from the value that is stored (NUMERIC(9,3)), the same value submit
  -- recomputes it from, so a source a hair over 30, 60 or 90 s is not QUOTE_STALE for ever.
  v_credits:=CASE WHEN round(p_source_duration_seconds,3)<=30 THEN 4 WHEN round(p_source_duration_seconds,3)<=60 THEN 7
    WHEN round(p_source_duration_seconds,3)<=90 THEN 10 ELSE 13 END;
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
    round(p_source_duration_seconds,3),v_credits,v_model.updated_at,'music-target-stem-rights-v1',now()+interval '5 minutes')
  RETURNING * INTO v_quote;
  RETURN jsonb_build_object('ok',true,'quote_id',v_quote.id,'model_id',v_quote.model_id,
    'instrument',v_quote.instrument,'source_duration_seconds',v_quote.source_duration_seconds,
    'total_credits',v_quote.unit_credits,'balance',v_balance,'balance_after',v_balance-v_quote.unit_credits,
    'affordable',v_balance>=v_quote.unit_credits,'expires_at',v_quote.expires_at);
END $$;
REVOKE ALL ON FUNCTION public.music_create_target_stem_quote(TEXT,UUID,UUID,TEXT,BOOLEAN,NUMERIC) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_create_target_stem_quote(TEXT,UUID,UUID,TEXT,BOOLEAN,NUMERIC) TO service_role;

-- 4. Stems. Stem submit counted only stem requests, while target-stem submit counted
--    both, so a person could have four separations in flight where two were intended.

CREATE OR REPLACE FUNCTION public.music_submit_stem_request(
    p_auth_id TEXT,p_song_id UUID,p_quote_id UUID,p_idempotency_key TEXT,p_source_audio_url TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    v_user UUID; v_balance INTEGER; v_active INTEGER; v_quote public.music_stem_quotes%ROWTYPE;
    v_model public.model_catalog%ROWTYPE; v_existing public.music_stem_requests%ROWTYPE;
    v_request public.music_stem_requests%ROWTYPE; v_debit JSONB; v_job UUID;
BEGIN
    IF p_song_id IS NULL OR p_quote_id IS NULL OR p_idempotency_key!~'^[A-Za-z0-9._-]{8,120}$'
       OR p_source_audio_url IS NULL OR (p_source_audio_url !~ '^https://[^[:space:]]+$' OR length(p_source_audio_url) > 2008) THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id FOR UPDATE;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
    SELECT * INTO v_existing FROM public.music_stem_requests
    WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
    IF FOUND THEN
        IF v_existing.quote_id IS DISTINCT FROM p_quote_id THEN
            RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');
        END IF;
        SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END
        INTO v_balance FROM public.credit_balances WHERE user_id=v_user;
        RETURN jsonb_build_object('ok',true,'request_id',v_existing.id,'job_id',v_existing.job_id,
            'state','queued','balance_after',v_balance,'idempotent',true);
    END IF;
    -- Stems and target stems share one limit of two in flight, as target-stem submit counts it.
    SELECT (SELECT count(*) FROM public.music_stem_requests r JOIN public.jobs j ON j.id=r.job_id
              WHERE r.user_id=v_user AND j.state IN ('DEBITED','SUBMITTED','SUCCEEDED'))
          +(SELECT count(*) FROM public.music_target_stem_requests r JOIN public.jobs j ON j.id=r.job_id
              WHERE r.user_id=v_user AND j.state IN ('DEBITED','SUBMITTED','SUCCEEDED')) INTO v_active;
    IF v_active>=2 THEN RETURN jsonb_build_object('ok',false,'code','CONCURRENCY_LIMIT'); END IF;
    SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END
    INTO v_balance FROM public.credit_balances WHERE user_id=v_user FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NO_BALANCE_ROW'); END IF;
    IF EXISTS(SELECT 1 FROM public.users WHERE id=v_user AND frozen_at IS NOT NULL) THEN
        RETURN jsonb_build_object('ok',false,'code','ACCOUNT_FROZEN');
    END IF;
    SELECT * INTO v_quote FROM public.music_stem_quotes
    WHERE id=p_quote_id AND user_id=v_user AND song_id=p_song_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    IF v_quote.consumed_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_ALREADY_USED'); END IF;
    IF v_quote.expires_at<=now() THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_EXPIRED'); END IF;
    IF NOT private.music_paid_plan_active(v_user) THEN RETURN jsonb_build_object('ok',false,'code','PLAN_UNAVAILABLE'); END IF;
    IF NOT EXISTS(SELECT 1 FROM public.music_songs WHERE id=p_song_id AND user_id=v_user
        AND status='active' AND current_version_id=v_quote.source_version_id FOR SHARE) THEN
        RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT');
    END IF;
    SELECT * INTO v_model FROM public.model_catalog WHERE id=v_quote.model_id FOR SHARE;
    IF NOT FOUND OR NOT v_model.active OR v_model.gated_flag OR v_model.provider<>'fal'
       OR v_model.id<>'mureka-stems-v3' OR v_model.provider_endpoint<>'mureka/api/song/stem'
       OR v_model.modality<>'audio-to-audio' OR v_model.credits_5s<>v_quote.unit_credits
       OR v_model.provider_cost_per_unit<>0.2000::numeric OR v_model.cost_unit<>'per_generation'
       OR v_model.updated_at IS DISTINCT FROM v_quote.catalog_updated_at THEN
        RETURN jsonb_build_object('ok',false,'code','QUOTE_STALE');
    END IF;
    IF v_balance<v_quote.unit_credits THEN RETURN jsonb_build_object('ok',false,'code','INSUFFICIENT_BALANCE'); END IF;
    BEGIN
        v_debit:=public.ledger_debit(v_user,p_idempotency_key,v_quote.unit_credits,
            'debit:music_stems',v_model.id,jsonb_build_object('music_stem_quote_id',v_quote.id,
            'source_version_id',v_quote.source_version_id),0,60);
        IF v_debit->>'ok' IS DISTINCT FROM 'true' THEN
            RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='music stem debit refused';
        END IF;
        v_job:=(v_debit->>'job_id')::uuid;
        INSERT INTO public.music_stem_requests(user_id,quote_id,song_id,source_version_id,
            job_id,model_id,credit_quote,idempotency_key)
        VALUES(v_user,v_quote.id,p_song_id,v_quote.source_version_id,v_job,v_model.id,
            v_quote.unit_credits,p_idempotency_key) RETURNING * INTO v_request;
        INSERT INTO public.fal_dispatch(job_id,endpoint,payload)
        VALUES(v_job,v_quote.provider_endpoint,jsonb_build_object(
            'audio_url',p_source_audio_url,'model','audio-separation-3'));
        UPDATE public.music_stem_quotes SET consumed_at=now() WHERE id=v_quote.id;
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        RETURN COALESCE(v_debit,jsonb_build_object('ok',false,'code','DEBIT_FAILED'));
    END;
    SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END
    INTO v_balance FROM public.credit_balances WHERE user_id=v_user;
    RETURN jsonb_build_object('ok',true,'request_id',v_request.id,'job_id',v_job,
        'state','queued','balance_after',v_balance,'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.music_submit_stem_request(TEXT,UUID,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_submit_stem_request(TEXT,UUID,UUID,TEXT,TEXT) TO service_role;
