-- Exact-format Music downloads. WAV is available only when the immutable
-- source asset is already WAV; this migration does not transcode audio.

ALTER TABLE public.music_export_quotes
    DROP CONSTRAINT IF EXISTS music_export_quotes_format_check;
ALTER TABLE public.music_export_quotes
    ADD CONSTRAINT music_export_quotes_format_check
    CHECK (format IN ('mp3','wav'));

CREATE OR REPLACE FUNCTION public.music_quote_audio_export(
    p_auth_id TEXT, p_song_id UUID, p_version_id UUID, p_format TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID; v_asset public.assets%ROWTYPE; v_sub public.credit_subscriptions%ROWTYPE;
    v_period public.music_download_periods%ROWTYPE; v_quote public.music_export_quotes%ROWTYPE;
    v_period_key TEXT; v_kind TEXT; v_allowance INTEGER; v_used INTEGER; v_claimed BOOLEAN;
BEGIN
    IF p_format IS NULL OR p_format NOT IN ('mp3','wav') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    SELECT a.* INTO v_asset
    FROM public.music_song_versions v JOIN public.assets a ON a.id = v.audio_asset_id
    WHERE v.id = p_version_id AND v.user_id = v_user AND v.song_id = p_song_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    IF (p_format = 'mp3' AND lower(v_asset.mime_type) NOT IN ('audio/mpeg','audio/mp3'))
       OR (p_format = 'wav' AND lower(v_asset.mime_type) NOT IN ('audio/wav','audio/x-wav','audio/wave')) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'FORMAT_UNAVAILABLE');
    END IF;

    SELECT * INTO v_sub FROM public.credit_subscriptions
    WHERE user_id = v_user AND status = 'active' AND current_period_end > now()
    ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
        v_period_key := 'subscription:' || v_sub.id::text || ':' || extract(epoch from v_sub.current_period_end)::bigint::text;
        v_kind := 'paid_month';
        v_allowance := CASE v_sub.plan_id
            WHEN 'starter-monthly' THEN 20
            WHEN 'plus-monthly' THEN 60
            WHEN 'ultra-monthly' THEN 60
            ELSE 0
        END;
        IF v_allowance = 0 THEN
            RETURN jsonb_build_object('ok', false, 'code', 'PLAN_UNAVAILABLE');
        END IF;
        INSERT INTO public.music_download_periods(user_id, period_key, kind, allowance, starts_at, expires_at)
        VALUES (v_user, v_period_key, v_kind, v_allowance,
            COALESCE(v_sub.started_at, v_sub.created_at), v_sub.current_period_end)
        ON CONFLICT (user_id, period_key) DO NOTHING;
    ELSE
        v_period_key := 'free-trial'; v_kind := 'free_trial'; v_allowance := 7;
        INSERT INTO public.music_download_periods(user_id, period_key, kind, allowance, starts_at, expires_at)
        VALUES (v_user, v_period_key, v_kind, v_allowance, now(), NULL)
        ON CONFLICT (user_id, period_key) DO NOTHING;
    END IF;
    SELECT * INTO v_period FROM public.music_download_periods
    WHERE user_id = v_user AND period_key = v_period_key FOR UPDATE;
    SELECT count(*) INTO v_used FROM public.music_download_claims WHERE period_id = v_period.id;
    SELECT EXISTS(SELECT 1 FROM public.music_download_claims
        WHERE period_id = v_period.id AND song_version_id = p_version_id) INTO v_claimed;
    IF NOT v_claimed AND v_used >= v_period.allowance THEN
        RETURN jsonb_build_object('ok', false, 'code', 'DOWNLOAD_ALLOWANCE_EXHAUSTED');
    END IF;
    INSERT INTO public.music_export_quotes(
        user_id, song_id, song_version_id, period_id, format, consumes_allowance, expires_at
    ) VALUES (v_user, p_song_id, p_version_id, v_period.id, p_format, NOT v_claimed, now() + interval '5 minutes')
    RETURNING * INTO v_quote;
    RETURN jsonb_build_object('ok', true, 'quote', jsonb_build_object(
        'id', v_quote.id, 'format', v_quote.format, 'consumes_allowance', v_quote.consumes_allowance,
        'allowance', v_period.allowance, 'used', v_used,
        'remaining_after', v_period.allowance - v_used - CASE WHEN v_claimed THEN 0 ELSE 1 END,
        'expires_at', v_quote.expires_at));
END $$;

