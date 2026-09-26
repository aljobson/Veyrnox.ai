-- 0143_cinema_passes.sql — ADR-0057 Phase 2: Cinema Pass.
--
-- A Cinema Pass is a recurring Stripe subscription that grants unlimited
-- viewing while active. It grants no credits: nothing in this file touches
-- ledger_entries or credit_balances, so reconciliation is unaffected.
-- Additive and idempotent. Ships behind CINEMA_SUBSCRIPTIONS_ENABLED (off).
--
-- Identity: a Pass is found by its Stripe subscription id, or bound once from
-- the pass id our checkout signed into the subscription's metadata. No user id
-- is ever taken from a payload (CLAUDE.md, Provider webhooks).

-- ── Plans: the only source of a Pass price ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cinema_pass_plans (
    id                    TEXT        PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{1,32}$'),
    billing_interval      TEXT        NOT NULL CHECK (billing_interval IN ('week', 'month', 'year')),
    price_usd_cents       INTEGER     NOT NULL CHECK (price_usd_cents BETWEEN 999 AND 9999999),
    intro_price_usd_cents INTEGER     NULL CHECK (intro_price_usd_cents IS NULL OR intro_price_usd_cents BETWEEN 499 AND 9999999),
    active                BOOLEAN     NOT NULL DEFAULT true,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cinema_pass_plans_intro_below_price
        CHECK (intro_price_usd_cents IS NULL OR intro_price_usd_cents < price_usd_cents)
);
ALTER TABLE public.cinema_pass_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_pass_plans FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_pass_plans FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO public.cinema_pass_plans (id, billing_interval, price_usd_cents, intro_price_usd_cents)
VALUES ('pass-weekly', 'week', 1499, 1199), ('pass-monthly', 'month', 4999, NULL), ('pass-yearly', 'year', 19999, NULL)
ON CONFLICT (id) DO NOTHING;

-- ── Passes ────────────────────────────────────────────────────────────────
-- pending: checkout started, nothing paid. active/past_due: entitled while
-- current_period_end is in the future. ended: over, with a reason. flagged: a
-- second subscription paid for while another Pass was live; an Operator
-- refunds it and it never entitles.
CREATE TABLE IF NOT EXISTS public.cinema_passes (
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                UUID        NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    plan_id                TEXT        NOT NULL REFERENCES public.cinema_pass_plans(id) ON DELETE RESTRICT,
    idempotency_key        TEXT        NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._-]{8,128}$'),
    price_usd_cents        INTEGER     NOT NULL CHECK (price_usd_cents > 0),
    intro_price_usd_cents  INTEGER     NULL CHECK (intro_price_usd_cents IS NULL OR intro_price_usd_cents > 0),
    consent_version        TEXT        NOT NULL CHECK (consent_version ~ '^[A-Za-z0-9._-]{1,32}$'),
    consent_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    status                 TEXT        NOT NULL DEFAULT 'pending'
                                       CHECK (status IN ('pending', 'active', 'past_due', 'ended', 'flagged')),
    stripe_session_id      TEXT        NULL CHECK (stripe_session_id IS NULL OR stripe_session_id ~ '^cs_[A-Za-z0-9_]{1,251}$'),
    stripe_subscription_id TEXT        NULL UNIQUE CHECK (stripe_subscription_id IS NULL OR stripe_subscription_id ~ '^sub_[A-Za-z0-9_]{1,250}$'),
    stripe_customer_id     TEXT        NULL CHECK (stripe_customer_id IS NULL OR stripe_customer_id ~ '^cus_[A-Za-z0-9_]{1,250}$'),
    current_period_end     TIMESTAMPTZ NULL,
    cancel_at_period_end   BOOLEAN     NOT NULL DEFAULT false,
    last_event_at          TIMESTAMPTZ NULL,
    started_at             TIMESTAMPTZ NULL,
    ended_at               TIMESTAMPTZ NULL,
    end_reason             TEXT        NULL CHECK (end_reason IS NULL OR end_reason IN
                                       ('subscription_ended', 'refunded', 'disputed', 'cancelled_cooling_off', 'superseded')),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cinema_passes_one_key UNIQUE (user_id, idempotency_key),
    CONSTRAINT cinema_passes_ended_pair CHECK ((status = 'ended') = (ended_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS cinema_passes_one_live_per_user
    ON public.cinema_passes (user_id) WHERE status IN ('active', 'past_due');
CREATE INDEX IF NOT EXISTS cinema_passes_user_created_idx ON public.cinema_passes (user_id, created_at);
ALTER TABLE public.cinema_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_passes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_passes FROM PUBLIC, anon, authenticated, service_role;

-- Every applied Stripe event, append-only, deduped on the event id. A return
-- from checkout recovers through the same table with the session id as the
-- event id, so a lost webhook and a later redelivery agree.
CREATE TABLE IF NOT EXISTS public.cinema_pass_events (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    pass_id         UUID        NULL REFERENCES public.cinema_passes(id) ON DELETE RESTRICT,
    stripe_event_id TEXT        NOT NULL UNIQUE CHECK (stripe_event_id ~ '^(evt|cs)_[A-Za-z0-9_]{1,250}$'),
    type            TEXT        NOT NULL CHECK (type ~ '^[a-z_.]{1,64}$'),
    status          TEXT        NULL CHECK (status IS NULL OR status ~ '^[a-z_]{1,32}$'),
    period_end      TIMESTAMPTZ NULL,
    occurred_at     TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cinema_pass_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_pass_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_pass_events FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.cinema_pass_events_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    RAISE EXCEPTION 'cinema_pass_events is append-only';
END $$;
DROP TRIGGER IF EXISTS cinema_pass_events_append_only ON public.cinema_pass_events;
CREATE TRIGGER cinema_pass_events_append_only
    BEFORE UPDATE OR DELETE ON public.cinema_pass_events
    FOR EACH ROW EXECUTE FUNCTION public.cinema_pass_events_append_only();

-- ── list_cinema_pass_plans: what the page offers ──────────────────────────
CREATE OR REPLACE FUNCTION public.list_cinema_pass_plans()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', p.id, 'billing_interval', p.billing_interval,
        'price_usd_cents', p.price_usd_cents, 'intro_price_usd_cents', p.intro_price_usd_cents)
        ORDER BY p.price_usd_cents), '[]'::jsonb)
    FROM public.cinema_pass_plans p WHERE p.active;
