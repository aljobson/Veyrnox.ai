-- 0503: Stems and Target stems could never be submitted.
-- Both submit functions count in-flight jobs with j.state IN ('CREATED',...).
-- public.job_state has no CREATED label (PRICED, DEBITED, SUBMITTED, SUCCEEDED,
-- FAILOVER, FAILED, REFUNDED, STORED), so the first execution raised 22P02 before
-- any debit. ledger_debit creates a job as DEBITED, which is the state the count
-- means. Bodies are otherwise unchanged from 0501. Idempotent.

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
    SELECT count(*) INTO v_active FROM public.music_stem_requests r JOIN public.jobs j ON j.id=r.job_id
    WHERE r.user_id=v_user AND j.state IN ('DEBITED','SUBMITTED','SUCCEEDED');
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
REVOKE ALL ON FUNCTION public.music_submit_target_stem_request(TEXT,UUID,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_submit_target_stem_request(TEXT,UUID,UUID,TEXT,TEXT) TO service_role;
