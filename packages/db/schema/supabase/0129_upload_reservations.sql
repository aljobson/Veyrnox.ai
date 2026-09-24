-- Outstanding URLs consume storage budget before clients can upload bytes.
CREATE TABLE IF NOT EXISTS public.upload_reservations (
    r2_key TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    size_bytes BIGINT NOT NULL CHECK (size_bytes BETWEEN 1 AND 104857600),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    put_expires_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() + INTERVAL '16 minutes'
);
CREATE INDEX IF NOT EXISTS upload_reservations_user_id_idx ON public.upload_reservations(user_id);
CREATE INDEX IF NOT EXISTS upload_reservations_created_at_idx ON public.upload_reservations(created_at);
ALTER TABLE public.upload_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_reservations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.upload_reservations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.upload_reservations TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_upload(p_auth_id TEXT, p_key TEXT, p_size BIGINT, p_stored JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID;
    v_count BIGINT;
    v_bytes BIGINT;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR p_size IS NULL OR p_size < 1 OR p_size > 104857600
       OR p_stored IS NULL OR jsonb_typeof(p_stored) <> 'array' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
    END IF;
    IF jsonb_array_length(p_stored) > 10 OR p_key IS NULL
       OR p_key !~ ('^uploads/' || lower(p_auth_id) || '/[0-9a-f-]{36}\.(jpg|png|webp|mp4|mp3|wav)$') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
    END IF;
    -- Same account lock serializes the count, bytes and insertion across Workers.
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id FOR UPDATE;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    IF EXISTS (SELECT 1 FROM public.upload_reservations WHERE r2_key = p_key) THEN
        -- Do not renew an old URL's expiry by signing an existing reservation.
        RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_RESERVED');
    END IF;
    SELECT count(*), COALESCE(sum(size_bytes), 0) INTO v_count, v_bytes
      FROM public.upload_reservations WHERE user_id = v_user;
    -- Legacy objects have no reservation. Include them without counting new
    -- objects twice. p_stored comes from the Worker's authenticated R2 LIST.
    SELECT v_count + count(*), v_bytes + COALESCE(sum(GREATEST(0, (o->>'size')::BIGINT)), 0)
      INTO v_count, v_bytes FROM jsonb_array_elements(p_stored) o
      WHERE NOT EXISTS (SELECT 1 FROM public.upload_reservations r WHERE r.r2_key = o->>'key' AND r.user_id = v_user);
    IF v_count >= 10 OR v_bytes + p_size > 209715200 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'UPLOAD_BUDGET_EXCEEDED');
    END IF;
    INSERT INTO public.upload_reservations(r2_key, user_id, size_bytes) VALUES(p_key, v_user, p_size);
    RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.reserve_upload(TEXT, TEXT, BIGINT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_upload(TEXT, TEXT, BIGINT, JSONB) TO service_role;

-- The trusted sweeper invokes this ONLY after confirmed R2 deletion. Never
-- expire metadata on a timer alone: failed cleanup must retain the budget.
CREATE OR REPLACE FUNCTION public.release_upload(p_key TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    DELETE FROM public.upload_reservations WHERE r2_key = p_key AND put_expires_at < clock_timestamp();
$$;
REVOKE ALL ON FUNCTION public.release_upload(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_upload(TEXT) TO service_role;