$$;

-- ── start_cinema_pass: a pending Pass before the hosted checkout ──────────
-- {ok:true, idempotent, pass_id, plan_id, billing_interval, price_usd_cents,
-- intro_price_usd_cents (NULL unless this account is still eligible)} or
-- {ok:false, code} with BAD_LIMIT, USER_NOT_FOUND, ACCOUNT_FROZEN,
-- ACCOUNT_NOT_ACTIVE, IDEMPOTENCY_KEY_REQUIRED, IDEMPOTENCY_KEY_REUSED,
-- CONSENT_VERSION_REQUIRED, PLAN_NOT_FOUND, PASS_ALREADY_ACTIVE, RATE_LIMITED.
-- The intro price is decided here, once per account, never from the client.
CREATE OR REPLACE FUNCTION public.start_cinema_pass(
    p_auth_id TEXT,
    p_plan_id TEXT,
    p_idempotency_key TEXT,
    p_consent_version TEXT,
    p_limit_per_window INTEGER,
    p_window_seconds INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user     UUID;
    v_frozen   BOOLEAN;
    v_status   TEXT;
    v_plan     public.cinema_pass_plans%ROWTYPE;
    v_existing public.cinema_passes%ROWTYPE;
    v_count    INTEGER;
    v_retry    INTEGER;
    v_intro    INTEGER;
    v_pass_id  UUID;
BEGIN
    IF p_limit_per_window IS NULL OR p_limit_per_window <= 0
       OR p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BAD_LIMIT');
    END IF;
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    SELECT u.id, u.frozen_at IS NOT NULL INTO v_user, v_frozen
    FROM public.users u JOIN auth.users a ON a.id = p_auth_id::UUID
    WHERE u.auth_id = p_auth_id
    FOR NO KEY UPDATE OF u;
    IF v_user IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    IF v_frozen THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN');
    END IF;
    SELECT m.account_status INTO v_status FROM public.cinema_memberships m WHERE m.user_id = v_user;
    IF v_status IS NOT NULL AND v_status <> 'active' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_NOT_ACTIVE');
    END IF;
    IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,128}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REQUIRED');
    END IF;

    SELECT * INTO v_existing FROM public.cinema_passes x
    WHERE x.user_id = v_user AND x.idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_existing.plan_id <> p_plan_id THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REUSED');
        END IF;
        SELECT * INTO v_plan FROM public.cinema_pass_plans p WHERE p.id = v_existing.plan_id;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'pass_id', v_existing.id,
            'plan_id', v_existing.plan_id, 'billing_interval', v_plan.billing_interval,
            'price_usd_cents', v_existing.price_usd_cents, 'intro_price_usd_cents', v_existing.intro_price_usd_cents,
            'status', v_existing.status);
    END IF;

    IF p_consent_version IS NULL OR p_consent_version !~ '^[A-Za-z0-9._-]{1,32}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CONSENT_VERSION_REQUIRED');
    END IF;
    SELECT * INTO v_plan FROM public.cinema_pass_plans p WHERE p.id = p_plan_id AND p.active;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PLAN_NOT_FOUND');
    END IF;
    IF EXISTS (SELECT 1 FROM public.cinema_passes x WHERE x.user_id = v_user AND x.status IN ('active', 'past_due')) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PASS_ALREADY_ACTIVE');
    END IF;

    SELECT count(*) INTO v_count FROM public.cinema_passes x
    WHERE x.user_id = v_user AND x.created_at > now() - make_interval(secs => p_window_seconds);
    IF v_count >= p_limit_per_window THEN
        SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
            min(x.created_at) + make_interval(secs => p_window_seconds) - now()
        ))))::int INTO v_retry
        FROM public.cinema_passes x
        WHERE x.user_id = v_user AND x.created_at > now() - make_interval(secs => p_window_seconds);
        RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED',
            'retry_after_seconds', COALESCE(v_retry, p_window_seconds));
    END IF;

    -- Intro price once per account: any Pass that was ever paid for burns it,
    -- an abandoned checkout does not.
    v_intro := v_plan.intro_price_usd_cents;
    IF v_intro IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.cinema_passes x
        WHERE x.user_id = v_user AND x.intro_price_usd_cents IS NOT NULL
          AND x.status IN ('active', 'past_due', 'ended', 'flagged')
    ) THEN
        v_intro := NULL;
    END IF;

    INSERT INTO public.cinema_passes (user_id, plan_id, idempotency_key, price_usd_cents, intro_price_usd_cents, consent_version)
    VALUES (v_user, v_plan.id, p_idempotency_key, v_plan.price_usd_cents, v_intro, p_consent_version)
    RETURNING id INTO v_pass_id;

    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'pass_id', v_pass_id,
        'plan_id', v_plan.id, 'billing_interval', v_plan.billing_interval,
        'price_usd_cents', v_plan.price_usd_cents, 'intro_price_usd_cents', v_intro, 'status', 'pending');
