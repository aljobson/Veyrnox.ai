-- 0505: every active Credit Subscription covers Audio downloads (owner, 2026-11-14).
--
-- music_quote_audio_export (0467) knew only starter-monthly, plus-monthly and
-- ultra-monthly. Any other active plan (lite-monthly, the four yearly plans) got an
-- allowance of 0 and PLAN_UNAVAILABLE, while a non-subscriber got 7.
--
-- Now: Starter 20, Plus 60, Ultra 60 for the monthly and the yearly plan alike, and
-- 7 for any other active plan, so paying is never worse than not paying. For a
-- yearly plan the allowance is per monthly cycle, the same cycle its credits follow
-- (0383: cycle_anchor), not per year. A monthly plan keeps its period key, so
-- periods and claims already recorded are untouched. Nothing here moves credits.
--
-- Idempotent: OR REPLACE, explicit revoke and grant. The body is otherwise 0467's.

CREATE OR REPLACE FUNCTION public.music_quote_audio_export(
    p_auth_id TEXT, p_song_id UUID, p_version_id UUID, p_format TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID; v_asset public.assets%ROWTYPE; v_sub public.credit_subscriptions%ROWTYPE;
    v_period public.music_download_periods%ROWTYPE; v_quote public.music_export_quotes%ROWTYPE;
    v_period_key TEXT; v_kind TEXT; v_allowance INTEGER; v_used INTEGER; v_claimed BOOLEAN;
    v_cycle INTEGER; v_starts TIMESTAMPTZ; v_expires TIMESTAMPTZ;
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
