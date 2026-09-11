-- Ownership-checked job read. Same NOT_FOUND shape whether the job
-- doesn't exist or belongs to someone else — no existence leak.

CREATE OR REPLACE FUNCTION public.get_user_job(
    p_auth_id TEXT,
    p_job_id  UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_row     public.jobs%ROWTYPE;
BEGIN
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    END IF;

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
