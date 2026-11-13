-- Paid two-stem archive extraction. Mureka audio-separation-3 returns a ZIP
-- containing vocals and instrumental audio. The catalog row stays inactive
-- until one billed live run proves the archive bytes, MIME and observed cost.

INSERT INTO public.model_catalog
    (id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,
     cost_unit,billing_seconds,gated_flag,active)
VALUES
    ('mureka-stems-v3','Mureka Vocals + Instrumental Stems','fal',
     'mureka/api/song/stem','audio-to-audio',13,0.2000,
     'per_generation',NULL,false,false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.music_stem_quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    song_id UUID NOT NULL,
    source_version_id UUID NOT NULL,
    model_id TEXT NOT NULL REFERENCES public.model_catalog(id) ON DELETE RESTRICT,
    provider_endpoint TEXT NOT NULL CHECK (provider_endpoint='mureka/api/song/stem'),
    unit_credits INTEGER NOT NULL CHECK (unit_credits>0),
    catalog_updated_at TIMESTAMPTZ NOT NULL,
    source_rights_version TEXT NOT NULL CHECK (source_rights_version='music-stem-source-rights-v1'),
    expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at>created_at),
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT music_stem_quotes_song_owner_fk FOREIGN KEY(song_id,user_id)
        REFERENCES public.music_songs(id,user_id) ON DELETE RESTRICT,
    CONSTRAINT music_stem_quotes_version_owner_fk FOREIGN KEY(source_version_id,user_id,song_id)
        REFERENCES public.music_song_versions(id,user_id,song_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS music_stem_quotes_user_created_idx
    ON public.music_stem_quotes(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.music_stem_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    quote_id UUID NOT NULL UNIQUE REFERENCES public.music_stem_quotes(id) ON DELETE RESTRICT,
    song_id UUID NOT NULL,
    source_version_id UUID NOT NULL,
    job_id UUID NOT NULL UNIQUE REFERENCES public.jobs(id) ON DELETE RESTRICT,
    model_id TEXT NOT NULL REFERENCES public.model_catalog(id) ON DELETE RESTRICT,
    credit_quote INTEGER NOT NULL CHECK (credit_quote>0),
    idempotency_key TEXT NOT NULL CHECK (idempotency_key~'^[A-Za-z0-9._-]{8,120}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id,idempotency_key),
    CONSTRAINT music_stem_requests_song_owner_fk FOREIGN KEY(song_id,user_id)
        REFERENCES public.music_songs(id,user_id) ON DELETE RESTRICT,
    CONSTRAINT music_stem_requests_version_owner_fk FOREIGN KEY(source_version_id,user_id,song_id)
        REFERENCES public.music_song_versions(id,user_id,song_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS music_stem_requests_user_created_idx
    ON public.music_stem_requests(user_id,created_at DESC);

DO $$ DECLARE t TEXT; BEGIN
    FOREACH t IN ARRAY ARRAY['music_stem_quotes','music_stem_requests'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',t||'_owner_read',t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (private.music_owns_user(user_id))',t||'_owner_read',t);
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',t);
        EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated',t);
        EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.%I TO service_role',t);
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.music_get_stem_source_context(
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
      AND s.current_version_id=p_version_id AND a.mime_type IN ('audio/mpeg','audio/mp3')
      AND a.size_bytes<=10485760;
    RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','FORMAT_UNAVAILABLE'));
END $$;

CREATE OR REPLACE FUNCTION public.music_create_stem_quote(
    p_auth_id TEXT,p_song_id UUID,p_version_id UUID,p_rights_confirmed BOOLEAN
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    v_user UUID; v_model public.model_catalog%ROWTYPE; v_quote public.music_stem_quotes%ROWTYPE;
    v_balance INTEGER;
BEGIN
    IF p_song_id IS NULL OR p_version_id IS NULL OR p_rights_confirmed IS DISTINCT FROM true THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
    IF NOT private.music_paid_plan_active(v_user) THEN RETURN jsonb_build_object('ok',false,'code','PLAN_UNAVAILABLE'); END IF;
    IF NOT EXISTS(SELECT 1 FROM public.music_songs s
        JOIN public.music_song_versions v ON v.id=p_version_id AND v.user_id=v_user AND v.song_id=s.id
        JOIN public.assets a ON a.id=v.audio_asset_id
        WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active'
          AND s.current_version_id=p_version_id AND a.mime_type IN ('audio/mpeg','audio/mp3')
          AND a.size_bytes<=10485760 FOR SHARE OF s,v,a) THEN
        RETURN jsonb_build_object('ok',false,'code','FORMAT_UNAVAILABLE');
    END IF;
    IF (SELECT count(*) FROM public.music_stem_quotes
        WHERE user_id=v_user AND created_at>now()-interval '60 seconds')>=10 THEN
        RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED','retry_after_seconds',60);
    END IF;
    SELECT * INTO v_model FROM public.model_catalog WHERE id='mureka-stems-v3';
    IF NOT FOUND OR NOT v_model.active OR v_model.gated_flag OR v_model.provider<>'fal'
       OR v_model.provider_endpoint<>'mureka/api/song/stem' OR v_model.modality<>'audio-to-audio'
       OR v_model.credits_5s<>13 OR v_model.provider_cost_per_unit<>0.2000::numeric
       OR v_model.cost_unit<>'per_generation' OR v_model.billing_seconds IS NOT NULL THEN
        RETURN jsonb_build_object('ok',false,'code','MODEL_UNAVAILABLE');
    END IF;
    SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END
    INTO v_balance FROM public.credit_balances WHERE user_id=v_user;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NO_BALANCE_ROW'); END IF;
    INSERT INTO public.music_stem_quotes(user_id,song_id,source_version_id,model_id,
        provider_endpoint,unit_credits,catalog_updated_at,source_rights_version,expires_at)
    VALUES(v_user,p_song_id,p_version_id,v_model.id,v_model.provider_endpoint,v_model.credits_5s,
        v_model.updated_at,'music-stem-source-rights-v1',now()+interval '5 minutes')
    RETURNING * INTO v_quote;
    RETURN jsonb_build_object('ok',true,'quote_id',v_quote.id,'model_id',v_quote.model_id,
        'total_credits',v_quote.unit_credits,'balance',v_balance,
        'balance_after',v_balance-v_quote.unit_credits,'affordable',v_balance>=v_quote.unit_credits,
        'expires_at',v_quote.expires_at,'outputs',jsonb_build_array('vocals','instrumental'));
END $$;

CREATE OR REPLACE FUNCTION public.music_get_stem_dispatch_context(
    p_auth_id TEXT,p_song_id UUID,p_quote_id UUID,p_idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_existing public.music_stem_requests%ROWTYPE; v_quote public.music_stem_quotes%ROWTYPE; v_row JSONB;
BEGIN
    IF p_idempotency_key!~'^[A-Za-z0-9._-]{8,120}$' THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    SELECT * INTO v_existing FROM public.music_stem_requests
    WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
    IF FOUND THEN
        IF v_existing.quote_id IS DISTINCT FROM p_quote_id THEN
            RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');
        END IF;
        RETURN jsonb_build_object('ok',true,'idempotent',true,'request_id',v_existing.id,'job_id',v_existing.job_id);
    END IF;
    SELECT * INTO v_quote FROM public.music_stem_quotes
    WHERE id=p_quote_id AND user_id=v_user AND song_id=p_song_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    SELECT jsonb_build_object('ok',true,'idempotent',false,'r2_key',a.r2_key,'mime_type',a.mime_type)
    INTO v_row FROM public.music_songs s
    JOIN public.music_song_versions v ON v.id=v_quote.source_version_id AND v.user_id=v_user AND v.song_id=s.id
    JOIN public.assets a ON a.id=v.audio_asset_id
    WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active'
      AND s.current_version_id=v_quote.source_version_id AND a.mime_type IN ('audio/mpeg','audio/mp3')
      AND a.size_bytes<=10485760;
    RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','REVISION_CONFLICT'));
END $$;

CREATE OR REPLACE FUNCTION public.music_submit_stem_request(
    p_auth_id TEXT,p_song_id UUID,p_quote_id UUID,p_idempotency_key TEXT,p_source_audio_url TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    v_user UUID; v_balance INTEGER; v_active INTEGER; v_quote public.music_stem_quotes%ROWTYPE;
    v_model public.model_catalog%ROWTYPE; v_existing public.music_stem_requests%ROWTYPE;
    v_request public.music_stem_requests%ROWTYPE; v_debit JSONB; v_job UUID;
BEGIN
    IF p_song_id IS NULL OR p_quote_id IS NULL OR p_idempotency_key!~'^[A-Za-z0-9._-]{8,120}$'
       OR p_source_audio_url IS NULL OR p_source_audio_url!~'^https://[^[:space:]]{1,2000}$' THEN
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
    WHERE r.user_id=v_user AND j.state IN ('CREATED','SUBMITTED','SUCCEEDED');
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

CREATE OR REPLACE FUNCTION public.music_get_stem_request(p_auth_id TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_row JSONB;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    SELECT jsonb_build_object('id',r.id,'song_id',r.song_id,'source_version_id',r.source_version_id,
        'job_id',r.job_id,'model_id',r.model_id,'credits',r.credit_quote,'created_at',r.created_at,
        'state',CASE WHEN a.id IS NOT NULL AND j.state='STORED' THEN 'ready'
            WHEN j.state='REFUNDED' THEN 'refunded' WHEN j.state='FAILED' THEN 'failed'
            WHEN j.state IN ('SUBMITTED','SUCCEEDED') THEN 'running' ELSE 'queued' END,
        'archive_url',CASE WHEN a.id IS NOT NULL AND j.state='STORED'
            THEN '/api/v1/music/stem-requests/'||r.id||'/archive' END)
    INTO v_row FROM public.music_stem_requests r JOIN public.jobs j ON j.id=r.job_id
    LEFT JOIN public.assets a ON a.job_id=j.id AND a.mime_type='application/zip'
    WHERE r.id=p_request_id AND r.user_id=v_user;
    IF v_row IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    RETURN jsonb_build_object('ok',true,'request',v_row);
END $$;

CREATE OR REPLACE FUNCTION public.music_get_stem_archive_context(p_auth_id TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_row JSONB;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
    SELECT jsonb_build_object('ok',true,'r2_key',a.r2_key,'mime_type',a.mime_type,
        'size_bytes',a.size_bytes,'song_id',r.song_id)
    INTO v_row FROM public.music_stem_requests r JOIN public.jobs j ON j.id=r.job_id AND j.state='STORED'
    JOIN public.assets a ON a.job_id=j.id AND a.mime_type='application/zip'
    WHERE r.id=p_request_id AND r.user_id=v_user;
    RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','NOT_FOUND'));
END $$;

REVOKE ALL ON FUNCTION public.music_get_stem_source_context(TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_create_stem_quote(TEXT,UUID,UUID,BOOLEAN) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_get_stem_dispatch_context(TEXT,UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_submit_stem_request(TEXT,UUID,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_get_stem_request(TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_get_stem_archive_context(TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_stem_source_context(TEXT,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_create_stem_quote(TEXT,UUID,UUID,BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_get_stem_dispatch_context(TEXT,UUID,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_submit_stem_request(TEXT,UUID,UUID,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_get_stem_request(TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_get_stem_archive_context(TEXT,UUID) TO service_role;
