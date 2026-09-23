-- The account's own job list (audit 2026-09-23, finding 11).
--
-- Until now the Library's only source of job ids was a 50-entry ring buffer
-- in one browser's localStorage. A second device, a cleared cache or a 51st
-- generation showed "Nothing here yet" while the files sat in R2. There was
-- no jobs-list endpoint to read instead; this is it.
--
-- Ownership lives in the function, exactly as get_user_job (0012) does it:
-- the caller is an auth_id, never a user_id from a request. Keyset
-- pagination on (created_at, id) so a page cannot skip or repeat a row when
-- a new job lands mid-scroll.
--
-- `label` is the first 60 characters of the job's own prompt or topic, which
-- is what the Library already shows from localStorage; nothing else from
-- jobs.inputs crosses the boundary (it holds R2 keys and provider inputs).
--
-- Idempotent: CREATE OR REPLACE with explicit revokes.

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

-- The list's own index: jobs_user_id_idx (0001) is (user_id, created_at DESC),
-- which serves the keyset scan; id breaks ties inside a single timestamp.
