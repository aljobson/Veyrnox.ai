-- 0506: songs stored as FLAC can be downloaded as FLAC.
--
-- fal-ai/ace-step-1.5 returns FLAC and has no input to choose a format (seen live
-- on staging, 2026-11-14: both files stored as audio/flac). The export quote
-- accepted only 'mp3' for an MP3 asset and 'wav' for a WAV asset, so every
-- ACE-Step 1.5 song answered FORMAT_UNAVAILABLE for both and could not be
-- downloaded at all.
--
-- 'flac' is now a third format, offered only when the stored asset is FLAC. As
-- with MP3 and WAV, the stored file is handed over as it is: nothing is
-- transcoded or relabelled. Editing gates are unchanged, so a FLAC version still
-- cannot be used as an editing source. The body is otherwise 0505's.
--
-- Idempotent: DROP IF EXISTS before ADD, OR REPLACE, explicit revoke and grant.
-- The previous Worker release never sends 'flac', so it keeps working.

ALTER TABLE public.music_export_quotes
    DROP CONSTRAINT IF EXISTS music_export_quotes_format_check;
ALTER TABLE public.music_export_quotes
    ADD CONSTRAINT music_export_quotes_format_check
    CHECK (format IN ('mp3','wav','flac'));

CREATE OR REPLACE FUNCTION public.music_quote_audio_export(
    p_auth_id TEXT, p_song_id UUID, p_version_id UUID, p_format TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID; v_asset public.assets%ROWTYPE; v_sub public.credit_subscriptions%ROWTYPE;
    v_period public.music_download_periods%ROWTYPE; v_quote public.music_export_quotes%ROWTYPE;
    v_period_key TEXT; v_kind TEXT; v_allowance INTEGER; v_used INTEGER; v_claimed BOOLEAN;
    v_cycle INTEGER; v_starts TIMESTAMPTZ; v_expires TIMESTAMPTZ;
BEGIN
    IF p_format IS NULL OR p_format NOT IN ('mp3','wav','flac') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    SELECT a.* INTO v_asset
    FROM public.music_song_versions v JOIN public.assets a ON a.id = v.audio_asset_id
    WHERE v.id = p_version_id AND v.user_id = v_user AND v.song_id = p_song_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    IF (p_format = 'mp3' AND lower(v_asset.mime_type) NOT IN ('audio/mpeg','audio/mp3'))
       OR (p_format = 'wav' AND lower(v_asset.mime_type) NOT IN ('audio/wav','audio/x-wav','audio/wave'))
       OR (p_format = 'flac' AND lower(v_asset.mime_type) NOT IN ('audio/flac','audio/x-flac')) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'FORMAT_UNAVAILABLE');
    END IF;

    SELECT * INTO v_sub FROM public.credit_subscriptions
    WHERE user_id = v_user AND status = 'active' AND current_period_end > now()
    ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
        v_kind := 'paid_month';
        -- Every active Credit Subscription covers Audio. A yearly plan gets its monthly
        -- tier's figure; any other plan gets at least the 7 a non-subscriber has.
        v_allowance := CASE v_sub.plan_id
            WHEN 'starter-monthly' THEN 20 WHEN 'starter-yearly' THEN 20
            WHEN 'plus-monthly' THEN 60 WHEN 'plus-yearly' THEN 60
            WHEN 'ultra-monthly' THEN 60 WHEN 'ultra-yearly' THEN 60
            ELSE 7
        END;
        IF v_sub.cycle_anchor IS NOT NULL AND v_sub.cycle_anchor <= now() AND EXISTS(
            SELECT 1 FROM public.credit_subscription_plans p
            WHERE p.id = v_sub.plan_id AND p.billing_interval = 'year') THEN
            -- Yearly: the allowance follows the monthly cycle the credits use (0383):
            -- cycle k runs from anchor + (k - 1) months to anchor + k months, k = 1..12.
            v_cycle := LEAST(12, 1 + (extract(year FROM age(now(), v_sub.cycle_anchor))::INTEGER * 12)
                + extract(month FROM age(now(), v_sub.cycle_anchor))::INTEGER);
            v_starts := v_sub.cycle_anchor + make_interval(months => v_cycle - 1);
            v_expires := LEAST(v_sub.cycle_anchor + make_interval(months => v_cycle), v_sub.current_period_end);
            -- Past month 12 but still active (a late renewal): the last cycle runs to the period end.
            IF v_expires <= now() THEN v_expires := v_sub.current_period_end; END IF;
            v_period_key := 'subscription:' || v_sub.id::text || ':cycle:'
                || extract(epoch from v_sub.cycle_anchor)::bigint::text || ':' || v_cycle::text;
        ELSE
            v_starts := COALESCE(v_sub.started_at, v_sub.created_at);
            v_expires := v_sub.current_period_end;
            v_period_key := 'subscription:' || v_sub.id::text || ':' || extract(epoch from v_sub.current_period_end)::bigint::text;
        END IF;
        INSERT INTO public.music_download_periods(user_id, period_key, kind, allowance, starts_at, expires_at)
        VALUES (v_user, v_period_key, v_kind, v_allowance, v_starts, v_expires)
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
REVOKE ALL ON FUNCTION public.music_quote_audio_export(TEXT,UUID,UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_quote_audio_export(TEXT,UUID,UUID,TEXT) TO service_role;
