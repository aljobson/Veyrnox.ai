-- The appeal functions over 0272's content_appeals (ADR-0083).
--
--   list_my_sanctions       the user's own warnings, takedowns and content
--                           Freezes with each one's appeal state. No operator
--                           reason, no other users.
--   submit_content_appeal   one appeal per action, from the account it was
--                           taken against, with a statement.
--   list_content_appeals    admin queue: open first, with the sanction and the
--                           operator's original reason.
--   decide_content_appeal   admin, once per appeal, keyed. Upheld: the strike
--                           no longer counts, the hold is recomputed from the
--                           strikes that stand, and a 'content:' Freeze is
--                           lifted through unfreeze_account when fewer than
--                           three remain. Either way an account_actions row
--                           ('appeal_upheld' / 'appeal_rejected') keeps the
--                           decision and its reason.
--   admin_lookup_user       same signature as 0148, now with hold_until, the
--                           strikes that stand and the open appeals.
--
-- Idempotent: OR REPLACE, REVOKE/GRANT re-run.

-- ── list_my_sanctions (user) ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_my_sanctions(p_auth_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user RECORD;
    v_rows JSONB;
BEGIN
    SELECT u.id, u.frozen_at, u.hold_until INTO v_user FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_user.id IS NULL THEN
        RETURN jsonb_build_object('ok', true, 'sanctions', '[]'::jsonb, 'hold_until', NULL, 'frozen', false);
    END IF;
    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_rows
    FROM (
        SELECT a.id AS action_id, a.action, a.created_at, a.job_id, j.model_id, a.hold_until,
               c.status AS appeal_status, c.submitted_at AS appeal_submitted_at, c.decided_at AS appeal_decided_at
          FROM public.account_actions a
          LEFT JOIN public.jobs j ON j.id = a.job_id
          LEFT JOIN public.content_appeals c ON c.action_id = a.id
         WHERE a.user_id = v_user.id
           AND (a.action IN ('warning', 'takedown') OR (a.action = 'freeze' AND a.reason LIKE 'content:%'))
         ORDER BY a.created_at DESC
         LIMIT 100
    ) t;
    RETURN jsonb_build_object('ok', true, 'sanctions', v_rows,
                               'hold_until', CASE WHEN v_user.hold_until > now() THEN v_user.hold_until END,
                               'frozen', v_user.frozen_at IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.list_my_sanctions(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_sanctions(TEXT) TO service_role;

-- ── submit_content_appeal (user) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_content_appeal(
    p_auth_id TEXT,
    p_action_id UUID,
    p_statement TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_action RECORD;
    v_appeal RECORD;
BEGIN
    SELECT u.id INTO v_user_id FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    IF p_statement IS NULL OR length(btrim(p_statement)) NOT BETWEEN 10 AND 2000 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'STATEMENT_INVALID');
    END IF;
    SELECT a.id, a.user_id, a.action, a.reason INTO v_action FROM public.account_actions a WHERE a.id = p_action_id;
    IF v_action.id IS NULL OR v_action.user_id <> v_user_id THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACTION_NOT_FOUND');
    END IF;
    IF NOT (v_action.action IN ('warning', 'takedown') OR (v_action.action = 'freeze' AND v_action.reason LIKE 'content:%')) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACTION_NOT_APPEALABLE');
    END IF;
    -- One appeal per action: a second submit answers with the first.
    SELECT c.id, c.status, c.submitted_at INTO v_appeal FROM public.content_appeals c WHERE c.action_id = p_action_id;
    IF v_appeal.id IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'appeal_id', v_appeal.id, 'status', v_appeal.status,
                                   'submitted_at', v_appeal.submitted_at, 'replayed', true);
    END IF;
    INSERT INTO public.content_appeals (user_id, action_id, statement)
    VALUES (v_user_id, p_action_id, btrim(p_statement))
    RETURNING id, status, submitted_at INTO v_appeal;
    RETURN jsonb_build_object('ok', true, 'appeal_id', v_appeal.id, 'status', v_appeal.status,
                               'submitted_at', v_appeal.submitted_at, 'replayed', false);
EXCEPTION WHEN unique_violation THEN
    SELECT c.id, c.status, c.submitted_at INTO v_appeal FROM public.content_appeals c WHERE c.action_id = p_action_id;
    RETURN jsonb_build_object('ok', true, 'appeal_id', v_appeal.id, 'status', v_appeal.status,
                               'submitted_at', v_appeal.submitted_at, 'replayed', true);
END $$;
REVOKE ALL ON FUNCTION public.submit_content_appeal(TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_content_appeal(TEXT, UUID, TEXT) TO service_role;

-- ── list_content_appeals (admin) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_content_appeals(
    p_auth_id TEXT,
    p_status TEXT DEFAULT 'open',
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
    IF p_status IS NOT NULL AND p_status NOT IN ('open', 'upheld', 'rejected') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'STATUS_INVALID');
    END IF;
    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY (t.status = 'open') DESC, t.submitted_at), '[]'::jsonb) INTO v_rows
    FROM (
        SELECT c.id, c.user_id, u.email, c.action_id, a.action, a.reason AS action_reason, a.actor AS action_actor,
               a.job_id, j.model_id, a.hold_until, a.created_at AS action_at,
               c.statement, c.status, c.submitted_at, c.decided_at, c.decided_by, c.decision_reason,
               u.frozen_at, private.standing_takedowns(c.user_id) AS standing_takedowns
          FROM public.content_appeals c
          JOIN public.users u ON u.id = c.user_id
          JOIN public.account_actions a ON a.id = c.action_id
          LEFT JOIN public.jobs j ON j.id = a.job_id
         WHERE p_status IS NULL OR c.status = p_status
         ORDER BY (c.status = 'open') DESC, c.submitted_at
         LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
    ) t;
    RETURN jsonb_build_object('ok', true, 'appeals', v_rows);
END $$;
REVOKE ALL ON FUNCTION public.list_content_appeals(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_content_appeals(TEXT, TEXT, INTEGER) TO service_role;

-- ── decide_content_appeal (admin) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.decide_content_appeal(
    p_auth_id TEXT,
    p_appeal_id UUID,
    p_decision TEXT,
    p_reason TEXT,
    p_idempotency_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_admin RECORD;
    v_actor TEXT;
    v_appeal RECORD;
    v_action RECORD;
    v_seen RECORD;
    v_frozen_reason TEXT;
    v_strikes INTEGER;
    v_hold TIMESTAMPTZ;
    v_unfroze BOOLEAN := false;
    v_decision_id UUID;
BEGIN
    SELECT u.id, u.email, u.is_admin INTO v_admin FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_admin.id IS NULL OR v_admin.is_admin IS NOT TRUE THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
    END IF;
    IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,128}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_INVALID');
    END IF;
    IF p_decision IS NULL OR p_decision NOT IN ('upheld', 'rejected') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'DECISION_INVALID');
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
    END IF;
    v_actor := left(coalesce(v_admin.email, p_auth_id), 120);

    SELECT c.id, c.user_id, c.action_id, c.status, c.decision_action_id INTO v_appeal
      FROM public.content_appeals c WHERE c.id = p_appeal_id;
    IF v_appeal.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'APPEAL_NOT_FOUND');
    END IF;

    -- Same lock order as the Freeze and the strike: balance row, then user row.
    PERFORM 1 FROM public.credit_balances b WHERE b.user_id = v_appeal.user_id FOR UPDATE;
    PERFORM 1 FROM public.users u WHERE u.id = v_appeal.user_id FOR UPDATE;

    SELECT a.id, a.user_id, a.action INTO v_seen FROM public.account_actions a WHERE a.idempotency_key = p_idempotency_key;
    IF v_seen.id IS NOT NULL THEN
        IF v_seen.id IS DISTINCT FROM v_appeal.decision_action_id OR v_seen.action <> 'appeal_' || p_decision THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REUSED');
        END IF;
        RETURN jsonb_build_object('ok', true, 'appeal_id', v_appeal.id, 'status', v_appeal.status,
                                   'action_id', v_seen.id, 'replayed', true);
    END IF;
    IF v_appeal.status <> 'open' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'APPEAL_DECIDED', 'status', v_appeal.status);
    END IF;

    SELECT a.id, a.action, a.job_id INTO v_action FROM public.account_actions a WHERE a.id = v_appeal.action_id;

    INSERT INTO public.account_actions (user_id, action, actor, reason, top_up_id, job_id, idempotency_key)
    VALUES (v_appeal.user_id, 'appeal_' || p_decision, v_actor, btrim(p_reason), NULL, v_action.job_id, p_idempotency_key)
    RETURNING id INTO v_decision_id;

    UPDATE public.content_appeals
       SET status = p_decision, decided_at = now(), decided_by = v_actor, decision_reason = btrim(p_reason),
           decision_action_id = v_decision_id
     WHERE id = p_appeal_id;

    IF p_decision = 'upheld' THEN
        -- The strike no longer stands: the hold is what the standing ones earn.
        v_strikes := private.standing_takedowns(v_appeal.user_id);
        SELECT max(a.hold_until) INTO v_hold
          FROM public.account_actions a
         WHERE a.user_id = v_appeal.user_id AND a.action = 'takedown' AND a.hold_until > now()
           AND NOT EXISTS (SELECT 1 FROM public.content_appeals c WHERE c.action_id = a.id AND c.status = 'upheld');
        UPDATE public.users SET hold_until = v_hold, updated_at = now() WHERE id = v_appeal.user_id;

        -- A Freeze that content earned, with fewer than three strikes left, is lifted.
        SELECT a.reason INTO v_frozen_reason
          FROM public.account_actions a
         WHERE a.user_id = v_appeal.user_id AND a.action IN ('freeze', 'unfreeze')
         ORDER BY a.created_at DESC, a.id DESC LIMIT 1;
        IF v_strikes < 3 AND v_frozen_reason LIKE 'content:%'
           AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_appeal.user_id AND u.frozen_at IS NOT NULL) THEN
            PERFORM public.unfreeze_account(v_appeal.user_id, v_actor, 'appeal:' || p_appeal_id::text);
            v_unfroze := true;
        END IF;
    END IF;

    RETURN jsonb_build_object('ok', true, 'appeal_id', p_appeal_id, 'status', p_decision, 'action_id', v_decision_id,
                               'user_id', v_appeal.user_id, 'appealed_action', v_action.action,
                               'standing_takedowns', COALESCE(v_strikes, private.standing_takedowns(v_appeal.user_id)),
                               'hold_until', v_hold, 'unfrozen', v_unfroze, 'replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.decide_content_appeal(TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_content_appeal(TEXT, UUID, TEXT, TEXT, TEXT) TO service_role;

-- ── admin_lookup_user: 0148's signature, with the hold and the appeals ──────
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

    SELECT u.id, u.email, u.frozen_at, u.hold_until, u.rights_attested_at, u.rights_attestation_version, u.created_at,
           (SELECT count(*) FROM public.account_actions a WHERE a.user_id = u.id AND a.action = 'warning')  AS warnings,
           private.standing_takedowns(u.id) AS takedowns,
           (SELECT count(*) FROM public.content_appeals c WHERE c.user_id = u.id AND c.status = 'upheld') AS reversed,
           (SELECT count(*) FROM public.content_appeals c WHERE c.user_id = u.id AND c.status = 'open') AS open_appeals
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
            'hold_until', CASE WHEN v_user.hold_until > now() THEN v_user.hold_until END,
            'rights_attested_at', v_user.rights_attested_at,
            'rights_attestation_version', v_user.rights_attestation_version,
            'created_at', v_user.created_at,
            'warnings', v_user.warnings,
            'takedowns', v_user.takedowns,
            'reversed_takedowns', v_user.reversed,
            'open_appeals', v_user.open_appeals
        ),
        'jobs', v_jobs
    );
END $$;

REVOKE ALL ON FUNCTION public.admin_lookup_user(TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_lookup_user(TEXT, TEXT, UUID, UUID) TO service_role;
