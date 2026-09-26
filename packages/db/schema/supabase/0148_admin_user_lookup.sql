-- Admin user lookup for the violations UI (ADR-0058 decision 7, follow-up).
--
-- An operator recording a Content Warning or a Takedown needs the user id and
-- the job id, and has an email address or a job id in hand. This read gives
-- the admin the user's standing (Frozen, Rights Attestation, strikes) and the
-- last 25 generations with whether an asset is still served, and nothing
-- else: no prompts, no payment references, no other users. Admin-only,
-- checked here with the ops_metrics_24h pattern (42501 'not_admin').
--
-- Idempotent: OR REPLACE, REVOKE/GRANT re-run.

CREATE OR REPLACE FUNCTION public.admin_lookup_user(
    p_auth_id TEXT,
    p_email TEXT DEFAULT NULL,
    p_user_id UUID DEFAULT NULL,
    p_job_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_admin BOOLEAN;
    v_user RECORD;
    v_jobs JSONB;
BEGIN
    SELECT u.is_admin INTO v_admin FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_admin IS NOT TRUE THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
    END IF;
    IF p_email IS NULL AND p_user_id IS NULL AND p_job_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'LOOKUP_REQUIRED');
    END IF;

    SELECT u.id, u.email, u.frozen_at, u.rights_attested_at, u.rights_attestation_version, u.created_at,
           (SELECT count(*) FROM public.account_actions a WHERE a.user_id = u.id AND a.action = 'warning')  AS warnings,
           (SELECT count(*) FROM public.account_actions a WHERE a.user_id = u.id AND a.action = 'takedown') AS takedowns
      INTO v_user
      FROM public.users u
     WHERE (p_user_id IS NOT NULL AND u.id = p_user_id)
        OR (p_job_id IS NOT NULL AND u.id = (SELECT j.user_id FROM public.jobs j WHERE j.id = p_job_id))
        OR (p_email IS NOT NULL AND lower(u.email) = lower(btrim(p_email)))
     ORDER BY u.created_at
     LIMIT 1;
    IF v_user.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_jobs
    FROM (
        SELECT j.id AS job_id, j.model_id, j.state::text AS state, j.credits, j.created_at, j.consent_attested_at,
               EXISTS (SELECT 1 FROM public.assets a WHERE a.job_id = j.id) AS has_asset,
               EXISTS (SELECT 1 FROM public.account_actions a WHERE a.job_id = j.id AND a.action = 'takedown') AS taken_down
          FROM public.jobs j
         WHERE j.user_id = v_user.id
         ORDER BY j.created_at DESC
         LIMIT 25
    ) t;

    RETURN jsonb_build_object(
        'ok', true,
        'user', jsonb_build_object(
            'id', v_user.id,
            'email', v_user.email,
            'frozen_at', v_user.frozen_at,
            'rights_attested_at', v_user.rights_attested_at,
            'rights_attestation_version', v_user.rights_attestation_version,
            'created_at', v_user.created_at,
            'warnings', v_user.warnings,
            'takedowns', v_user.takedowns
        ),
        'jobs', v_jobs
    );
END $$;

REVOKE ALL ON FUNCTION public.admin_lookup_user(TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_lookup_user(TEXT, TEXT, UUID, UUID) TO service_role;