END $$;

-- ── record_cinema_pass_session: the buyer came back from checkout ─────────
CREATE OR REPLACE FUNCTION public.record_cinema_pass_session(p_auth_id TEXT, p_pass_id UUID, p_session_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_pass public.cinema_passes%ROWTYPE;
BEGIN
    IF p_session_id IS NULL OR p_session_id !~ '^cs_[A-Za-z0-9_]{1,251}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SESSION_ID');
    END IF;
    SELECT x.* INTO v_pass FROM public.cinema_passes x JOIN public.users u ON u.id = x.user_id
    WHERE x.id = p_pass_id AND u.auth_id = p_auth_id
    FOR UPDATE OF x;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PASS_NOT_FOUND');
    END IF;
    -- While pending the value is only a hint the return route verifies with
    -- Stripe, so a wrong one may be replaced; once the Pass is bound it is fixed.
    IF v_pass.stripe_session_id IS NOT NULL AND v_pass.stripe_session_id <> p_session_id AND v_pass.status <> 'pending' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SESSION_MISMATCH');
    END IF;
    UPDATE public.cinema_passes SET stripe_session_id = p_session_id, updated_at = now() WHERE id = v_pass.id;
    RETURN jsonb_build_object('ok', true, 'pass_id', v_pass.id, 'status', v_pass.status);
END $$;

