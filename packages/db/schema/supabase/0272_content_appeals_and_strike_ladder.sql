-- Content appeals and the graduated strike ladder (ADR-0083).
--
-- Ofcom's Illegal Content Codes (ICU D1, D2, D10; in force 30 Sep 2026) ask
-- every user-to-user service to let a user contest a takedown, a warning or
-- a suspension, to reverse the action when the appeal succeeds, and to keep
-- the record. This migration adds:
--
--   * content_appeals: one appeal per account_actions row, submitted by the
--     user with a statement, decided once by an admin with a reason. The
--     decision is written to account_actions ('appeal_upheld' or
--     'appeal_rejected') so the append-only log holds both sides.
--   * The ladder in record_content_violation. A takedown that stands counts
--     as a strike; strike 1 holds generation for 3 days, strike 2 for 7 days,
--     strike 3 Freezes (unchanged). users.hold_until carries the hold and the
--     admission functions refuse ACCOUNT_ON_HOLD while it is in the future
--     (0273). An upheld appeal takes the strike out of the count, recomputes
--     the hold from the strikes that still stand, and lifts a content Freeze
--     through unfreeze_account when fewer than three strikes remain. Deleted
--     assets are not restored: the reaper has usually run.
--
-- The user never sees the operator's reason; list_my_sanctions returns the
-- action, when, the job and the appeal state only. Admin-only functions use
-- the ops_metrics_24h pattern (42501 'not_admin'). Idempotent: IF NOT EXISTS,
-- OR REPLACE, drop-and-add for the widened CHECK, REVOKE/GRANT re-run.

-- ── columns ─────────────────────────────────────────────────────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS hold_until TIMESTAMPTZ NULL;
COMMENT ON COLUMN public.users.hold_until IS
    'Generation is refused (ACCOUNT_ON_HOLD) until this time. Set by a standing takedown (strike 1: 3 days, strike 2: 7 days), recomputed when an appeal is upheld.';
ALTER TABLE public.account_actions ADD COLUMN IF NOT EXISTS hold_until TIMESTAMPTZ NULL;
ALTER TABLE public.account_actions DROP CONSTRAINT IF EXISTS account_actions_action_check;
ALTER TABLE public.account_actions
    ADD CONSTRAINT account_actions_action_check
    CHECK (action IN ('freeze', 'unfreeze', 'dispute_resolved', 'warning', 'takedown', 'credit_grant',
                      'appeal_upheld', 'appeal_rejected'));