CREATE OR REPLACE FUNCTION public.music_start_audio_export(
    p_auth_id TEXT, p_quote_id UUID, p_idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID; v_quote public.music_export_quotes%ROWTYPE;
    v_attempt public.music_export_attempts%ROWTYPE; v_period public.music_download_periods%ROWTYPE;
    v_version public.music_song_versions%ROWTYPE; v_used INTEGER; v_claimed BOOLEAN;
BEGIN
    IF p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id FOR UPDATE;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    SELECT * INTO v_attempt FROM public.music_export_attempts
    WHERE user_id = v_user AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_attempt.quote_id IS DISTINCT FROM p_quote_id THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
        END IF;
        SELECT p.* INTO v_period
        FROM public.music_export_quotes q
        JOIN public.music_download_periods p ON p.id = q.period_id
        WHERE q.id = v_attempt.quote_id AND q.user_id = v_user;
        SELECT count(*) INTO v_used FROM public.music_download_claims WHERE period_id = v_period.id;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'export_id', v_attempt.id,
            'state', v_attempt.state, 'allowance', v_period.allowance,
            'used', v_used, 'remaining', v_period.allowance - v_used);
    END IF;
    SELECT * INTO v_quote FROM public.music_export_quotes
    WHERE id = p_quote_id AND user_id = v_user;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    IF v_quote.expires_at <= now() THEN RETURN jsonb_build_object('ok', false, 'code', 'QUOTE_EXPIRED'); END IF;
    SELECT * INTO v_period FROM public.music_download_periods WHERE id = v_quote.period_id FOR UPDATE;
    IF v_period.expires_at IS NOT NULL AND v_period.expires_at <= now() THEN
        RETURN jsonb_build_object('ok', false, 'code', 'QUOTE_EXPIRED');
    END IF;
    SELECT EXISTS(SELECT 1 FROM public.music_download_claims
        WHERE period_id = v_period.id AND song_version_id = v_quote.song_version_id) INTO v_claimed;
    SELECT count(*) INTO v_used FROM public.music_download_claims WHERE period_id = v_period.id;
    IF NOT v_claimed AND v_used >= v_period.allowance THEN
        RETURN jsonb_build_object('ok', false, 'code', 'DOWNLOAD_ALLOWANCE_EXHAUSTED');
    END IF;
    IF NOT v_claimed THEN
        INSERT INTO public.music_download_claims(user_id, period_id, song_version_id)
        VALUES (v_user, v_period.id, v_quote.song_version_id);
        v_used := v_used + 1;
    END IF;
    SELECT * INTO v_version FROM public.music_song_versions
    WHERE id = v_quote.song_version_id AND user_id = v_user;
    INSERT INTO public.music_export_attempts(
        user_id, quote_id, song_version_id, job_id, idempotency_key, state
    ) VALUES (v_user, v_quote.id, v_quote.song_version_id, v_version.job_id, p_idempotency_key, 'ready')
    RETURNING * INTO v_attempt;
    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'export_id', v_attempt.id,
        'state', v_attempt.state, 'allowance', v_period.allowance,
        'used', v_used, 'remaining', v_period.allowance - v_used);
END $$;

CREATE OR REPLACE FUNCTION public.music_get_export(p_auth_id TEXT, p_export_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_row RECORD;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    SELECT e.id, e.state, e.job_id, q.format, a.r2_key, a.mime_type, a.size_bytes
    INTO v_row
    FROM public.music_export_attempts e
    JOIN public.music_export_quotes q ON q.id = e.quote_id AND q.user_id = e.user_id
    JOIN public.music_song_versions v ON v.id = e.song_version_id AND v.user_id = e.user_id
    JOIN public.assets a ON a.id = v.audio_asset_id
    WHERE e.id = p_export_id AND e.user_id = v_user;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    RETURN jsonb_build_object('ok', true, 'export', jsonb_build_object(
        'id', v_row.id, 'state', v_row.state, 'job_id', v_row.job_id,
        'format', v_row.format, 'r2_key', v_row.r2_key,
        'mime_type', v_row.mime_type, 'size_bytes', v_row.size_bytes));
END $$;

REVOKE ALL ON FUNCTION public.music_quote_audio_export(TEXT,UUID,UUID,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.music_start_audio_export(TEXT,UUID,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.music_get_export(TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_quote_audio_export(TEXT,UUID,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_start_audio_export(TEXT,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_get_export(TEXT,UUID) TO service_role;