-- ── apply_cinema_pass_event: the only writer of a Pass's Stripe state ─────
-- p_status is our mapped status: active | past_due | ended | incomplete.
-- The Pass is found by subscription id, or bound once from p_pass_id (the id
-- our checkout signed) while it is pending. An older event than the last one
-- applied is recorded but changes nothing. Returns {ok:true, pass_id, user_id,
-- status, idempotent, stale, flagged} or {ok:false, code} with INVALID_EVENT,
-- INVALID_SUBSCRIPTION, PASS_NOT_FOUND or PASS_MISMATCH.
CREATE OR REPLACE FUNCTION public.apply_cinema_pass_event(
    p_event_id TEXT,
    p_type TEXT,
    p_pass_id UUID,
    p_subscription_id TEXT,
    p_customer_id TEXT,
    p_status TEXT,
    p_period_end TIMESTAMPTZ,
    p_cancel_at_period_end BOOLEAN,
    p_occurred_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_pass    public.cinema_passes%ROWTYPE;
    v_event   public.cinema_pass_events%ROWTYPE;
    v_new     TEXT;
    v_flagged BOOLEAN := false;
BEGIN
    IF p_event_id IS NULL OR p_event_id !~ '^(evt|cs)_[A-Za-z0-9_]{1,250}$'
       OR p_type IS NULL OR p_type !~ '^[a-z_.]{1,64}$'
       OR p_status IS NULL OR p_status NOT IN ('active', 'past_due', 'ended', 'incomplete')
       OR p_occurred_at IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_EVENT');
    END IF;
    IF p_subscription_id IS NULL OR p_subscription_id !~ '^sub_[A-Za-z0-9_]{1,250}$'
       OR (p_customer_id IS NOT NULL AND p_customer_id !~ '^cus_[A-Za-z0-9_]{1,250}$') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SUBSCRIPTION');
    END IF;

    SELECT * INTO v_event FROM public.cinema_pass_events e WHERE e.stripe_event_id = p_event_id;
    IF FOUND THEN
        -- A replay still reports the Pass's state so the caller can repeat a
        -- side effect it owns (cancelling a flagged subscription at Stripe).
        SELECT x.status INTO v_new FROM public.cinema_passes x WHERE x.id = v_event.pass_id;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'pass_id', v_event.pass_id,
                                  'status', v_new, 'flagged', v_new = 'flagged');
    END IF;

    SELECT * INTO v_pass FROM public.cinema_passes x WHERE x.stripe_subscription_id = p_subscription_id FOR UPDATE;
    IF FOUND THEN
        IF p_pass_id IS NOT NULL AND p_pass_id <> v_pass.id THEN
            RETURN jsonb_build_object('ok', false, 'code', 'PASS_MISMATCH');
        END IF;
    ELSE
        IF p_pass_id IS NULL THEN
            RETURN jsonb_build_object('ok', false, 'code', 'PASS_NOT_FOUND');
        END IF;
        SELECT * INTO v_pass FROM public.cinema_passes x
        WHERE x.id = p_pass_id AND x.status = 'pending' AND x.stripe_subscription_id IS NULL
        FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('ok', false, 'code', 'PASS_NOT_FOUND');
        END IF;
        UPDATE public.cinema_passes SET stripe_subscription_id = p_subscription_id, updated_at = now()
        WHERE id = v_pass.id;
        v_pass.stripe_subscription_id := p_subscription_id;
    END IF;

    -- Order is Stripe's `created`; a redelivered or out-of-order older event
    -- cannot regress the Pass. Terminal states are never resurrected.
    IF (v_pass.last_event_at IS NOT NULL AND p_occurred_at < v_pass.last_event_at)
       OR v_pass.status IN ('ended', 'flagged') THEN
        INSERT INTO public.cinema_pass_events (pass_id, stripe_event_id, type, status, period_end, occurred_at)
        VALUES (v_pass.id, p_event_id, p_type, p_status, p_period_end, p_occurred_at);
        RETURN jsonb_build_object('ok', true, 'idempotent', false, 'stale', true, 'pass_id', v_pass.id,
                                  'user_id', v_pass.user_id, 'status', v_pass.status, 'flagged', v_pass.status = 'flagged');
    END IF;

    v_new := CASE p_status WHEN 'incomplete' THEN 'pending' ELSE p_status END;
    IF v_new IN ('active', 'past_due') AND v_pass.status NOT IN ('active', 'past_due') AND EXISTS (
        SELECT 1 FROM public.cinema_passes o
        WHERE o.user_id = v_pass.user_id AND o.id <> v_pass.id AND o.status IN ('active', 'past_due')
    ) THEN
        -- Paid twice while a Pass was live: never entitle, flag for an Operator refund.
        v_new := 'flagged';
        v_flagged := true;
    END IF;

    UPDATE public.cinema_passes SET
        status = v_new,
        stripe_customer_id = COALESCE(p_customer_id, stripe_customer_id),
        current_period_end = COALESCE(p_period_end, current_period_end),
        cancel_at_period_end = COALESCE(p_cancel_at_period_end, cancel_at_period_end),
        started_at = CASE WHEN v_new IN ('active', 'past_due') THEN COALESCE(started_at, p_occurred_at) ELSE started_at END,
        ended_at = CASE WHEN v_new = 'ended' THEN COALESCE(ended_at, p_occurred_at) ELSE ended_at END,
        end_reason = CASE WHEN v_new = 'ended' THEN COALESCE(end_reason, 'subscription_ended')
                          WHEN v_new = 'flagged' THEN 'superseded' ELSE end_reason END,
        last_event_at = p_occurred_at,
        updated_at = now()
    WHERE id = v_pass.id;

    INSERT INTO public.cinema_pass_events (pass_id, stripe_event_id, type, status, period_end, occurred_at)
    VALUES (v_pass.id, p_event_id, p_type, p_status, p_period_end, p_occurred_at);

    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'stale', false, 'flagged', v_flagged,
                              'pass_id', v_pass.id, 'user_id', v_pass.user_id, 'status', v_new);
