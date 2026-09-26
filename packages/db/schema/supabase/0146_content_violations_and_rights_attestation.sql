-- Content violation records and upload rights attestation (ADR-0058 decision 7).
--
-- BytePlus's Platform Customer terms (Service Specific Terms 4.2.2) require
-- "tiered violation handling (including content traceability, warnings,
-- takedowns, and account action) with complete records" and "processes to
-- verify and retain rights in user-uploaded content, including real-person
-- imagery". Every merchant of record that accepts AI generation asks for the
-- same thing in fewer words. This migration gives both a home in the existing
-- append-only tables rather than new ones:
--
--   * account_actions gains 'warning' and 'takedown' actions and a job_id, so
--     every strike is traceable to the content it was about. A third takedown
--     Freezes the account through the same freeze_account as a Chargeback.
--   * users gains rights_attested_at / rights_attestation_version: the first
--     time a user sends an upload with the AUP consent statement, the gateway
--     records that statement at account level as well as on the job (0096).
--
-- Only admins (users.is_admin) may record or list violations, and the RPC
-- checks that itself with the ops_metrics_24h pattern, so the data is safe
-- even if a route forgets. Idempotent: IF NOT EXISTS, OR REPLACE, drop-and-add
-- for the widened CHECK, REVOKE/GRANT re-run.

