-- Slice 6 — per-user request rate limit on generation submissions.
--
-- Sliding-window count against the jobs table: how many jobs has this
-- auth_id submitted in the last N seconds? If over the limit, reject.
-- No dedicated rate-limit table; the jobs.created_at index covers this.
--
-- Called from POST /api/v1/generations before ledger_debit — a rejected
-- request never moves credits. Idempotency guard in ledger_debit means a
-- rejected request that's later retried with the same idempotency_key
-- inside the window is still rate-limited (correct).

CREATE OR REPLACE FUNCTION public.check_generation_rate_limit(
    p_auth_id TEXT,
    p_limit_per_window INTEGER,
    p_window_seconds INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
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
        -- No user row = webhook hasn't landed. Reject at the rate-limit
        -- gate so we don't create a jobs row against a phantom user.
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;

    SELECT count(*) INTO v_count FROM public.jobs
    WHERE user_id = v_user_id
      AND created_at > now() - make_interval(secs => p_window_seconds);

    IF v_count >= p_limit_per_window THEN
        -- Retry-After hint: seconds until the oldest hit inside the
        -- window falls out. Conservative; caller can round up.
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
