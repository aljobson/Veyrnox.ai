-- Security audit 2026-09-11, M3: the rate-limit check counted jobs without a
-- lock, so N parallel requests at count = limit-1 all passed. Serialise per
-- user with a transaction-scoped advisory lock. The function was STABLE; a
-- lock is a side effect, so it becomes VOLATILE (the default).
--
-- Idempotent: CREATE OR REPLACE with the same signature.

CREATE OR REPLACE FUNCTION public.check_generation_rate_limit(
    p_auth_id TEXT,
    p_limit_per_window INTEGER,
    p_window_seconds INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_count INTEGER;
    v_reset_seconds INTEGER;
BEGIN
    IF p_limit_per_window IS NULL OR p_limit_per_window <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BAD_LIMIT');
    END IF;

    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;

    -- One submission path per user at a time. Held until the caller's
    -- transaction ends (PostgREST wraps each RPC in its own transaction).
    PERFORM pg_advisory_xact_lock(hashtext('generation_rate_limit:' || v_user_id::text));

    SELECT count(*) INTO v_count FROM public.jobs
    WHERE user_id = v_user_id
      AND created_at > now() - make_interval(secs => p_window_seconds);

    IF v_count >= p_limit_per_window THEN
        SELECT GREATEST(
            1,
            CEIL(EXTRACT(EPOCH FROM (
                MIN(created_at) + make_interval(secs => p_window_seconds) - now()
            )))
        )::int INTO v_reset_seconds
        FROM public.jobs
        WHERE user_id = v_user_id
          AND created_at > now() - make_interval(secs => p_window_seconds);

        RETURN jsonb_build_object(
            'ok', false,
            'code', 'RATE_LIMITED',
            'count', v_count,
            'limit', p_limit_per_window,
            'retry_after_seconds', COALESCE(v_reset_seconds, p_window_seconds)
        );
    END IF;

    RETURN jsonb_build_object('ok', true, 'count', v_count, 'limit', p_limit_per_window);
END $$;

REVOKE ALL ON FUNCTION public.check_generation_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_generation_rate_limit(TEXT, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.check_generation_rate_limit(TEXT, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_generation_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;
