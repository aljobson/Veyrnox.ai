-- Expose existing retention deadlines through owner-scoped read RPCs.
-- No backfill, retention change, or asset deletion. assets_job_id_idx serves both lookups.

CREATE OR REPLACE FUNCTION public.list_user_jobs(
    p_auth_id TEXT,
    p_limit INTEGER DEFAULT 24,
    p_before_created_at TIMESTAMPTZ DEFAULT NULL,
    p_before_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 24), 1), 50);
    v_rows JSONB;
BEGIN
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id;
    IF v_user_id IS NULL THEN
        -- An unprovisioned caller has no jobs; same shape as an empty page.
        RETURN jsonb_build_object('ok', true, 'jobs', '[]'::jsonb);
    END IF;

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
    SELECT a.r2_key, a.mime_type, a.size_bytes, a.expires_at, j.state::text AS state
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
        'asset_expires_at', v_row.expires_at,
        'state', v_row.state
    );
END $$;

REVOKE ALL ON FUNCTION public.get_user_asset(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_asset(TEXT, UUID) TO service_role;
