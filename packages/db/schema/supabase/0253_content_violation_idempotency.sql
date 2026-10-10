-- 0253_content_violation_idempotency.sql
-- Recording a content violation is idempotent (audit 2026-10-09, P-07).
--
-- The admin form already sends an Idempotency-Key with every POST to
-- /api/v1/admin/violations, and the route ignored it: record_content_violation
-- was a plain INSERT, strikes are counted from rows, and the notice email is
-- awaited after the commit (up to about 16 s). A lost response and a resubmit
-- therefore recorded a second strike for the same job, and the third one
-- Freezes the account. account_actions is append-only, so an extra strike was
-- permanent.
--
-- This migration gives account_actions an idempotency_key, unique where set,
-- and replaces record_content_violation with a six-argument version that
-- returns the first result when the key has been seen. The five-argument
-- function is dropped: a changed argument list is a new function, and keeping
-- both would let PostgREST pick either. Idempotent: ADD COLUMN IF NOT EXISTS,
-- CREATE INDEX IF NOT EXISTS, DROP FUNCTION IF EXISTS, OR REPLACE, REVOKE and
-- GRANT re-run.

ALTER TABLE public.account_actions ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL
    CHECK (idempotency_key IS NULL OR idempotency_key ~ '^[A-Za-z0-9._-]{8,128}$');
CREATE UNIQUE INDEX IF NOT EXISTS account_actions_idempotency_key_idx
    ON public.account_actions (idempotency_key) WHERE idempotency_key IS NOT NULL;

DROP FUNCTION IF EXISTS public.record_content_violation(TEXT, UUID, UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.record_content_violation(
    p_auth_id TEXT,
    p_user_id UUID,
    p_job_id UUID,
    p_tier TEXT,
    p_reason TEXT,
    p_idempotency_key TEXT
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
    v_seen RECORD;
BEGIN
    SELECT u.id, u.email, u.is_admin INTO v_admin FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_admin.id IS NULL OR v_admin.is_admin IS NOT TRUE THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
    END IF;
    IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,128}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_INVALID');
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
    -- The user lock also serialises two deliveries of the same key, so the
    -- second one sees the first one's row below instead of racing it.
    PERFORM 1 FROM public.credit_balances b WHERE b.user_id = p_user_id FOR UPDATE;
    SELECT u.frozen_at IS NOT NULL INTO v_frozen FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
    IF v_frozen IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;

    -- A key seen before answers with the strike it recorded then. The key is
    -- unique across users, so a key reused for another user is refused rather
    -- than silently answered with somebody else's record.
    SELECT a.id, a.user_id, a.action INTO v_seen
      FROM public.account_actions a WHERE a.idempotency_key = p_idempotency_key;
    IF v_seen.id IS NOT NULL THEN
        IF v_seen.user_id <> p_user_id OR v_seen.action <> p_tier THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REUSED');
        END IF;
        SELECT count(*) INTO v_strikes FROM public.account_actions a
         WHERE a.user_id = p_user_id AND a.action = 'takedown';
        RETURN jsonb_build_object(
            'ok', true,
            'action_id', v_seen.id,
            'tier', p_tier,
            'assets_removed', 0,
            'takedowns', v_strikes,
            'frozen', v_frozen,
            'replayed', true
        );
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

    INSERT INTO public.account_actions (user_id, action, actor, reason, top_up_id, job_id, idempotency_key)
    VALUES (p_user_id, p_tier, left(coalesce(v_admin.email, p_auth_id), 120), btrim(p_reason), NULL, p_job_id, p_idempotency_key)
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
        'frozen', v_frozen OR v_froze,
        'replayed', false
    );
END $$;

REVOKE ALL ON FUNCTION public.record_content_violation(TEXT, UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_content_violation(TEXT, UUID, UUID, TEXT, TEXT, TEXT) TO service_role;
