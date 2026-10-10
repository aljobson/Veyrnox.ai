-- Admin ledger drilldown and reasoned credit grant (ADR-0083).
--
-- An operator answering a support ticket needs to see every ledger row on an
-- account, not the balance alone, and to correct it with a compensating row
-- that names who decided and why. The ledger stays append-only
-- (ledger_entries_append_only): the grant goes through ledger_grant, keyed,
-- and lands in account_actions as 'credit_grant' with the operator's email,
-- the operator-only note, the ledger row and the Idempotency-Key, so a lost
-- response and a resubmit move the balance once. There is deliberately no
-- negative path here: Free and Subscription Credits have their own
-- lifecycle, and a Pack clawback is a separate decision (ADR-0083).
--
-- Admin-only, checked here with the ops_metrics_24h pattern (42501
-- 'not_admin'). Idempotent: ADD COLUMN IF NOT EXISTS, drop-and-add for the
-- widened CHECK, OR REPLACE, REVOKE/GRANT re-run.

-- ── account_actions: the grant tier and its ledger trace ────────────────────
ALTER TABLE public.account_actions ADD COLUMN IF NOT EXISTS ledger_entry_id UUID NULL
    REFERENCES public.ledger_entries(id) ON DELETE RESTRICT;
ALTER TABLE public.account_actions ADD COLUMN IF NOT EXISTS credits_delta INTEGER NULL
    CHECK (credits_delta IS NULL OR credits_delta <> 0);
ALTER TABLE public.account_actions DROP CONSTRAINT IF EXISTS account_actions_action_check;
ALTER TABLE public.account_actions
    ADD CONSTRAINT account_actions_action_check
    CHECK (action IN ('freeze', 'unfreeze', 'dispute_resolved', 'warning', 'takedown', 'credit_grant'));

-- ── admin_user_ledger: one account's balance, ledger and action log ─────────
CREATE OR REPLACE FUNCTION public.admin_user_ledger(
    p_auth_id TEXT,
    p_user_id UUID,
    p_limit INTEGER DEFAULT 100
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_admin BOOLEAN;
    v_balance RECORD;
    v_entries JSONB;
    v_actions JSONB;
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
BEGIN
    SELECT u.is_admin INTO v_admin FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_admin IS NOT TRUE THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;

    SELECT b.balance, COALESCE(b.free_balance, 0) AS free_balance, b.subscription_balance,
           b.subscription_expires_at, b.updated_at
      INTO v_balance
      FROM public.credit_balances b WHERE b.user_id = p_user_id;

    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.created_at DESC, t.id DESC), '[]'::jsonb) INTO v_entries
    FROM (
        SELECT l.id, l.delta, COALESCE(l.free_delta, 0) AS free_delta, l.subscription_delta, l.reason, l.job_id, l.created_at
          FROM public.ledger_entries l
         WHERE l.user_id = p_user_id
         ORDER BY l.created_at DESC, l.id DESC
         LIMIT v_limit
    ) t;

    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_actions
    FROM (
        SELECT a.id, a.action, a.actor, a.reason, a.job_id, a.top_up_id, a.credits_delta, a.ledger_entry_id, a.created_at
          FROM public.account_actions a
         WHERE a.user_id = p_user_id
         ORDER BY a.created_at DESC
         LIMIT v_limit
    ) t;

    RETURN jsonb_build_object(
        'ok', true,
        'balance', CASE WHEN v_balance.balance IS NULL THEN NULL ELSE jsonb_build_object(
            'balance', v_balance.balance,
            'free_balance', v_balance.free_balance,
            'subscription_balance', v_balance.subscription_balance,
            'subscription_expires_at', v_balance.subscription_expires_at,
            'updated_at', v_balance.updated_at
        ) END,
        'entries', v_entries,
        'actions', v_actions
    );
END $$;

REVOKE ALL ON FUNCTION public.admin_user_ledger(TEXT, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_user_ledger(TEXT, UUID, INTEGER) TO service_role;

-- ── admin_credit_grant: a compensating grant with an operator note ──────────
-- The ledger reason is 'grant:admin <email>' plus the key, so ledger_grant's
-- own replay guard holds and a user's statement files it as an adjustment.
-- The note is kept on the account_actions row, visible to admins only.
CREATE OR REPLACE FUNCTION public.admin_credit_grant(
    p_auth_id TEXT,
    p_user_id UUID,
    p_credits INTEGER,
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
    v_seen RECORD;
    v_grant JSONB;
    v_entry_id UUID;
    v_after INTEGER;
    v_action_id UUID;
BEGIN
    SELECT u.id, u.email, u.is_admin INTO v_admin FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_admin.id IS NULL OR v_admin.is_admin IS NOT TRUE THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
    END IF;
    IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,128}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_INVALID');
    END IF;
    IF p_credits IS NULL OR p_credits < 1 OR p_credits > 100000 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CREDITS_INVALID');
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 200 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
    END IF;
    -- '#' separates the key in a ledger reason, so the actor must not carry one.
    v_actor := left(replace(coalesce(v_admin.email, p_auth_id), '#', '_'), 120);
    IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;

    -- Same lock as every balance mutation: serialises a replay against itself.
    PERFORM 1 FROM public.credit_balances b WHERE b.user_id = p_user_id FOR UPDATE;
    SELECT a.id, a.ledger_entry_id, a.credits_delta, a.user_id INTO v_seen
      FROM public.account_actions a WHERE a.idempotency_key = p_idempotency_key;
    IF v_seen.id IS NOT NULL THEN
        IF v_seen.user_id <> p_user_id OR v_seen.credits_delta IS DISTINCT FROM p_credits THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REUSED');
        END IF;
        SELECT b.balance INTO v_after FROM public.credit_balances b WHERE b.user_id = p_user_id;
        RETURN jsonb_build_object('ok', true, 'replayed', true, 'action_id', v_seen.id,
                                   'entry_id', v_seen.ledger_entry_id, 'credits_delta', v_seen.credits_delta,
                                   'balance_after', v_after);
    END IF;

    v_grant := public.ledger_grant(p_user_id, p_credits, 'grant:admin ' || v_actor, p_idempotency_key);
    IF (v_grant->>'ok')::boolean IS NOT TRUE THEN
        RETURN jsonb_build_object('ok', false, 'code', COALESCE(v_grant->>'code', 'GRANT_FAILED'));
    END IF;
    IF (v_grant->>'idempotent')::boolean IS TRUE THEN
        -- The ledger row exists from an earlier delivery whose action row was
        -- never written (a crash between the two). Do not grant twice.
        RETURN jsonb_build_object('ok', false, 'code', 'GRANT_ALREADY_APPLIED');
    END IF;
    v_entry_id := (v_grant->>'entry_id')::uuid;
    v_after := (v_grant->>'balance_after')::integer;

    INSERT INTO public.account_actions (user_id, action, actor, reason, top_up_id, idempotency_key, ledger_entry_id, credits_delta)
    VALUES (p_user_id, 'credit_grant', v_actor, btrim(p_reason), NULL, p_idempotency_key, v_entry_id, p_credits)
    RETURNING id INTO v_action_id;

    RETURN jsonb_build_object('ok', true, 'replayed', false, 'action_id', v_action_id,
                               'entry_id', v_entry_id, 'credits_delta', p_credits, 'balance_after', v_after);
END $$;

REVOKE ALL ON FUNCTION public.admin_credit_grant(TEXT, UUID, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_credit_grant(TEXT, UUID, INTEGER, TEXT, TEXT) TO service_role;
