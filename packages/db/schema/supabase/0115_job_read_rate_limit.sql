-- Shared per-account quota for job list, status and provenance reads.
-- Deploy the 429-aware gateway before owner-approved application of 0115.
-- One row per user bounds storage. Counters are operational metadata, not money.
CREATE TABLE IF NOT EXISTS public.job_read_rate_limits (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    window_started_at TIMESTAMPTZ NOT NULL,
    request_count INTEGER NOT NULL CHECK (request_count BETWEEN 1 AND 601)
);
ALTER TABLE public.job_read_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_read_rate_limits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_read_rate_limits FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consume_job_read_request(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_start TIMESTAMPTZ;
    v_count INTEGER;
BEGIN
    -- The unique-key conflict serializes simultaneous requests across Workers.
    -- Saturate denied requests at 601: retries neither overflow nor extend the window.
    INSERT INTO public.job_read_rate_limits AS r (user_id, window_started_at, request_count)
    VALUES (p_user_id, v_now, 1)
    ON CONFLICT (user_id) DO UPDATE SET
        window_started_at = CASE WHEN r.window_started_at <= v_now - interval '60 seconds'
            THEN v_now ELSE r.window_started_at END,
        request_count = CASE WHEN r.window_started_at <= v_now - interval '60 seconds'
            THEN 1 ELSE LEAST(r.request_count + 1, 601) END
    RETURNING window_started_at, request_count INTO v_start, v_count;

    IF v_count > 600 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED', 'limit', 600,
            'retry_after_seconds', LEAST(60, GREATEST(1,
                ceil(extract(epoch FROM (v_start + interval '60 seconds' - v_now)))::INTEGER)));
    END IF;
    RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.consume_job_read_request(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_job_read_request(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.get_user_job(
    p_auth_id TEXT,
    p_job_id  UUID
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rate JSONB;
    v_user_id UUID;
    v_row     public.jobs%ROWTYPE;
BEGIN
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    END IF;

    v_rate := public.consume_job_read_request(v_user_id);
    IF v_rate->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_rate; END IF;

    SELECT * INTO v_row FROM public.jobs
    WHERE id = p_job_id AND user_id = v_user_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'state', v_row.state,
        'credits', v_row.credits,
        'model_id', v_row.model_id,
        'provider', v_row.provider,
        'provider_job_id', v_row.provider_job_id,
        'error_code', v_row.error_code,
        'created_at', v_row.created_at,
        'updated_at', v_row.updated_at
    );
END $$;

REVOKE ALL ON FUNCTION public.get_user_job(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_job(TEXT, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.get_user_job(TEXT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_job(TEXT, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.list_user_jobs(
    p_auth_id TEXT,
    p_limit INTEGER DEFAULT 24,
    p_before_created_at TIMESTAMPTZ DEFAULT NULL,
    p_before_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rate JSONB;
    v_user_id UUID;
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 24), 1), 50);
    v_rows JSONB;
BEGIN
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id;
    IF v_user_id IS NULL THEN
        -- An unprovisioned caller has no jobs; same shape as an empty page.
        RETURN jsonb_build_object('ok', true, 'jobs', '[]'::jsonb);
    END IF;

    v_rate := public.consume_job_read_request(v_user_id);
    IF v_rate->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_rate; END IF;

    SELECT COALESCE(jsonb_agg(j ORDER BY j.created_at DESC, j.id DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
        SELECT jsonb_build_object(
                   'job_id', b.id,
                   'state', b.state,
                   'credits', b.credits,
                   'model_id', b.model_id,
                   'error_code', b.error_code,
                   'created_at', b.created_at,
                   'label', left(COALESCE(b.inputs->>'prompt', b.inputs->>'topic', ''), 60),
                   'asset_expires_at', (SELECT min(a.expires_at) FROM public.assets a WHERE a.job_id = b.id),
                   'has_asset', EXISTS (SELECT 1 FROM public.assets a WHERE a.job_id = b.id)
               ) AS j,
               b.created_at,
               b.id
        FROM public.jobs b
        WHERE b.user_id = v_user_id
          AND (p_before_created_at IS NULL
               OR (b.created_at, b.id) < (p_before_created_at, COALESCE(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid)))
        ORDER BY b.created_at DESC, b.id DESC
        LIMIT v_limit
    ) j;

    RETURN jsonb_build_object('ok', true, 'jobs', v_rows);
END $$;

REVOKE ALL ON FUNCTION public.list_user_jobs(TEXT, INTEGER, TIMESTAMPTZ, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_user_jobs(TEXT, INTEGER, TIMESTAMPTZ, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.list_user_jobs(TEXT, INTEGER, TIMESTAMPTZ, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.list_user_jobs(TEXT, INTEGER, TIMESTAMPTZ, UUID) TO service_role;

