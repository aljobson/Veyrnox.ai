-- ADR-0083 amendment 1: Pack-only clawbacks, with exact replay results.
BEGIN;
ALTER TABLE public.account_actions ADD COLUMN IF NOT EXISTS balance_after INTEGER NULL;
ALTER TABLE public.account_actions DROP CONSTRAINT IF EXISTS account_actions_action_check;
ALTER TABLE public.account_actions ADD CONSTRAINT account_actions_action_check CHECK (action IN (
    'freeze','unfreeze','dispute_resolved','warning','takedown','credit_grant','appeal_upheld','appeal_rejected',
    'csam_escalation','evidence_released','credit_clawback','hold_released','held_asset_viewed','scanner_disarmed'));
CREATE OR REPLACE FUNCTION public.admin_credit_clawback_guarded(
    p_auth_id TEXT,
    p_aal TEXT,
    p_mfa_at BIGINT,
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
    v_pack INTEGER;
    v_entry_id UUID;
    v_after INTEGER;
    v_action_id UUID;
BEGIN
    SELECT u.id, u.email, u.is_admin, u.frozen_at INTO v_admin FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_admin.id IS NULL OR v_admin.is_admin IS NOT TRUE OR v_admin.frozen_at IS NOT NULL OR NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id::text = p_auth_id) THEN
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
    IF p_aal IS DISTINCT FROM 'aal2' OR p_mfa_at IS NULL OR p_mfa_at NOT BETWEEN extract(epoch FROM clock_timestamp())-300 AND extract(epoch FROM clock_timestamp())+5 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'MFA_REQUIRED');
    END IF;
    -- '#' separates the key in a ledger reason, so the actor must not carry one.
    v_actor := left(replace(coalesce(v_admin.email, p_auth_id), '#', '_'), 120);
    IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;

    -- The key is globally unique on account_actions; serialise even different targets.
    PERFORM pg_advisory_xact_lock(278, hashtext(p_idempotency_key));
    -- Same locks as financial freezes, in a fixed order, followed by role/Auth locks.
    PERFORM 1 FROM public.credit_balances b WHERE b.user_id IN (v_admin.id,p_user_id) ORDER BY b.user_id FOR UPDATE;
    PERFORM 1 FROM public.users u WHERE u.id=v_admin.id FOR SHARE;
    PERFORM 1 FROM auth.users a WHERE a.id::text=p_auth_id FOR SHARE;
    IF NOT EXISTS(SELECT 1 FROM public.users u JOIN auth.users a ON a.id::text=u.auth_id
        WHERE u.id=v_admin.id AND u.auth_id=p_auth_id AND u.is_admin AND u.frozen_at IS NULL) THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE='42501';
    END IF;
    -- Waiting for a contended lock may have exhausted the MFA freshness window.
    IF p_aal IS DISTINCT FROM 'aal2' OR p_mfa_at IS NULL OR p_mfa_at NOT BETWEEN extract(epoch FROM clock_timestamp())-300 AND extract(epoch FROM clock_timestamp())+5 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'MFA_REQUIRED');
    END IF;
    SELECT a.id, a.ledger_entry_id, a.credits_delta, a.user_id, a.actor_user_id, a.reason, a.action, a.balance_after INTO v_seen
      FROM public.account_actions a WHERE a.idempotency_key = p_idempotency_key;
    IF v_seen.id IS NOT NULL THEN
        IF v_seen.user_id <> p_user_id OR v_seen.credits_delta IS DISTINCT FROM -p_credits OR v_seen.actor_user_id IS DISTINCT FROM v_admin.id
            OR v_seen.action <> 'credit_clawback' OR v_seen.reason IS DISTINCT FROM btrim(p_reason) THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REUSED');
        END IF;
        v_after := v_seen.balance_after;
        RETURN jsonb_build_object('ok', true, 'replayed', true, 'action_id', v_seen.id,
                                   'entry_id', v_seen.ledger_entry_id, 'credits_delta', v_seen.credits_delta,
                                   'balance_after', v_after);
    END IF;

    SELECT b.balance - COALESCE(b.free_balance, 0) - b.subscription_balance INTO v_pack
      FROM public.credit_balances b WHERE b.user_id = p_user_id;
    IF COALESCE(v_pack, 0) < p_credits THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_PACK_CREDITS', 'pack_credits', COALESCE(v_pack, 0));
    END IF;
    INSERT INTO public.ledger_entries(user_id, delta, free_delta, subscription_delta, reason)
    VALUES (p_user_id, -p_credits, 0, 0, 'reverse:admin ' || v_actor || '#' || p_idempotency_key)
    RETURNING id INTO v_entry_id;
    UPDATE public.credit_balances SET balance = balance - p_credits, updated_at = now() WHERE user_id = p_user_id RETURNING balance INTO v_after;

    INSERT INTO public.account_actions (user_id, action, actor, reason, top_up_id, idempotency_key, ledger_entry_id, credits_delta, actor_user_id, balance_after)
    VALUES (p_user_id, 'credit_clawback', v_actor, btrim(p_reason), NULL, p_idempotency_key, v_entry_id, -p_credits, v_admin.id, v_after)
    RETURNING id INTO v_action_id;

    RETURN jsonb_build_object('ok', true, 'replayed', false, 'action_id', v_action_id,
                               'entry_id', v_entry_id, 'credits_delta', -p_credits, 'balance_after', v_after);
END $$;

REVOKE ALL ON FUNCTION public.admin_credit_clawback_guarded(TEXT,TEXT,BIGINT,UUID,INTEGER,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_credit_clawback_guarded(TEXT,TEXT,BIGINT,UUID,INTEGER,TEXT,TEXT) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
