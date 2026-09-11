-- Slice 7 — job_stored transition + asset lookup RPC.
--
-- job_stored atomically:
--   - inserts the assets row (r2_key, mime_type, size_bytes)
--   - moves the job SUBMITTED/SUCCEEDED → STORED (terminal success)
--
-- get_user_asset returns the (asset, job) row for a job the caller
-- owns. Caller identity is passed as auth_id (the middleware-verified
-- header); we join through users so RLS is enforced via the join
-- rather than the JWT (the Worker uses service_role).

CREATE OR REPLACE FUNCTION public.job_stored(
    p_provider_job_id TEXT,
    p_provider TEXT,
    p_r2_key TEXT,
    p_mime_type TEXT,
    p_size_bytes BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_job_id UUID;
    v_asset_id UUID;
BEGIN
    UPDATE public.jobs
    SET state = 'STORED', updated_at = now()
    WHERE provider = p_provider
      AND provider_job_id = p_provider_job_id
      AND state IN ('SUBMITTED', 'FAILOVER', 'SUCCEEDED')
    RETURNING id INTO v_job_id;

    IF v_job_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'JOB_NOT_FOUND_OR_BAD_STATE');
    END IF;

    INSERT INTO public.assets (job_id, r2_key, mime_type, size_bytes)
    VALUES (v_job_id, p_r2_key, p_mime_type, p_size_bytes)
    ON CONFLICT (r2_key) DO NOTHING
    RETURNING id INTO v_asset_id;

    -- ON CONFLICT DO NOTHING returns NULL when a row with the same
    -- r2_key already exists. Recover the existing row so idempotent
    -- replays return a stable asset id.
    IF v_asset_id IS NULL THEN
        SELECT id INTO v_asset_id FROM public.assets WHERE r2_key = p_r2_key;
    END IF;

    RETURN jsonb_build_object('ok', true, 'job_id', v_job_id, 'asset_id', v_asset_id);
END $$;

CREATE OR REPLACE FUNCTION public.get_user_asset(
    p_auth_id TEXT,
    p_job_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row RECORD;
BEGIN
    SELECT a.r2_key, a.mime_type, a.size_bytes, j.state::text AS state
    INTO v_row
    FROM public.assets a
    JOIN public.jobs j ON j.id = a.job_id
    JOIN public.users u ON u.id = j.user_id
    WHERE j.id = p_job_id AND u.auth_id = p_auth_id
    LIMIT 1;

    IF v_row IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'r2_key', v_row.r2_key,
        'mime_type', v_row.mime_type,
        'size_bytes', v_row.size_bytes,
        'state', v_row.state
    );
END $$;

DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.job_stored(TEXT, TEXT, TEXT, TEXT, BIGINT)',
        'public.get_user_asset(TEXT, UUID)'
    ]
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END $$;
