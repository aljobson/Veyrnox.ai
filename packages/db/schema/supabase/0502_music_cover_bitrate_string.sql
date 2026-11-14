-- 0502: Cover was refused by the provider on every job (HTTP 422).
-- fal-ai/stable-audio-3/small/music/audio-to-audio defines bitrate as a string
-- (default '192k'); 0479 sent the number 192, so each job failed and was refunded.
-- The function body is otherwise unchanged from 0501. Idempotent.

CREATE OR REPLACE FUNCTION public.music_submit_cover_pair(
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
    WHERE id=v_quote.prompt_spec_id AND user_id=v_user AND mode='cover'
      AND source_song_id=p_song_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_STALE'); END IF;
    IF NOT EXISTS(SELECT 1 FROM public.music_songs s WHERE s.id=p_song_id AND s.user_id=v_user
        AND s.status='active' AND s.current_version_id=v_prompt.source_version_id FOR SHARE) THEN
        RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT');
    END IF;
    SELECT * INTO v_model FROM public.model_catalog WHERE id=v_quote.model_id FOR SHARE;
    IF NOT FOUND OR NOT v_model.active OR v_model.gated_flag OR v_model.provider<>'fal'
       OR v_model.modality<>'audio-to-audio' OR v_model.id<>'stable-audio-3-cover'
       OR v_model.provider_endpoint<>'fal-ai/stable-audio-3/small/music/audio-to-audio'
       OR v_model.provider_endpoint<>v_quote.provider_endpoint OR v_model.credits_5s<>v_quote.unit_credits
       OR v_model.provider_cost_per_unit<>0.0248::numeric OR v_model.cost_unit<>'per_generation'
       OR v_model.updated_at IS DISTINCT FROM v_quote.catalog_updated_at THEN
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
            RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='music cover debit one refused'; END IF;
        v_two:=public.ledger_debit(v_user,p_idempotency_key||'.2',v_quote.unit_credits,
            'debit:music_generation',v_model.id,jsonb_build_object('prompt',v_prompt.prompt,
            'music_request_id',v_request.id,'music_candidate_ordinal',2),0,120);
        IF v_two->>'ok' IS DISTINCT FROM 'true' THEN v_failure:=v_two;
            RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='music cover debit two refused'; END IF;
        v_job_one:=(v_one->>'job_id')::uuid; v_job_two:=(v_two->>'job_id')::uuid;
        INSERT INTO public.music_generation_candidates(user_id,generation_request_id,ordinal,job_id)
        VALUES(v_user,v_request.id,1,v_job_one),(v_user,v_request.id,2,v_job_two);
        v_payload:=jsonb_build_object('prompt',v_prompt.prompt,'audio_url',p_source_audio_url,
            'duration',v_prompt.source_duration_seconds,
            'init_noise_level',round(1-v_prompt.source_influence::numeric/100,2),
            'num_inference_steps',8,'guidance_scale',1,'enable_safety_checker',true,
            'output_format','mp3','bitrate','192k');
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
REVOKE ALL ON FUNCTION public.music_submit_cover_pair(TEXT,UUID,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_submit_cover_pair(TEXT,UUID,UUID,TEXT,TEXT) TO service_role;
