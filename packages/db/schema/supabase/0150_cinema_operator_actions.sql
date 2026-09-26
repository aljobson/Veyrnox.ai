-- ADR-0057: authenticated Operator reversals and recoverable flagged-Pass refunds.
-- Requests and successful receipts are append-only. No Pass path writes credits.
CREATE TABLE IF NOT EXISTS public.cinema_operator_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID NOT NULL,
    idempotency_key UUID NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('reverse_unlocks', 'refund_pass')),
    target_id UUID NOT NULL,
    reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
    request_id UUID NOT NULL,
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (actor_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS cinema_operator_one_pass_refund
    ON public.cinema_operator_actions(target_id) WHERE action = 'refund_pass';
CREATE TABLE IF NOT EXISTS public.cinema_operator_refund_receipts (
    action_id UUID PRIMARY KEY REFERENCES public.cinema_operator_actions(id) ON DELETE RESTRICT,
    stripe_refund_id TEXT NOT NULL UNIQUE CHECK (stripe_refund_id ~ '^re_[A-Za-z0-9_]{1,250}$'),
    amount_usd_cents INTEGER NOT NULL CHECK (amount_usd_cents > 0),
    request_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cinema_operator_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_operator_actions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_operator_refund_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_operator_refund_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_operator_actions, public.cinema_operator_refund_receipts FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS cinema_operator_actions_append_only ON public.cinema_operator_actions;
CREATE TRIGGER cinema_operator_actions_append_only BEFORE UPDATE OR DELETE ON public.cinema_operator_actions
    FOR EACH ROW EXECUTE FUNCTION public.cinema_publication_append_only();
DROP TRIGGER IF EXISTS cinema_operator_refund_receipts_append_only ON public.cinema_operator_refund_receipts;
CREATE TRIGGER cinema_operator_refund_receipts_append_only BEFORE UPDATE OR DELETE ON public.cinema_operator_refund_receipts
    FOR EACH ROW EXECUTE FUNCTION public.cinema_publication_append_only();

-- Financial Operator role (users.is_admin), not the Cinema publication reviewer role.
CREATE OR REPLACE FUNCTION public.cinema_operator_actor(p_auth_id TEXT, p_aal TEXT, p_mfa_at BIGINT)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT u.id FROM public.users u JOIN auth.users a ON a.id::text = u.auth_id
    WHERE u.auth_id = p_auth_id AND u.is_admin IS TRUE AND u.frozen_at IS NULL
      AND p_aal = 'aal2' AND p_mfa_at BETWEEN extract(epoch FROM now()) - 300 AND extract(epoch FROM now()) + 5
      AND NOT EXISTS (SELECT 1 FROM public.cinema_memberships m WHERE m.user_id = u.id AND m.account_status <> 'active');
$$;

CREATE OR REPLACE FUNCTION public.begin_cinema_operator_action(
    p_auth_id TEXT, p_aal TEXT, p_mfa_at BIGINT, p_idempotency_key UUID,
    p_action TEXT, p_target_id UUID, p_reason TEXT, p_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_actor UUID;
    v_action public.cinema_operator_actions%ROWTYPE;
    v_pass public.cinema_passes%ROWTYPE;
    v_status TEXT;
    v_result JSONB;
    v_receipt public.cinema_operator_refund_receipts%ROWTYPE;
BEGIN
    v_actor := public.cinema_operator_actor(p_auth_id, p_aal, p_mfa_at);
    IF v_actor IS NULL THEN RETURN jsonb_build_object('error', 'not_authorized'); END IF;
    IF p_action IS NULL OR p_action NOT IN ('reverse_unlocks', 'refund_pass') OR p_target_id IS NULL
       OR p_idempotency_key IS NULL OR p_request_id IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
        RETURN jsonb_build_object('error', 'invalid_request');
    END IF;
    -- Serialize key reuse even if competing requests name different targets.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text || ':' || p_idempotency_key::text, 0));
    SELECT * INTO v_action FROM public.cinema_operator_actions WHERE actor_id = v_actor AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_action.action <> p_action OR v_action.target_id <> p_target_id OR v_action.reason <> btrim(p_reason) THEN
            RETURN jsonb_build_object('error', 'idempotency_conflict');
        END IF;
        IF p_action = 'reverse_unlocks' THEN RETURN v_action.result || jsonb_build_object('idempotent', true); END IF;
        SELECT * INTO v_receipt FROM public.cinema_operator_refund_receipts WHERE action_id = v_action.id;
        IF FOUND THEN RETURN jsonb_build_object('ok', true, 'complete', true, 'pass_id', p_target_id,
            'refund_usd_cents', v_receipt.amount_usd_cents, 'idempotent', true); END IF;
    END IF;
    IF p_action = 'reverse_unlocks' THEN
        SELECT lifecycle_status INTO v_status FROM public.cinema_content WHERE id = p_target_id FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('error', 'content_not_found'); END IF;
        IF v_status = 'PUBLISHED' THEN RETURN jsonb_build_object('error', 'content_still_published'); END IF;
        v_result := public.reverse_cinema_unlocks(p_target_id, 'operator:' || p_auth_id, btrim(p_reason));
        IF v_result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'reversal failed'; END IF;
        v_result := v_result || jsonb_build_object('content_id', p_target_id, 'idempotent', false);
        INSERT INTO public.cinema_operator_actions(actor_id, idempotency_key, action, target_id, reason, request_id, result)
            VALUES(v_actor, p_idempotency_key, p_action, p_target_id, btrim(p_reason), p_request_id, v_result);
        RETURN v_result;
    END IF;
    SELECT * INTO v_pass FROM public.cinema_passes WHERE id = p_target_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'pass_not_found'); END IF;
    IF v_action.id IS NULL THEN
        IF v_pass.status <> 'flagged' THEN RETURN jsonb_build_object('error', 'pass_not_flagged'); END IF;
        IF EXISTS (SELECT 1 FROM public.cinema_operator_actions WHERE action = 'refund_pass' AND target_id = p_target_id) THEN
            RETURN jsonb_build_object('error', 'refund_already_requested');
        END IF;
        IF v_pass.stripe_subscription_id IS NULL OR v_pass.stripe_customer_id IS NULL THEN
            RETURN jsonb_build_object('error', 'pass_not_configured');
        END IF;
        INSERT INTO public.cinema_operator_actions(actor_id, idempotency_key, action, target_id, reason, request_id)
            VALUES(v_actor, p_idempotency_key, p_action, p_target_id, btrim(p_reason), p_request_id) RETURNING * INTO v_action;
    END IF;
    -- A refund webhook can end the Pass before this request records its receipt.
    RETURN jsonb_build_object('ok', true, 'complete', false, 'action_id', v_action.id,
        'pass_id', v_pass.id, 'subscription_id', v_pass.stripe_subscription_id, 'customer_id', v_pass.stripe_customer_id);
