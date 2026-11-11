-- Allow several independently polled Music pairs while enforcing the shared
-- tier's four-request ceiling at the authoritative admission boundary.
-- Existing same-key replays bypass the capacity check and converge on the
-- original request; they never consume another slot or another debit.

DO $$
BEGIN
    IF to_regprocedure('private.music_submit_pair_unbounded(text,uuid,text)') IS NULL THEN
        EXECUTE 'ALTER FUNCTION public.music_submit_pair(TEXT,UUID,TEXT) SET SCHEMA private';
        EXECUTE 'ALTER FUNCTION private.music_submit_pair(TEXT,UUID,TEXT) RENAME TO music_submit_pair_unbounded';
    END IF;
END $$;

REVOKE ALL ON FUNCTION private.music_submit_pair_unbounded(TEXT,UUID,TEXT)
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.music_submit_pair(
    p_auth_id TEXT,
    p_quote_id UUID,
    p_idempotency_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID;
    v_active INTEGER;
    v_replay BOOLEAN;
BEGIN
    IF p_quote_id IS NULL OR p_idempotency_key IS NULL
       OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;

    -- The owner row is a narrow per-user admission lock. It serializes two
    -- simultaneous confirmations before either creates its request row.
    SELECT u.id INTO v_user
    FROM public.users u
    WHERE u.auth_id = p_auth_id
    FOR UPDATE;
    IF v_user IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.music_generation_requests r
        WHERE r.user_id = v_user AND r.idempotency_key = p_idempotency_key
    ) INTO v_replay;

    IF NOT v_replay THEN
        SELECT count(*) INTO v_active
        FROM public.music_generation_requests r
        WHERE r.user_id = v_user AND r.status IN ('debited', 'running');
        IF v_active >= 4 THEN
            RETURN jsonb_build_object('ok', false, 'code', 'CONCURRENCY_LIMIT');
        END IF;
    END IF;

    RETURN private.music_submit_pair_unbounded(p_auth_id, p_quote_id, p_idempotency_key);
END $$;

REVOKE ALL ON FUNCTION public.music_submit_pair(TEXT,UUID,TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_submit_pair(TEXT,UUID,TEXT) TO service_role;