-- ── content_appeals ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.content_appeals (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    action_id       UUID        NOT NULL UNIQUE REFERENCES public.account_actions(id) ON DELETE RESTRICT,
    statement       TEXT        NOT NULL CHECK (length(btrim(statement)) BETWEEN 10 AND 2000),
    status          TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'upheld', 'rejected')),
    submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at      TIMESTAMPTZ NULL,
    decided_by      TEXT        NULL CHECK (decided_by IS NULL OR length(btrim(decided_by)) BETWEEN 1 AND 120),
    decision_reason TEXT        NULL CHECK (decision_reason IS NULL OR length(btrim(decision_reason)) BETWEEN 3 AND 500),
    decision_action_id UUID     NULL REFERENCES public.account_actions(id) ON DELETE RESTRICT,
    CHECK ((status = 'open') = (decided_at IS NULL))
);
CREATE INDEX IF NOT EXISTS content_appeals_open_idx ON public.content_appeals (submitted_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS content_appeals_user_idx ON public.content_appeals (user_id, submitted_at);
ALTER TABLE public.content_appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_appeals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_appeals FROM PUBLIC, anon, authenticated;

-- An appeal is decided once, and never deleted.
CREATE OR REPLACE FUNCTION public.content_appeals_decided_once()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'content_appeals rows are never deleted';
    END IF;
    IF OLD.status <> 'open' THEN
        RAISE EXCEPTION 'content_appeals % is already decided', OLD.id;
    END IF;
    IF NEW.user_id <> OLD.user_id OR NEW.action_id <> OLD.action_id OR NEW.statement <> OLD.statement
       OR NEW.submitted_at <> OLD.submitted_at THEN
        RAISE EXCEPTION 'content_appeals % may only be decided, not rewritten', OLD.id;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.content_appeals_decided_once() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS content_appeals_decided_once ON public.content_appeals;
CREATE TRIGGER content_appeals_decided_once BEFORE UPDATE OR DELETE ON public.content_appeals
    FOR EACH ROW EXECUTE FUNCTION public.content_appeals_decided_once();

-- ── private.standing_takedowns: strikes that an appeal has not reversed ─────
CREATE OR REPLACE FUNCTION private.standing_takedowns(p_user_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT count(*)::integer
      FROM public.account_actions a
     WHERE a.user_id = p_user_id AND a.action = 'takedown'
       AND NOT EXISTS (SELECT 1 FROM public.content_appeals c WHERE c.action_id = a.id AND c.status = 'upheld');
$$;
REVOKE ALL ON FUNCTION private.standing_takedowns(UUID) FROM PUBLIC, anon, authenticated, service_role;

-- The hold a standing strike earns. NULL for the first warning and for the
-- third strike (a Freeze, not a hold).
CREATE OR REPLACE FUNCTION private.hold_for_strike(p_strikes INTEGER)
RETURNS INTERVAL
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE p_strikes WHEN 1 THEN interval '3 days' WHEN 2 THEN interval '7 days' ELSE NULL END;
$$;
REVOKE ALL ON FUNCTION private.hold_for_strike(INTEGER) FROM PUBLIC, anon, authenticated, service_role;

-- ── record_content_violation: same signature as 0253, now with the ladder ──
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
    v_hold TIMESTAMPTZ;
    v_action_id UUID;
    v_removed INTEGER := 0;
    v_strikes INTEGER;
    v_froze BOOLEAN := false;
    v_new_hold TIMESTAMPTZ;
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
    PERFORM 1 FROM public.credit_balances b WHERE b.user_id = p_user_id FOR UPDATE;
    SELECT u.frozen_at IS NOT NULL, u.hold_until INTO v_frozen, v_hold FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
    IF v_frozen IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;

    SELECT a.id, a.user_id, a.action, a.hold_until INTO v_seen
      FROM public.account_actions a WHERE a.idempotency_key = p_idempotency_key;
    IF v_seen.id IS NOT NULL THEN
        IF v_seen.user_id <> p_user_id OR v_seen.action <> p_tier THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REUSED');
        END IF;
        RETURN jsonb_build_object('ok', true, 'action_id', v_seen.id, 'tier', p_tier, 'assets_removed', 0,
                                   'takedowns', private.standing_takedowns(p_user_id), 'frozen', v_frozen,
                                   'hold_until', v_seen.hold_until, 'replayed', true);
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

    -- The strike this row will be, decided before the row is written: the
    -- log is append-only, so the hold has to travel with the row itself.
    v_strikes := private.standing_takedowns(p_user_id) + CASE WHEN p_tier = 'takedown' THEN 1 ELSE 0 END;
    IF p_tier = 'takedown' AND v_strikes < 3 THEN
        -- The ladder: a hold that is never shorter than one already running.
        v_new_hold := GREATEST(COALESCE(v_hold, now()), now() + private.hold_for_strike(v_strikes));
    END IF;

    INSERT INTO public.account_actions (user_id, action, actor, reason, top_up_id, job_id, idempotency_key, hold_until)
    VALUES (p_user_id, p_tier, left(coalesce(v_admin.email, p_auth_id), 120), btrim(p_reason), NULL, p_job_id, p_idempotency_key, v_new_hold)
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

        IF v_strikes >= 3 THEN
            IF NOT v_frozen THEN
                PERFORM public.freeze_account(p_user_id, 'content:third_takedown', NULL);
                v_froze := true;
            END IF;
        ELSE
            UPDATE public.users SET hold_until = v_new_hold, updated_at = now() WHERE id = p_user_id;
        END IF;
    END IF;

    RETURN jsonb_build_object('ok', true, 'action_id', v_action_id, 'tier', p_tier, 'assets_removed', v_removed,
                               'takedowns', v_strikes, 'frozen', v_frozen OR v_froze,
                               'hold_until', v_new_hold, 'replayed', false);
END $$;

REVOKE ALL ON FUNCTION public.record_content_violation(TEXT, UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_content_violation(TEXT, UUID, UUID, TEXT, TEXT, TEXT) TO service_role;
