-- Bound pre-debit media work even when rejected requests create no jobs.
-- Keep the existing RPC signature and RATE_LIMITED response for staged rollout:
-- approval/application of this migration activates the limit in the current app.
CREATE TABLE IF NOT EXISTS public.generation_attempt_rate_limits (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    window_started_at TIMESTAMPTZ NOT NULL,
    request_count INTEGER NOT NULL CHECK (request_count BETWEEN 1 AND 21)
);
ALTER TABLE public.generation_attempt_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generation_attempt_rate_limits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.generation_attempt_rate_limits FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.check_generation_rate_limit(
    p_auth_id TEXT,
    p_limit_per_window INTEGER,
    p_window_seconds INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_count INTEGER;
    v_reset_seconds INTEGER;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_attempt_count INTEGER;
    v_start TIMESTAMPTZ;
BEGIN
    IF p_limit_per_window IS NULL OR p_limit_per_window <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BAD_LIMIT');
    END IF;
    IF p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BAD_WINDOW');
    END IF;
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    -- Count attempts even when later source checks or pricing reject them and
    -- no job is created. One row lock serializes requests across Workers.
    INSERT INTO public.generation_attempt_rate_limits AS r (user_id, window_started_at, request_count)
    VALUES (v_user_id, v_now, 1)
    ON CONFLICT (user_id) DO UPDATE SET
        window_started_at = CASE WHEN r.window_started_at <= v_now - interval '60 seconds'
            THEN v_now ELSE r.window_started_at END,
        request_count = CASE WHEN r.window_started_at <= v_now - interval '60 seconds'
            THEN 1 ELSE LEAST(r.request_count + 1, 21) END
    RETURNING window_started_at, request_count INTO v_start, v_attempt_count;
    IF v_attempt_count > 20 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED',
            'count', v_attempt_count, 'limit', 20,
            'retry_after_seconds', LEAST(60, GREATEST(1,
                ceil(extract(epoch FROM (v_start + interval '60 seconds' - v_now)))::INTEGER)));
    END IF;

    SELECT count(*) INTO v_count FROM public.jobs
    WHERE user_id = v_user_id
      AND created_at > now() - make_interval(secs => p_window_seconds);
    IF v_count >= p_limit_per_window THEN
        SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
            MIN(created_at) + make_interval(secs => p_window_seconds) - now()
        ))))::int INTO v_reset_seconds
        FROM public.jobs
        WHERE user_id = v_user_id
          AND created_at > now() - make_interval(secs => p_window_seconds);
        RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED',
                                   'count', v_count, 'limit', p_limit_per_window,
                                   'retry_after_seconds', COALESCE(v_reset_seconds, p_window_seconds));
    END IF;
    RETURN jsonb_build_object('ok', true, 'count', v_count, 'limit', p_limit_per_window);
END $$;

REVOKE ALL ON FUNCTION public.check_generation_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_generation_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;
