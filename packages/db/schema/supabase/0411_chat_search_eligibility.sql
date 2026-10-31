-- Capped web-search eligibility gate (assessment F-02, ADR-0307).
--
-- A capped Web search (lib/chatTurn.js) runs our own paid provider call
-- (Exa/Parallel) BEFORE ledger_debit. ledger_debit is the only place that
-- refuses a Frozen or held account, so a Frozen/held account could make the
-- operator pay for one search per attempt before the debit refused. This adds
-- a read-only eligibility check the Worker calls before dispatching the search,
-- so an account the Freeze/hold is meant to stop never reaches the paid call.
--
-- The replay half of F-02 (a repeated idempotency key re-running the paid
-- search) is closed in the Worker: provider_spend_admit_model already reserves
-- the search spend atomically per (user_id, effect_key) and returns
-- idempotent=true on replay, so the Worker skips the live provider call when
-- the reservation already exists. No new state is needed here.
--
-- Read-only, idempotent (OR REPLACE), no catalog UPDATE. Mirrors the exact
-- frozen/hold checks in ledger_debit (0206/0240) and generation admission
-- (0274). A missing user is reported so the Worker can fail closed.

CREATE OR REPLACE FUNCTION public.account_spend_eligible(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_frozen BOOLEAN;
    v_hold_until TIMESTAMPTZ;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    SELECT u.frozen_at IS NOT NULL INTO v_frozen FROM public.users u WHERE u.id = p_user_id;
    IF v_frozen IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    IF v_frozen THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN');
    END IF;
    SELECT u.hold_until INTO v_hold_until FROM public.users u WHERE u.id = p_user_id AND u.hold_until > now();
    IF v_hold_until IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_ON_HOLD', 'hold_until', v_hold_until);
    END IF;
    RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.account_spend_eligible(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_spend_eligible(UUID) TO service_role;