END $$;

-- ── end_cinema_pass: money came back, so viewing stops ────────────────────
-- p_reason 'refunded' ends the Pass. 'disputed' ends it and Freezes the
-- account (ADR-0019: a dispute is a Chargeback whatever it is on). Idempotent
-- on the event id; a Pass already ended keeps its first reason.
CREATE OR REPLACE FUNCTION public.end_cinema_pass(
    p_subscription_id TEXT,
    p_event_id TEXT,
    p_reason TEXT,
    p_reference TEXT,
    p_occurred_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_pass   public.cinema_passes%ROWTYPE;
    v_frozen BOOLEAN := false;
BEGIN
    IF p_event_id IS NULL OR p_event_id !~ '^(evt|cs)_[A-Za-z0-9_]{1,250}$'
       OR p_reason IS NULL OR p_reason NOT IN ('refunded', 'disputed') OR p_occurred_at IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_EVENT');
    END IF;
    IF p_subscription_id IS NULL OR p_subscription_id !~ '^sub_[A-Za-z0-9_]{1,250}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SUBSCRIPTION');
    END IF;
    IF EXISTS (SELECT 1 FROM public.cinema_pass_events e WHERE e.stripe_event_id = p_event_id) THEN
        RETURN jsonb_build_object('ok', true, 'idempotent', true);
    END IF;
    SELECT * INTO v_pass FROM public.cinema_passes x WHERE x.stripe_subscription_id = p_subscription_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PASS_NOT_FOUND');
    END IF;

    IF v_pass.status <> 'ended' THEN
        UPDATE public.cinema_passes SET
            status = 'ended', ended_at = p_occurred_at, end_reason = p_reason,
            last_event_at = GREATEST(COALESCE(last_event_at, p_occurred_at), p_occurred_at), updated_at = now()
        WHERE id = v_pass.id;
    END IF;
    INSERT INTO public.cinema_pass_events (pass_id, stripe_event_id, type, status, period_end, occurred_at)
    VALUES (v_pass.id, p_event_id, 'pass.' || p_reason, 'ended', NULL, p_occurred_at);

    IF p_reason = 'disputed' THEN
        -- Same lock order as ledger_debit and apply_dispute_event.
        PERFORM 1 FROM public.credit_balances b WHERE b.user_id = v_pass.user_id FOR UPDATE;
        PERFORM public.freeze_account(v_pass.user_id,
            left(format('Stripe dispute %s on Cinema Pass subscription %s',
                        COALESCE(NULLIF(btrim(p_reference), ''), 'without reference'), p_subscription_id), 500),
            NULL);
        v_frozen := true;
    END IF;
    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'pass_id', v_pass.id, 'user_id', v_pass.user_id,
                              'frozen', v_frozen);
END $$;

