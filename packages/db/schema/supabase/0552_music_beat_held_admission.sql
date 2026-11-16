-- Lock the source hold marker after replay and before any debit/dispatch.
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
    -- Phase 7: replay has returned above; lock before inspecting the marker.
    PERFORM 1 FROM public.assets a JOIN public.music_song_versions v ON v.audio_asset_id=a.id
      WHERE v.user_id=v_user AND v.id IN (SELECT q.source_version_id FROM public.music_stem_quotes q WHERE q.id=p_quote_id AND q.user_id=v_user AND q.song_id=p_song_id) FOR SHARE OF a;
    IF EXISTS (SELECT 1 FROM public.assets a JOIN public.music_song_versions v ON v.audio_asset_id=a.id
      WHERE v.user_id=v_user AND v.id IN (SELECT q.source_version_id FROM public.music_stem_quotes q WHERE q.id=p_quote_id AND q.user_id=v_user AND q.song_id=p_song_id) AND a.held_at IS NOT NULL) THEN
      RETURN jsonb_build_object('ok',false,'code','HELD');
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
REVOKE ALL ON FUNCTION public.music_submit_stem_request(TEXT,UUID,UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_submit_stem_request(TEXT,UUID,UUID,TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.music_submit_target_stem_request(
  p_auth_id TEXT,p_song_id UUID,p_quote_id UUID,p_idempotency_key TEXT,p_source_audio_url TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_balance INTEGER; v_active INTEGER; v_recent INTEGER;
 v_quote public.music_target_stem_quotes%ROWTYPE; v_model public.model_catalog%ROWTYPE;
 v_existing public.music_target_stem_requests%ROWTYPE; v_request public.music_target_stem_requests%ROWTYPE;
 v_debit JSONB; v_job UUID;
BEGIN
  IF p_song_id IS NULL OR p_quote_id IS NULL OR p_idempotency_key!~'^[A-Za-z0-9._-]{8,120}$'
    OR p_source_audio_url IS NULL OR (p_source_audio_url !~ '^https://[^[:space:]]+$' OR length(p_source_audio_url) > 2008) THEN
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
    -- Phase 7: replay has returned above; lock before inspecting the marker.
    PERFORM 1 FROM public.assets a JOIN public.music_song_versions v ON v.audio_asset_id=a.id
      WHERE v.user_id=v_user AND v.id IN (SELECT q.source_version_id FROM public.music_target_stem_quotes q WHERE q.id=p_quote_id AND q.user_id=v_user AND q.song_id=p_song_id) FOR SHARE OF a;
    IF EXISTS (SELECT 1 FROM public.assets a JOIN public.music_song_versions v ON v.audio_asset_id=a.id
      WHERE v.user_id=v_user AND v.id IN (SELECT q.source_version_id FROM public.music_target_stem_quotes q WHERE q.id=p_quote_id AND q.user_id=v_user AND q.song_id=p_song_id) AND a.held_at IS NOT NULL) THEN
      RETURN jsonb_build_object('ok',false,'code','HELD');
    END IF;

  SELECT (SELECT count(*) FROM public.music_target_stem_requests r JOIN public.jobs j ON j.id=r.job_id
      WHERE r.user_id=v_user AND j.state IN ('DEBITED','SUBMITTED','SUCCEEDED'))
    +(SELECT count(*) FROM public.music_stem_requests r JOIN public.jobs j ON j.id=r.job_id
      WHERE r.user_id=v_user AND j.state IN ('DEBITED','SUBMITTED','SUCCEEDED')) INTO v_active;
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
    OR v_quote.unit_credits<>(CASE WHEN v_quote.source_duration_seconds<=30 THEN 4
      WHEN v_quote.source_duration_seconds<=60 THEN 7 WHEN v_quote.source_duration_seconds<=90 THEN 10 ELSE 13 END) THEN
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
REVOKE ALL ON FUNCTION public.music_submit_target_stem_request(TEXT,UUID,UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_submit_target_stem_request(TEXT,UUID,UUID,TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.music_submit_extend_pair(
    p_auth_id TEXT,p_song_id UUID,p_quote_id UUID,p_idempotency_key TEXT,p_source_audio_url TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    v_user UUID; v_balance INTEGER; v_active INTEGER; v_recent INTEGER;
    v_quote public.music_generation_quotes%ROWTYPE; v_prompt public.music_prompt_specs%ROWTYPE;
    v_model public.model_catalog%ROWTYPE; v_request public.music_generation_requests%ROWTYPE;
    v_existing public.music_generation_requests%ROWTYPE; v_one JSONB; v_two JSONB;
    v_job_one UUID; v_job_two UUID; v_failure JSONB; v_jobs JSONB; v_payload JSONB;
BEGIN
    IF p_song_id IS NULL OR p_quote_id IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$'
       OR p_source_audio_url IS NULL OR (p_source_audio_url !~ '^https://[^[:space:]]+$' OR length(p_source_audio_url) > 2008) THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id FOR UPDATE;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
    SELECT * INTO v_existing FROM public.music_generation_requests
    WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
    IF FOUND THEN
        IF v_existing.quote_id IS DISTINCT FROM p_quote_id THEN
            RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');
        END IF;
        SELECT COALESCE(jsonb_agg(job_id ORDER BY ordinal),'[]'::jsonb) INTO v_jobs
        FROM public.music_generation_candidates WHERE generation_request_id=v_existing.id;
        SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END
        INTO v_balance FROM public.credit_balances WHERE user_id=v_user;
        RETURN jsonb_build_object('ok',true,'request_id',v_existing.id,'state',v_existing.status,
            'job_ids',v_jobs,'balance_after',v_balance,'idempotent',true);
    END IF;
    -- Phase 7: replay has returned above; lock before inspecting the marker.
    PERFORM 1 FROM public.assets a JOIN public.music_song_versions v ON v.audio_asset_id=a.id
      WHERE v.user_id=v_user AND v.id IN (SELECT ps.source_version_id FROM public.music_generation_quotes q JOIN public.music_prompt_specs ps ON ps.id=q.prompt_spec_id WHERE q.id=p_quote_id AND q.user_id=v_user AND ps.source_song_id=p_song_id) FOR SHARE OF a;
    IF EXISTS (SELECT 1 FROM public.assets a JOIN public.music_song_versions v ON v.audio_asset_id=a.id
      WHERE v.user_id=v_user AND v.id IN (SELECT ps.source_version_id FROM public.music_generation_quotes q JOIN public.music_prompt_specs ps ON ps.id=q.prompt_spec_id WHERE q.id=p_quote_id AND q.user_id=v_user AND ps.source_song_id=p_song_id) AND a.held_at IS NOT NULL) THEN
      RETURN jsonb_build_object('ok',false,'code','HELD');
    END IF;

    SELECT count(*) INTO v_active FROM public.music_generation_requests
    WHERE user_id=v_user AND status IN ('debited','running');
    IF v_active>=4 THEN RETURN jsonb_build_object('ok',false,'code','CONCURRENCY_LIMIT'); END IF;
    SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END
    INTO v_balance FROM public.credit_balances WHERE user_id=v_user FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NO_BALANCE_ROW'); END IF;
    IF EXISTS(SELECT 1 FROM public.users WHERE id=v_user AND frozen_at IS NOT NULL) THEN
        RETURN jsonb_build_object('ok',false,'code','ACCOUNT_FROZEN');
    END IF;
    SELECT * INTO v_quote FROM public.music_generation_quotes
    WHERE id=p_quote_id AND user_id=v_user FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    IF v_quote.consumed_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_ALREADY_USED'); END IF;
    IF v_quote.expires_at<=now() THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_EXPIRED'); END IF;
    IF NOT private.music_paid_plan_active(v_user) THEN RETURN jsonb_build_object('ok',false,'code','PLAN_UNAVAILABLE'); END IF;
    SELECT * INTO v_prompt FROM public.music_prompt_specs
    WHERE id=v_quote.prompt_spec_id AND user_id=v_user AND mode='extend'
      AND source_song_id=p_song_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_STALE'); END IF;
    IF NOT EXISTS(SELECT 1 FROM public.music_songs s WHERE s.id=p_song_id AND s.user_id=v_user
        AND s.status='active' AND s.current_version_id=v_prompt.source_version_id FOR SHARE) THEN
        RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT');
    END IF;
    SELECT * INTO v_model FROM public.model_catalog WHERE id=v_quote.model_id FOR SHARE;
    IF NOT FOUND OR NOT v_model.active OR v_model.gated_flag OR v_model.provider<>'fal'
       OR v_model.modality<>'audio-to-audio' OR v_model.id<>'ace-step-extend'
       OR v_model.provider_endpoint<>'fal-ai/ace-step/audio-outpaint'
       OR v_model.provider_endpoint<>v_quote.provider_endpoint OR v_model.credits_5s<>v_quote.unit_credits
       OR v_model.provider_cost_per_unit<>0.0060::numeric OR v_model.cost_unit<>'per_generation'
       OR v_model.billing_seconds IS NOT NULL OR v_model.updated_at IS DISTINCT FROM v_quote.catalog_updated_at THEN
        RETURN jsonb_build_object('ok',false,'code','QUOTE_STALE');
    END IF;
    IF v_balance<v_quote.total_credits THEN RETURN jsonb_build_object('ok',false,'code','INSUFFICIENT_BALANCE'); END IF;
    SELECT count(*) INTO v_recent FROM public.jobs
    WHERE user_id=v_user AND created_at>now()-interval '60 seconds';
    IF v_recent>8 THEN RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED','retry_after_seconds',60); END IF;
    BEGIN
        INSERT INTO public.music_generation_requests(user_id,quote_id,prompt_spec_id,model_id,idempotency_key,credit_quote)
        VALUES(v_user,v_quote.id,v_prompt.id,v_model.id,p_idempotency_key,v_quote.total_credits)
        RETURNING * INTO v_request;
        v_one:=public.ledger_debit(v_user,p_idempotency_key||'.1',v_quote.unit_credits,
            'debit:music_generation',v_model.id,jsonb_build_object('prompt',v_prompt.prompt,
            'music_request_id',v_request.id,'music_candidate_ordinal',1),0,120);
        IF v_one->>'ok' IS DISTINCT FROM 'true' THEN v_failure:=v_one;
            RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='music extend debit one refused'; END IF;
        v_two:=public.ledger_debit(v_user,p_idempotency_key||'.2',v_quote.unit_credits,
            'debit:music_generation',v_model.id,jsonb_build_object('prompt',v_prompt.prompt,
            'music_request_id',v_request.id,'music_candidate_ordinal',2),0,120);
        IF v_two->>'ok' IS DISTINCT FROM 'true' THEN v_failure:=v_two;
            RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='music extend debit two refused'; END IF;
        v_job_one:=(v_one->>'job_id')::uuid; v_job_two:=(v_two->>'job_id')::uuid;
        INSERT INTO public.music_generation_candidates(user_id,generation_request_id,ordinal,job_id)
        VALUES(v_user,v_request.id,1,v_job_one),(v_user,v_request.id,2,v_job_two);
        v_payload:=jsonb_build_object('audio_url',p_source_audio_url,
            'extend_before_duration',0,'extend_after_duration',v_prompt.extend_seconds_after,
            'tags',v_prompt.prompt,'lyrics','[instrumental]','enable_safety_checker',true,
            'number_of_steps',27,'scheduler','euler','guidance_type','apg');
        INSERT INTO public.fal_dispatch(job_id,endpoint,payload)
        VALUES(v_job_one,v_quote.provider_endpoint,v_payload),(v_job_two,v_quote.provider_endpoint,v_payload);
        UPDATE public.music_generation_quotes SET consumed_at=now() WHERE id=v_quote.id;
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        RETURN COALESCE(v_failure,jsonb_build_object('ok',false,'code','PAIR_DEBIT_FAILED'));
    END;
    SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END
    INTO v_balance FROM public.credit_balances WHERE user_id=v_user;
    RETURN jsonb_build_object('ok',true,'request_id',v_request.id,'state','debited',
        'job_ids',jsonb_build_array(v_job_one,v_job_two),'balance_after',v_balance,'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.music_submit_extend_pair(TEXT,UUID,UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_submit_extend_pair(TEXT,UUID,UUID,TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.music_submit_replace_pair(p_auth_id TEXT,p_song_id UUID,p_quote_id UUID,
 p_idempotency_key TEXT,p_source_audio_url TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_balance INTEGER; v_active INTEGER; v_recent INTEGER; v_quote public.music_generation_quotes%ROWTYPE;
 v_prompt public.music_prompt_specs%ROWTYPE; v_model public.model_catalog%ROWTYPE;
 v_request public.music_generation_requests%ROWTYPE; v_existing public.music_generation_requests%ROWTYPE;
 v_one JSONB; v_two JSONB; v_failure JSONB; v_job_one UUID; v_job_two UUID; v_jobs JSONB; v_payload JSONB;
BEGIN
 IF p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' OR (p_source_audio_url !~ '^https://[^[:space:]]+$' OR length(p_source_audio_url) > 2008)
 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id FOR UPDATE;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
 SELECT * INTO v_existing FROM public.music_generation_requests WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF v_existing.quote_id IS DISTINCT FROM p_quote_id THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  SELECT COALESCE(jsonb_agg(job_id ORDER BY ordinal),'[]'::jsonb) INTO v_jobs FROM public.music_generation_candidates WHERE generation_request_id=v_existing.id;
  SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance FROM public.credit_balances WHERE user_id=v_user;
  RETURN jsonb_build_object('ok',true,'request_id',v_existing.id,'state',v_existing.status,'job_ids',v_jobs,'balance_after',v_balance,'idempotent',true);
 END IF;
    -- Phase 7: replay has returned above; lock before inspecting the marker.
    PERFORM 1 FROM public.assets a JOIN public.music_song_versions v ON v.audio_asset_id=a.id
      WHERE v.user_id=v_user AND v.id IN (SELECT ps.source_version_id FROM public.music_generation_quotes q JOIN public.music_prompt_specs ps ON ps.id=q.prompt_spec_id WHERE q.id=p_quote_id AND q.user_id=v_user AND ps.source_song_id=p_song_id) FOR SHARE OF a;
    IF EXISTS (SELECT 1 FROM public.assets a JOIN public.music_song_versions v ON v.audio_asset_id=a.id
      WHERE v.user_id=v_user AND v.id IN (SELECT ps.source_version_id FROM public.music_generation_quotes q JOIN public.music_prompt_specs ps ON ps.id=q.prompt_spec_id WHERE q.id=p_quote_id AND q.user_id=v_user AND ps.source_song_id=p_song_id) AND a.held_at IS NOT NULL) THEN
      RETURN jsonb_build_object('ok',false,'code','HELD');
    END IF;

 SELECT count(*) INTO v_active FROM public.music_generation_requests WHERE user_id=v_user AND status IN ('debited','running');
 IF v_active>=4 THEN RETURN jsonb_build_object('ok',false,'code','CONCURRENCY_LIMIT'); END IF;
 SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance FROM public.credit_balances WHERE user_id=v_user FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NO_BALANCE_ROW'); END IF;
 IF EXISTS(SELECT 1 FROM public.users WHERE id=v_user AND frozen_at IS NOT NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','ACCOUNT_FROZEN');
 END IF;
 SELECT * INTO v_quote FROM public.music_generation_quotes WHERE id=p_quote_id AND user_id=v_user FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF v_quote.consumed_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_ALREADY_USED'); END IF;
 IF v_quote.expires_at<=now() THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_EXPIRED'); END IF;
 IF NOT private.music_paid_plan_active(v_user) THEN RETURN jsonb_build_object('ok',false,'code','PLAN_UNAVAILABLE'); END IF;
 SELECT * INTO v_prompt FROM public.music_prompt_specs WHERE id=v_quote.prompt_spec_id AND user_id=v_user
 AND mode='replace_section' AND source_song_id=p_song_id;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.music_songs WHERE id=p_song_id AND user_id=v_user
  AND status='active' AND current_version_id=v_prompt.source_version_id FOR SHARE)
 THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_STALE'); END IF;
 SELECT * INTO v_model FROM public.model_catalog WHERE id=v_quote.model_id FOR SHARE;
 IF NOT FOUND OR NOT v_model.active OR v_model.gated_flag OR v_model.provider<>'fal'
 OR v_model.modality<>'audio-to-audio' OR v_model.id<>'ace-step-replace-section'
 OR v_model.provider_endpoint<>'fal-ai/ace-step/audio-inpaint' OR v_model.provider_endpoint<>v_quote.provider_endpoint
 OR v_model.credits_5s<>1 OR v_quote.unit_credits<>1 OR v_quote.total_credits<>2
 OR v_model.provider_cost_per_unit<>0.0120::numeric
 OR v_model.cost_unit<>'per_generation' OR v_model.billing_seconds IS NOT NULL
 OR v_model.updated_at IS DISTINCT FROM v_quote.catalog_updated_at THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_STALE'); END IF;
 IF v_balance<2 THEN RETURN jsonb_build_object('ok',false,'code','INSUFFICIENT_BALANCE'); END IF;
 SELECT count(*) INTO v_recent FROM public.jobs WHERE user_id=v_user AND created_at>now()-interval '60 seconds';
 IF v_recent>8 THEN RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED','retry_after_seconds',60); END IF;
 BEGIN
  INSERT INTO public.music_generation_requests(user_id,quote_id,prompt_spec_id,model_id,idempotency_key,credit_quote)
  VALUES(v_user,v_quote.id,v_prompt.id,v_model.id,p_idempotency_key,2) RETURNING * INTO v_request;
  v_one:=public.ledger_debit(v_user,p_idempotency_key||'.1',1,'debit:music_generation',v_model.id,
   jsonb_build_object('music_request_id',v_request.id,'music_candidate_ordinal',1),0,120);
  IF v_one->>'ok' IS DISTINCT FROM 'true' THEN v_failure:=v_one; RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='replace debit one refused'; END IF;
  v_two:=public.ledger_debit(v_user,p_idempotency_key||'.2',1,'debit:music_generation',v_model.id,
   jsonb_build_object('music_request_id',v_request.id,'music_candidate_ordinal',2),0,120);
  IF v_two->>'ok' IS DISTINCT FROM 'true' THEN v_failure:=v_two; RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='replace debit two refused'; END IF;
  v_job_one:=(v_one->>'job_id')::uuid; v_job_two:=(v_two->>'job_id')::uuid;
  INSERT INTO public.music_generation_candidates(user_id,generation_request_id,ordinal,job_id)
  VALUES(v_user,v_request.id,1,v_job_one),(v_user,v_request.id,2,v_job_two);
  v_payload:=jsonb_build_object('audio_url',p_source_audio_url,'start_time_relative_to','start',
   'start_time',v_prompt.replace_start_seconds,'end_time_relative_to','start','end_time',v_prompt.replace_end_seconds,
   'tags',v_prompt.prompt,'lyrics','[instrumental]','variance',0.5,'enable_safety_checker',true,'number_of_steps',27);
  INSERT INTO public.fal_dispatch(job_id,endpoint,payload) VALUES(v_job_one,v_quote.provider_endpoint,v_payload),(v_job_two,v_quote.provider_endpoint,v_payload);
  UPDATE public.music_generation_quotes SET consumed_at=now() WHERE id=v_quote.id;
 EXCEPTION WHEN SQLSTATE 'P0001' THEN RETURN COALESCE(v_failure,jsonb_build_object('ok',false,'code','PAIR_DEBIT_FAILED')); END;
 SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance FROM public.credit_balances WHERE user_id=v_user;
 RETURN jsonb_build_object('ok',true,'request_id',v_request.id,'state','debited','job_ids',jsonb_build_array(v_job_one,v_job_two),'balance_after',v_balance);
END $$;
REVOKE ALL ON FUNCTION public.music_submit_replace_pair(TEXT,UUID,UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_submit_replace_pair(TEXT,UUID,UUID,TEXT,TEXT) TO service_role;