-- ── account_actions: traceability and the two new tiers ─────────────────────
ALTER TABLE public.account_actions ADD COLUMN IF NOT EXISTS job_id UUID NULL REFERENCES public.jobs(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS account_actions_job_idx ON public.account_actions (job_id) WHERE job_id IS NOT NULL;
ALTER TABLE public.account_actions DROP CONSTRAINT IF EXISTS account_actions_action_check;
ALTER TABLE public.account_actions
    ADD CONSTRAINT account_actions_action_check
    CHECK (action IN ('freeze', 'unfreeze', 'dispute_resolved', 'warning', 'takedown'));

-- ── users: account-level rights attestation ────────────────────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS rights_attested_at TIMESTAMPTZ NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS rights_attestation_version TEXT NULL
    CHECK (rights_attestation_version IS NULL OR rights_attestation_version ~ '^[a-z0-9-]{3,40}$');
COMMENT ON COLUMN public.users.rights_attested_at IS
    'First time this user sent an upload with the AUP statement that they own it or have the consent of everyone identifiable in it. Per-job copies live in jobs.consent_attested_at.';

CREATE OR REPLACE FUNCTION public.attest_upload_rights(
    p_user_id UUID,
    p_version TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_at TIMESTAMPTZ;
    v_version TEXT;
BEGIN
    IF p_version IS NULL OR p_version !~ '^[a-z0-9-]{3,40}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'VERSION_INVALID');
    END IF;
    SELECT rights_attested_at, rights_attestation_version INTO v_at, v_version
      FROM public.users WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    -- Write-once per statement version: a replay returns the first timestamp,
    -- a new AUP version re-records under its own name.
    IF v_at IS NULL OR v_version IS DISTINCT FROM p_version THEN
        UPDATE public.users
           SET rights_attested_at = now(), rights_attestation_version = p_version, updated_at = now()
         WHERE id = p_user_id
        RETURNING rights_attested_at INTO v_at;
    END IF;
    RETURN jsonb_build_object('ok', true, 'attested_at', v_at, 'version', p_version);
END $$;

REVOKE ALL ON FUNCTION public.attest_upload_rights(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attest_upload_rights(UUID, TEXT) TO service_role;

-- ── record_content_violation: warning or takedown, admin only ──────────────
-- A takedown removes the job's assets the way expire_assets does (rows deleted,
-- R2 keys queued for the reaper) so the content stops being served at once,
-- and the account_actions row keeps the trace. The third takedown Freezes the
-- account; unfreeze_account remains the only way out (#97).
CREATE OR REPLACE FUNCTION public.record_content_violation(
    p_auth_id TEXT,
    p_user_id UUID,
    p_job_id UUID,
    p_tier TEXT,
    p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_admin RECORD;
    v_job_owner UUID;
    v_frozen BOOLEAN;
    v_action_id UUID;
    v_removed INTEGER := 0;
    v_strikes INTEGER;
    v_froze BOOLEAN := false;
BEGIN
    SELECT u.id, u.email, u.is_admin INTO v_admin FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_admin.id IS NULL OR v_admin.is_admin IS NOT TRUE THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
    END IF;
    IF p_tier IS NULL OR p_tier NOT IN ('warning', 'takedown') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'TIER_INVALID');
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
    END IF;
    IF p_tier = 'takedown' AND p_job_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'JOB_REQUIRED');
    END IF;

    -- Same lock order as the Chargeback Freeze: balance row, then user row.
    PERFORM 1 FROM public.credit_balances b WHERE b.user_id = p_user_id FOR UPDATE;
    SELECT u.frozen_at IS NOT NULL INTO v_frozen FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
    IF v_frozen IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    IF p_job_id IS NOT NULL THEN
        SELECT j.user_id INTO v_job_owner FROM public.jobs j WHERE j.id = p_job_id;
        IF v_job_owner IS NULL THEN
            RETURN jsonb_build_object('ok', false, 'code', 'JOB_NOT_FOUND');
        END IF;
        IF v_job_owner <> p_user_id THEN
            RETURN jsonb_build_object('ok', false, 'code', 'JOB_NOT_OWNED');
        END IF;
    END IF;

    INSERT INTO public.account_actions (user_id, action, actor, reason, top_up_id, job_id)
    VALUES (p_user_id, p_tier, left(coalesce(v_admin.email, p_auth_id), 120), btrim(p_reason), NULL, p_job_id)
    RETURNING id INTO v_action_id;

    IF p_tier = 'takedown' THEN
        WITH doomed AS (
            SELECT a.id, a.r2_key FROM public.assets a WHERE a.job_id = p_job_id
        ),
        queued AS (
            INSERT INTO public.asset_reap_queue (r2_key)
            SELECT r2_key FROM doomed
            ON CONFLICT (r2_key) DO NOTHING
            RETURNING 1
        ),
        dropped AS (
            DELETE FROM public.assets WHERE id IN (SELECT id FROM doomed) RETURNING 1
        )
        SELECT count(*) INTO v_removed FROM dropped;

        SELECT count(*) INTO v_strikes FROM public.account_actions a
         WHERE a.user_id = p_user_id AND a.action = 'takedown';
        IF v_strikes >= 3 AND NOT v_frozen THEN
            PERFORM public.freeze_account(p_user_id, 'content:third_takedown', NULL);
            v_froze := true;
        END IF;
    ELSE
        SELECT count(*) INTO v_strikes FROM public.account_actions a
         WHERE a.user_id = p_user_id AND a.action = 'takedown';
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'action_id', v_action_id,
        'tier', p_tier,
        'assets_removed', v_removed,
        'takedowns', v_strikes,
        'frozen', v_frozen OR v_froze
    );
END $$;

REVOKE ALL ON FUNCTION public.record_content_violation(TEXT, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_content_violation(TEXT, UUID, UUID, TEXT, TEXT) TO service_role;

-- ── list_content_violations: the record an auditor reads, admin only ───────
CREATE OR REPLACE FUNCTION public.list_content_violations(
    p_auth_id TEXT,
    p_user_id UUID DEFAULT NULL,
    p_limit INTEGER DEFAULT 50
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_admin BOOLEAN;
    v_rows JSONB;
BEGIN
    SELECT u.is_admin INTO v_admin FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_admin IS NOT TRUE THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
    END IF;
    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_rows
    FROM (
        SELECT a.id, a.user_id, u.email, a.action, a.actor, a.reason, a.job_id, j.model_id, a.created_at
          FROM public.account_actions a
          JOIN public.users u ON u.id = a.user_id
          LEFT JOIN public.jobs j ON j.id = a.job_id
         WHERE (a.action IN ('warning', 'takedown') OR (a.action = 'freeze' AND a.reason LIKE 'content:%'))
           AND (p_user_id IS NULL OR a.user_id = p_user_id)
         ORDER BY a.created_at DESC
         LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
    ) t;
    RETURN v_rows;
END $$;

REVOKE ALL ON FUNCTION public.list_content_violations(TEXT, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_content_violations(TEXT, UUID, INTEGER) TO service_role;
