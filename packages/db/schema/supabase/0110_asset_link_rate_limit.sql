-- Per-account, fixed 60-second window for signed asset-link requests.
-- One row per user bounds storage. Counters are operational metadata, not money.
CREATE TABLE IF NOT EXISTS public.asset_link_rate_limits (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    window_started_at TIMESTAMPTZ NOT NULL,
    request_count INTEGER NOT NULL CHECK (request_count BETWEEN 1 AND 121)
);
ALTER TABLE public.asset_link_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_link_rate_limits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.asset_link_rate_limits FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consume_asset_link_request(p_auth_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_start TIMESTAMPTZ;
    v_count INTEGER;
BEGIN
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    END IF;

    -- The unique-key conflict serializes simultaneous requests across Workers.
    -- Saturate denied requests at 121: retries neither overflow nor extend the window.
    INSERT INTO public.asset_link_rate_limits AS r (user_id, window_started_at, request_count)
    VALUES (v_user_id, v_now, 1)
    ON CONFLICT (user_id) DO UPDATE SET
        window_started_at = CASE WHEN r.window_started_at <= v_now - interval '60 seconds'
            THEN v_now ELSE r.window_started_at END,
        request_count = CASE WHEN r.window_started_at <= v_now - interval '60 seconds'
            THEN 1 ELSE LEAST(r.request_count + 1, 121) END
    RETURNING window_started_at, request_count INTO v_start, v_count;

    IF v_count > 120 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED', 'limit', 120,
            'retry_after_seconds', LEAST(60, GREATEST(1,
                ceil(extract(epoch FROM (v_start + interval '60 seconds' - v_now)))::INTEGER)));
    END IF;
    RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.consume_asset_link_request(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_asset_link_request(TEXT) TO service_role;