END $$;

CREATE OR REPLACE FUNCTION public.complete_cinema_operator_refund(
    p_auth_id TEXT, p_aal TEXT, p_mfa_at BIGINT, p_action_id UUID,
    p_refund_id TEXT, p_amount_usd_cents INTEGER, p_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_actor UUID;
    v_action public.cinema_operator_actions%ROWTYPE;
    v_receipt public.cinema_operator_refund_receipts%ROWTYPE;
BEGIN
    v_actor := public.cinema_operator_actor(p_auth_id, p_aal, p_mfa_at);
    IF v_actor IS NULL THEN RETURN jsonb_build_object('error', 'not_authorized'); END IF;
    IF p_refund_id IS NULL OR p_refund_id !~ '^re_[A-Za-z0-9_]{1,250}$'
       OR p_amount_usd_cents IS NULL OR p_amount_usd_cents <= 0 OR p_request_id IS NULL THEN
        RETURN jsonb_build_object('error', 'invalid_request');
    END IF;
    SELECT * INTO v_action FROM public.cinema_operator_actions
        WHERE id = p_action_id AND actor_id = v_actor AND action = 'refund_pass' FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'action_not_found'); END IF;
    SELECT * INTO v_receipt FROM public.cinema_operator_refund_receipts WHERE action_id = p_action_id;
    IF FOUND THEN
        IF v_receipt.stripe_refund_id <> p_refund_id OR v_receipt.amount_usd_cents <> p_amount_usd_cents THEN
            RETURN jsonb_build_object('error', 'idempotency_conflict');
        END IF;
        RETURN jsonb_build_object('ok', true, 'pass_id', v_action.target_id, 'refund_usd_cents', p_amount_usd_cents, 'idempotent', true);
    END IF;
    INSERT INTO public.cinema_operator_refund_receipts(action_id, stripe_refund_id, amount_usd_cents, request_id)
        VALUES(p_action_id, p_refund_id, p_amount_usd_cents, p_request_id);
    -- Preserve a dispute reason written by a racing webhook. Never touch the live sibling Pass.
    UPDATE public.cinema_passes SET status = 'ended', end_reason = 'refunded', ended_at = now(), updated_at = now()
        WHERE id = v_action.target_id AND status = 'flagged';
    RETURN jsonb_build_object('ok', true, 'pass_id', v_action.target_id, 'refund_usd_cents', p_amount_usd_cents, 'idempotent', false);
END $$;
REVOKE ALL ON FUNCTION public.cinema_operator_actor(TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.begin_cinema_operator_action(TEXT, TEXT, BIGINT, UUID, TEXT, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_cinema_operator_action(TEXT, TEXT, BIGINT, UUID, TEXT, UUID, TEXT, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.complete_cinema_operator_refund(TEXT, TEXT, BIGINT, UUID, TEXT, INTEGER, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_cinema_operator_refund(TEXT, TEXT, BIGINT, UUID, TEXT, INTEGER, UUID) TO service_role;