-- ── read_own_cinema_pass: the caller's newest Pass, Stripe ids included ───
-- Server use only; the route strips the Stripe ids before replying.
CREATE OR REPLACE FUNCTION public.read_own_cinema_pass(p_auth_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user UUID;
    v_pass public.cinema_passes%ROWTYPE;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    SELECT u.id INTO v_user FROM public.users u JOIN auth.users a ON a.id = p_auth_id::UUID WHERE u.auth_id = p_auth_id;
    IF v_user IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    SELECT * INTO v_pass FROM public.cinema_passes x WHERE x.user_id = v_user
    ORDER BY (x.status IN ('active', 'past_due')) DESC, x.created_at DESC LIMIT 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', true, 'pass', NULL);
    END IF;
    RETURN jsonb_build_object('ok', true, 'pass', jsonb_build_object(
        'id', v_pass.id, 'plan_id', v_pass.plan_id, 'status', v_pass.status,
        'price_usd_cents', v_pass.price_usd_cents, 'intro_price_usd_cents', v_pass.intro_price_usd_cents,
        'current_period_end', v_pass.current_period_end, 'cancel_at_period_end', v_pass.cancel_at_period_end,
        'started_at', v_pass.started_at, 'ended_at', v_pass.ended_at, 'end_reason', v_pass.end_reason,
        'created_at', v_pass.created_at,
        'stripe_subscription_id', v_pass.stripe_subscription_id, 'stripe_customer_id', v_pass.stripe_customer_id));
END $$;

-- ── mark_cinema_pass_cancelled: our side of a cancellation we made at Stripe
-- 'cooling_off' ends the Pass now (the refund was issued first); 'period_end'
-- records that it will not renew. Both idempotent; only the owner's live Pass.
CREATE OR REPLACE FUNCTION public.mark_cinema_pass_cancelled(p_auth_id TEXT, p_pass_id UUID, p_mode TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_pass public.cinema_passes%ROWTYPE;
BEGIN
    IF p_mode IS NULL OR p_mode NOT IN ('cooling_off', 'period_end') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_MODE');
    END IF;
    SELECT x.* INTO v_pass FROM public.cinema_passes x JOIN public.users u ON u.id = x.user_id
    WHERE x.id = p_pass_id AND u.auth_id = p_auth_id
    FOR UPDATE OF x;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PASS_NOT_FOUND');
    END IF;
    IF p_mode = 'cooling_off' THEN
        IF v_pass.status <> 'ended' THEN
            UPDATE public.cinema_passes SET status = 'ended', ended_at = now(), end_reason = 'cancelled_cooling_off',
                cancel_at_period_end = true, updated_at = now() WHERE id = v_pass.id;
        END IF;
        RETURN jsonb_build_object('ok', true, 'status', 'ended');
    END IF;
    IF v_pass.status NOT IN ('active', 'past_due') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PASS_NOT_LIVE');
    END IF;
    UPDATE public.cinema_passes SET cancel_at_period_end = true, updated_at = now() WHERE id = v_pass.id;
    RETURN jsonb_build_object('ok', true, 'status', v_pass.status, 'current_period_end', v_pass.current_period_end);
END $$;

-- ── cinema_entitlement: same signature as 0142, now with 'pass' ───────────
-- A permanent Unlock is reported before a Pass; a live Pass entitles while its
-- period end is in the future. Phase 3 adds the monthly viewing ceiling.
CREATE OR REPLACE FUNCTION public.cinema_entitlement(p_auth_id TEXT, p_content_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_price INTEGER;
    v_user  UUID;
BEGIN
    v_price := public.cinema_unlock_price(p_content_id);
    IF v_price IS NULL THEN
        RETURN jsonb_build_object('error', 'content_not_found');
    END IF;
    IF v_price = 0 THEN
        RETURN jsonb_build_object('access', 'free', 'credits', 0);
    END IF;
    IF p_auth_id IS NOT NULL AND p_auth_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT u.id INTO v_user FROM public.users u WHERE u.auth_id = p_auth_id;
        IF v_user IS NOT NULL THEN
            IF EXISTS (SELECT 1 FROM public.cinema_unlocks x
                       WHERE x.user_id = v_user AND x.content_id = p_content_id AND x.reversed_at IS NULL) THEN
                RETURN jsonb_build_object('access', 'unlocked', 'credits', 0);
            END IF;
            IF EXISTS (SELECT 1 FROM public.cinema_passes p
                       WHERE p.user_id = v_user AND p.status IN ('active', 'past_due')
                         AND p.current_period_end IS NOT NULL AND p.current_period_end > now()) THEN
                RETURN jsonb_build_object('access', 'pass', 'credits', 0);
            END IF;
        END IF;
    END IF;
    RETURN jsonb_build_object('access', 'locked', 'credits', v_price);
END $$;

-- ── Grants ────────────────────────────────────────────────────────────────
DO $$
DECLARE fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.list_cinema_pass_plans()',
        'public.start_cinema_pass(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER)',
        'public.record_cinema_pass_session(TEXT, UUID, TEXT)',
        'public.apply_cinema_pass_event(TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ)',
        'public.end_cinema_pass(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ)',
        'public.read_own_cinema_pass(TEXT)',
        'public.mark_cinema_pass_cancelled(TEXT, UUID, TEXT)',
        'public.cinema_entitlement(TEXT, UUID)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
    REVOKE ALL ON FUNCTION public.cinema_pass_events_append_only() FROM PUBLIC, anon, authenticated;
END $$;
