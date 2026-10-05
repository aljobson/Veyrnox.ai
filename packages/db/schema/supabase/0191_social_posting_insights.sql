-- ADR-0061: descriptive posting patterns from stored post counters. One
-- weekly aggregate per account, without exposing tokens or raw tables.
CREATE TABLE IF NOT EXISTS public.social_best_time_cache (
    account_id UUID PRIMARY KEY REFERENCES public.social_accounts(id) ON DELETE CASCADE,
    timezone TEXT NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    heatmap JSONB NOT NULL CHECK (jsonb_typeof(heatmap) = 'array'),
    frequency JSONB NOT NULL CHECK (jsonb_typeof(frequency) = 'array'),
    recorded_posts INTEGER NOT NULL CHECK (recorded_posts >= 0),
    measured_posts INTEGER NOT NULL CHECK (measured_posts >= 0),
    history_days INTEGER NOT NULL CHECK (history_days >= 0),
    computed_at TIMESTAMPTZ NOT NULL,
    CHECK (period_end - period_start = 84)
);
ALTER TABLE public.social_best_time_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_best_time_cache FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_best_time_cache FROM PUBLIC, anon, authenticated, service_role;

-- Only the sweep invokes this, after a successful analytics write. A row
-- lock serializes recomputation; fresh aggregates are a cheap no-op. The
-- original specification's daily snapshots cannot describe publication
-- hours, so use social_analytics_posts. Include every stored post in the
-- frequency count, but scores require numeric likes AND comments, and a
-- post at least 48 hours old. Unknown metrics never become measured zeros.
CREATE OR REPLACE FUNCTION public.refresh_social_posting_insights(
    p_account_id UUID, p_now TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_timezone TEXT;
    v_start DATE;
    v_end DATE;
    v_cache public.social_best_time_cache%ROWTYPE;
BEGIN
    IF p_now IS NULL OR NOT isfinite(p_now) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TIME');
    END IF;
    SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names t WHERE t.name = b.timezone)
                THEN b.timezone ELSE 'UTC' END INTO v_timezone
    FROM public.social_accounts a JOIN public.social_brands b ON b.id = a.brand_id
    WHERE a.id = p_account_id AND a.status = 'active'
    FOR UPDATE OF a;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_NOT_FOUND'); END IF;
    SELECT * INTO v_cache FROM public.social_best_time_cache WHERE account_id = p_account_id;
    IF FOUND AND v_cache.timezone = v_timezone AND v_cache.computed_at <= p_now
        AND v_cache.computed_at > p_now - INTERVAL '7 days' THEN
        RETURN jsonb_build_object('ok', true, 'cached', true);
    END IF;
    v_end := date_trunc('week', p_now AT TIME ZONE v_timezone)::DATE;
    v_start := v_end - 84;

    WITH observed AS (
        SELECT p.published_at, p.published_at AT TIME ZONE v_timezone AS local_time,
            CASE WHEN p.published_at <= p_now - INTERVAL '48 hours'
                AND jsonb_typeof(p.metrics->'likes') = 'number'
                AND jsonb_typeof(p.metrics->'comments') = 'number' THEN
                GREATEST((p.metrics->>'likes')::NUMERIC, 0) + GREATEST((p.metrics->>'comments')::NUMERIC, 0)
                + CASE WHEN jsonb_typeof(p.metrics->'shares') = 'number' THEN GREATEST((p.metrics->>'shares')::NUMERIC, 0) ELSE 0 END
                + CASE WHEN jsonb_typeof(p.metrics->'saves') = 'number' THEN GREATEST((p.metrics->>'saves')::NUMERIC, 0) ELSE 0 END
            END AS interactions
        FROM public.social_analytics_posts p WHERE p.account_id = p_account_id
            AND p.published_at >= (v_start::TIMESTAMP AT TIME ZONE v_timezone)
            AND p.published_at < (v_end::TIMESTAMP AT TIME ZONE v_timezone)
    ), cells AS (
        SELECT extract(isodow FROM local_time)::INTEGER AS day, extract(hour FROM local_time)::INTEGER AS hour,
            count(interactions)::INTEGER AS posts, avg(interactions) AS score
        FROM observed GROUP BY 1, 2
    ), weeks AS (
        SELECT w::DATE AS week, count(o.published_at)::INTEGER AS posts,
            count(o.interactions)::INTEGER AS measured_posts, avg(o.interactions) AS avg_interactions
        FROM generate_series(v_start::TIMESTAMP, (v_end - 7)::TIMESTAMP, INTERVAL '7 days') w
        LEFT JOIN observed o ON date_trunc('week', o.local_time)::DATE = w::DATE
        GROUP BY w
    )
    INSERT INTO public.social_best_time_cache(account_id, timezone, period_start, period_end,
        heatmap, frequency, recorded_posts, measured_posts, history_days, computed_at)
    SELECT p_account_id, v_timezone, v_start, v_end,
        (SELECT jsonb_agg(jsonb_build_object('day', d, 'hour', h, 'posts', COALESCE(c.posts, 0), 'score', c.score) ORDER BY d,h)
         FROM generate_series(1,7) d CROSS JOIN generate_series(0,23) h
         LEFT JOIN cells c ON c.day = d AND c.hour = h),
        (SELECT jsonb_agg(jsonb_build_object('week', week, 'posts', posts, 'measured_posts', measured_posts,
            'avg_interactions', avg_interactions) ORDER BY week) FROM weeks),
        (SELECT count(*) FROM observed), (SELECT count(interactions) FROM observed),
        COALESCE((SELECT max(local_time::DATE) - min(local_time::DATE) FROM observed WHERE interactions IS NOT NULL), 0), p_now
    ON CONFLICT (account_id) DO UPDATE SET timezone = EXCLUDED.timezone, period_start = EXCLUDED.period_start,
        period_end = EXCLUDED.period_end, heatmap = EXCLUDED.heatmap, frequency = EXCLUDED.frequency,
        recorded_posts = EXCLUDED.recorded_posts, measured_posts = EXCLUDED.measured_posts,
        history_days = EXCLUDED.history_days, computed_at = EXCLUDED.computed_at;
    RETURN jsonb_build_object('ok', true, 'cached', false);
END $$;

CREATE OR REPLACE FUNCTION public.get_social_posting_insights(p_auth_id TEXT, p_account_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_user UUID; v_cache public.social_best_time_cache%ROWTYPE;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    SELECT u.id INTO v_user FROM public.users u JOIN auth.users a ON a.id = p_auth_id::UUID WHERE u.auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    IF NOT EXISTS (SELECT 1 FROM public.social_accounts a JOIN public.social_brands b ON b.id = a.brand_id
        WHERE a.id = p_account_id AND b.owner_user_id = v_user) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_NOT_FOUND');
    END IF;
    SELECT * INTO v_cache FROM public.social_best_time_cache WHERE account_id = p_account_id;
    RETURN jsonb_build_object('ok', true, 'insights', CASE WHEN FOUND THEN to_jsonb(v_cache) - 'account_id' ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.refresh_social_posting_insights(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_social_posting_insights(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_social_posting_insights(UUID, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_social_posting_insights(TEXT, UUID) TO service_role;
