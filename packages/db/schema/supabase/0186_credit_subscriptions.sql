-- 0186_credit_subscriptions.sql — ADR-0064, IMPLEMENTATION-PLAN C4 (database).
--
-- A Subscription is a recurring Stripe subscription whose paid invoices grant
-- one cycle of Subscription Credits (0183/0184). This file holds its state:
-- plans, the Subscription row and its event log. 0187 holds the functions
-- that move credits. Same shape as the Cinema Pass (0143), which it is not: a
-- Pass grants viewing and no credits.
--
-- Nothing calls these functions until the routes and webhook ship (behind
-- CREDIT_SUBSCRIPTIONS_ENABLED, off). Additive and idempotent.
--
-- Identity: a Subscription is found by its Stripe subscription id, or bound
-- once from the id our checkout signed into the subscription's metadata. No
-- user id is ever taken from a payload (CLAUDE.md, Provider webhooks).

SET LOCAL lock_timeout = '5s';

-- ── Plans: the only source of a Subscription's price and credits ──────────
-- `tier` orders the plans: a higher tier is an upgrade (ADR-0064, Plan changes).
-- Monthly only: annual prices below Ultra are not decided.
CREATE TABLE IF NOT EXISTS public.credit_subscription_plans (
    id                TEXT        PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{1,32}$'),
    tier              INTEGER     NOT NULL CHECK (tier BETWEEN 1 AND 99),
    billing_interval  TEXT        NOT NULL CHECK (billing_interval IN ('month', 'year')),
    price_usd_cents   INTEGER     NOT NULL CHECK (price_usd_cents BETWEEN 100 AND 9999999),
    credits_per_cycle INTEGER     NOT NULL CHECK (credits_per_cycle BETWEEN 1 AND 100000),
    active            BOOLEAN     NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- ADR-0014: no plan below $0.033 (3.3 cents) a credit before fees.
    CONSTRAINT credit_subscription_plans_price_floor
        CHECK (price_usd_cents::BIGINT * 10 >= credits_per_cycle::BIGINT * 33)
);
ALTER TABLE public.credit_subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_subscription_plans FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.credit_subscription_plans FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO public.credit_subscription_plans (id, tier, billing_interval, price_usd_cents, credits_per_cycle)
VALUES ('starter-monthly', 1, 'month', 1900, 270),
       ('plus-monthly', 2, 'month', 5900, 1200),
       ('ultra-monthly', 3, 'month', 12900, 3000)
ON CONFLICT (id) DO NOTHING;

-- ── Subscriptions ───────────────────────────────────────────────────────
-- pending: checkout started, nothing paid. active/past_due: live. ended: over,
-- with a reason. flagged: a second subscription paid for while another was
-- live; an Operator refunds it and it never grants.
CREATE TABLE IF NOT EXISTS public.credit_subscriptions (
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                UUID        NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    plan_id                TEXT        NOT NULL REFERENCES public.credit_subscription_plans(id) ON DELETE RESTRICT,
    idempotency_key        TEXT        NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._-]{8,128}$'),
    price_usd_cents        INTEGER     NOT NULL CHECK (price_usd_cents > 0),
    credits_per_cycle      INTEGER     NOT NULL CHECK (credits_per_cycle > 0),
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
                                       ('subscription_ended', 'refunded', 'disputed', 'superseded')),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT credit_subscriptions_one_key UNIQUE (user_id, idempotency_key),
    CONSTRAINT credit_subscriptions_ended_pair CHECK ((status = 'ended') = (ended_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS credit_subscriptions_one_live_per_user
    ON public.credit_subscriptions (user_id) WHERE status IN ('active', 'past_due');
CREATE INDEX IF NOT EXISTS credit_subscriptions_user_created_idx ON public.credit_subscriptions (user_id, created_at);
CREATE INDEX IF NOT EXISTS credit_subscriptions_plan_idx ON public.credit_subscriptions (plan_id);
ALTER TABLE public.credit_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_subscriptions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.credit_subscriptions FROM PUBLIC, anon, authenticated, service_role;

-- Every applied Stripe event, append-only, deduped on the event id. A grant
-- attempt is a row of its own, keyed by the invoice and its outcome (one
-- invoice.paid event is both a state change and a grant attempt).
CREATE TABLE IF NOT EXISTS public.credit_subscription_events (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID        NOT NULL REFERENCES public.credit_subscriptions(id) ON DELETE RESTRICT,
    stripe_event_id TEXT        NULL UNIQUE CHECK (stripe_event_id IS NULL OR stripe_event_id ~ '^(evt|cs)_[A-Za-z0-9_]{1,250}$'),
    type            TEXT        NOT NULL CHECK (type ~ '^[a-z_.]{1,64}$'),
    status          TEXT        NULL CHECK (status IS NULL OR status ~ '^[a-z_]{1,32}$'),
    period_end      TIMESTAMPTZ NULL,
    invoice_id      TEXT        NULL CHECK (invoice_id IS NULL OR invoice_id ~ '^in_[A-Za-z0-9_]{1,97}$'),
    credits         INTEGER     NULL CHECK (credits IS NULL OR credits >= 0),
    amount_paid_cents INTEGER   NULL CHECK (amount_paid_cents IS NULL OR amount_paid_cents >= 0),
    outcome         TEXT        NULL CHECK (outcome IS NULL OR outcome ~ '^[A-Z_]{1,40}$'),
    occurred_at     TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT credit_subscription_events_keyed CHECK (stripe_event_id IS NOT NULL OR invoice_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS credit_subscription_events_one_outcome_per_invoice
    ON public.credit_subscription_events (invoice_id, outcome) WHERE type = 'invoice.grant';
CREATE INDEX IF NOT EXISTS credit_subscription_events_subscription_idx
    ON public.credit_subscription_events (subscription_id);
ALTER TABLE public.credit_subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_subscription_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.credit_subscription_events FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.credit_subscription_events_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    RAISE EXCEPTION 'credit_subscription_events is append-only';
END $$;
DROP TRIGGER IF EXISTS credit_subscription_events_append_only ON public.credit_subscription_events;
CREATE TRIGGER credit_subscription_events_append_only
    BEFORE UPDATE OR DELETE ON public.credit_subscription_events
    FOR EACH ROW EXECUTE FUNCTION public.credit_subscription_events_append_only();
DROP TRIGGER IF EXISTS credit_subscription_events_no_truncate ON public.credit_subscription_events;
CREATE TRIGGER credit_subscription_events_no_truncate
    BEFORE TRUNCATE ON public.credit_subscription_events
    FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_no_truncate();

-- ── list_credit_subscription_plans: what the page offers ─────────────────
CREATE OR REPLACE FUNCTION public.list_credit_subscription_plans()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', p.id, 'tier', p.tier, 'billing_interval', p.billing_interval,
        'price_usd_cents', p.price_usd_cents, 'credits_per_cycle', p.credits_per_cycle)
        ORDER BY p.tier, p.price_usd_cents), '[]'::jsonb)
    FROM public.credit_subscription_plans p WHERE p.active;
$$;

-- ── start_credit_subscription: a pending row before the hosted checkout ───
-- {ok:true, idempotent, subscription_id, plan_id, billing_interval,
-- price_usd_cents, credits_per_cycle, status} or {ok:false, code} with
-- BAD_LIMIT, USER_NOT_FOUND, ACCOUNT_FROZEN, IDEMPOTENCY_KEY_REQUIRED,
-- IDEMPOTENCY_KEY_REUSED, CONSENT_VERSION_REQUIRED, PLAN_NOT_FOUND,
-- SUBSCRIPTION_ALREADY_ACTIVE, RATE_LIMITED. A second checkout is refused
-- while a Subscription is live, cancelled-but-running included (ADR-0064).
CREATE OR REPLACE FUNCTION public.start_credit_subscription(
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
    v_plan     public.credit_subscription_plans%ROWTYPE;
    v_existing public.credit_subscriptions%ROWTYPE;
    v_count    INTEGER;
    v_retry    INTEGER;
    v_id       UUID;
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
    IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,128}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REQUIRED');
    END IF;

    SELECT * INTO v_existing FROM public.credit_subscriptions x
    WHERE x.user_id = v_user AND x.idempotency_key = p_idempotency_key;
    IF FOUND THEN
        -- Only a pending row is compared: an upgrade later moves a live row to
        -- another plan, and a replay of its original checkout is still a replay.
        IF v_existing.status = 'pending' AND v_existing.plan_id IS DISTINCT FROM p_plan_id THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REUSED');
        END IF;
        SELECT * INTO v_plan FROM public.credit_subscription_plans p WHERE p.id = v_existing.plan_id;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'subscription_id', v_existing.id,
            'plan_id', v_existing.plan_id, 'billing_interval', v_plan.billing_interval,
            'price_usd_cents', v_existing.price_usd_cents, 'credits_per_cycle', v_existing.credits_per_cycle,
            'status', v_existing.status);
    END IF;

    IF p_consent_version IS NULL OR p_consent_version !~ '^[A-Za-z0-9._-]{1,32}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CONSENT_VERSION_REQUIRED');
    END IF;
    SELECT * INTO v_plan FROM public.credit_subscription_plans p WHERE p.id = p_plan_id AND p.active;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PLAN_NOT_FOUND');
    END IF;
    IF EXISTS (SELECT 1 FROM public.credit_subscriptions x
               WHERE x.user_id = v_user AND x.status IN ('active', 'past_due')) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_ALREADY_ACTIVE');
    END IF;

    SELECT count(*) INTO v_count FROM public.credit_subscriptions x
    WHERE x.user_id = v_user AND x.created_at > now() - make_interval(secs => p_window_seconds);
    IF v_count >= p_limit_per_window THEN
        SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
            min(x.created_at) + make_interval(secs => p_window_seconds) - now()
        ))))::int INTO v_retry
        FROM public.credit_subscriptions x
        WHERE x.user_id = v_user AND x.created_at > now() - make_interval(secs => p_window_seconds);
        RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED',
            'retry_after_seconds', COALESCE(v_retry, p_window_seconds));
    END IF;

    INSERT INTO public.credit_subscriptions (user_id, plan_id, idempotency_key, price_usd_cents, credits_per_cycle, consent_version)
    VALUES (v_user, v_plan.id, p_idempotency_key, v_plan.price_usd_cents, v_plan.credits_per_cycle, p_consent_version)
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'subscription_id', v_id,
        'plan_id', v_plan.id, 'billing_interval', v_plan.billing_interval,
        'price_usd_cents', v_plan.price_usd_cents, 'credits_per_cycle', v_plan.credits_per_cycle, 'status', 'pending');
END $$;

-- ── record_credit_subscription_session: the buyer came back from checkout ─
CREATE OR REPLACE FUNCTION public.record_credit_subscription_session(p_auth_id TEXT, p_subscription_id UUID, p_session_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_sub public.credit_subscriptions%ROWTYPE;
BEGIN
    IF p_session_id IS NULL OR p_session_id !~ '^cs_[A-Za-z0-9_]{1,251}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SESSION_ID');
    END IF;
    SELECT x.* INTO v_sub FROM public.credit_subscriptions x JOIN public.users u ON u.id = x.user_id
    WHERE x.id = p_subscription_id AND u.auth_id = p_auth_id
    FOR UPDATE OF x;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_FOUND');
    END IF;
    -- While pending the value is only a hint the return route verifies with
    -- Stripe, so a wrong one may be replaced; once bound it is fixed.
    IF v_sub.stripe_session_id IS NOT NULL AND v_sub.stripe_session_id <> p_session_id AND v_sub.status <> 'pending' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SESSION_MISMATCH');
    END IF;
    UPDATE public.credit_subscriptions SET stripe_session_id = p_session_id, updated_at = now() WHERE id = v_sub.id;
    RETURN jsonb_build_object('ok', true, 'subscription_id', v_sub.id, 'status', v_sub.status);
END $$;

-- ── apply_credit_subscription_event: the only writer of Stripe state ──────
-- p_status is our mapped status: active | past_due | ended | incomplete.
-- Found by Stripe subscription id, or bound once from p_subscription_row_id
-- (the id our checkout signed) while pending. An older event than the last
-- applied is recorded and changes nothing. Grants nothing: credits follow a
-- paid invoice (grant_credit_subscription_invoice, 0187). Returns {ok:true,
-- subscription_id, user_id, status, idempotent, stale, flagged} or
-- {ok:false, code}: INVALID_EVENT, INVALID_SUBSCRIPTION,
-- SUBSCRIPTION_NOT_FOUND, SUBSCRIPTION_MISMATCH.
CREATE OR REPLACE FUNCTION public.apply_credit_subscription_event(
    p_event_id TEXT,
    p_type TEXT,
    p_subscription_row_id UUID,
    p_stripe_subscription_id TEXT,
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
    v_sub     public.credit_subscriptions%ROWTYPE;
    v_event   public.credit_subscription_events%ROWTYPE;
    v_new     TEXT;
    v_flagged BOOLEAN := false;
BEGIN
    IF p_event_id IS NULL OR p_event_id !~ '^(evt|cs)_[A-Za-z0-9_]{1,250}$'
       OR p_type IS NULL OR p_type !~ '^[a-z_.]{1,64}$'
       OR p_status IS NULL OR p_status NOT IN ('active', 'past_due', 'ended', 'incomplete')
       OR p_occurred_at IS NULL OR p_occurred_at > now() + interval '5 minutes' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_EVENT');
    END IF;
    IF p_stripe_subscription_id IS NULL OR p_stripe_subscription_id !~ '^sub_[A-Za-z0-9_]{1,250}$'
       OR (p_customer_id IS NOT NULL AND p_customer_id !~ '^cus_[A-Za-z0-9_]{1,250}$') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SUBSCRIPTION');
    END IF;

    -- Find and lock the row first; everything after runs one event at a time
    -- for this Subscription. By Stripe id, or by the id our checkout signed.
    SELECT * INTO v_sub FROM public.credit_subscriptions x
    WHERE x.stripe_subscription_id = p_stripe_subscription_id FOR UPDATE;
    IF FOUND THEN
        IF p_subscription_row_id IS NOT NULL AND p_subscription_row_id <> v_sub.id THEN
            RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_MISMATCH');
        END IF;
    ELSE
        IF p_subscription_row_id IS NULL THEN
            RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_FOUND');
        END IF;
        -- Locked by id with no other condition, then re-read: of two first
        -- events arriving together, the second must find the row the first
        -- one bound, not be told the Subscription is unknown.
        SELECT * INTO v_sub FROM public.credit_subscriptions x WHERE x.id = p_subscription_row_id FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_FOUND');
        END IF;
        IF v_sub.stripe_subscription_id IS NULL AND v_sub.status = 'pending' THEN
            BEGIN
                UPDATE public.credit_subscriptions SET stripe_subscription_id = p_stripe_subscription_id, updated_at = now()
                WHERE id = v_sub.id;
            EXCEPTION WHEN unique_violation THEN
                -- Another row was bound to this Stripe subscription meanwhile.
                RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_MISMATCH');
            END;
            v_sub.stripe_subscription_id := p_stripe_subscription_id;
        ELSIF v_sub.stripe_subscription_id IS DISTINCT FROM p_stripe_subscription_id THEN
            RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_MISMATCH');
        END IF;
    END IF;

    -- Replay, checked under the lock so a concurrent duplicate is a no-op and
    -- not a unique violation. It still reports the state, so the caller can
    -- repeat a side effect it owns (cancelling a flagged one at Stripe).
    SELECT * INTO v_event FROM public.credit_subscription_events e WHERE e.stripe_event_id = p_event_id;
    IF FOUND THEN
        IF v_event.subscription_id <> v_sub.id THEN
            RETURN jsonb_build_object('ok', false, 'code', 'INVALID_EVENT');
        END IF;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'subscription_id', v_sub.id,
                                  'user_id', v_sub.user_id, 'status', v_sub.status, 'flagged', v_sub.status = 'flagged');
    END IF;

    -- One Subscription of a user changes state at a time (the balance lock,
    -- taken after the row's as everywhere else), so two rows activated
    -- together cannot both pass the "is another one live" test below.
    PERFORM 1 FROM public.credit_balances b WHERE b.user_id = v_sub.user_id FOR UPDATE;

    -- Order is Stripe's `created`; an out-of-order older event cannot regress
    -- the row, terminal states are never resurrected, and 'incomplete' never
    -- takes a live row back to pending (created and updated can share a second).
    IF (v_sub.last_event_at IS NOT NULL AND p_occurred_at < v_sub.last_event_at)
       OR v_sub.status IN ('ended', 'flagged')
       OR (p_status = 'incomplete' AND v_sub.status IN ('active', 'past_due')) THEN
        INSERT INTO public.credit_subscription_events (subscription_id, stripe_event_id, type, status, period_end, occurred_at)
        VALUES (v_sub.id, p_event_id, p_type, p_status, p_period_end, p_occurred_at);
        RETURN jsonb_build_object('ok', true, 'idempotent', false, 'stale', true, 'subscription_id', v_sub.id,
                                  'user_id', v_sub.user_id, 'status', v_sub.status, 'flagged', v_sub.status = 'flagged');
    END IF;

    v_new := CASE p_status WHEN 'incomplete' THEN 'pending' ELSE p_status END;
    IF v_new IN ('active', 'past_due') AND v_sub.status NOT IN ('active', 'past_due') AND EXISTS (
        SELECT 1 FROM public.credit_subscriptions o
        WHERE o.user_id = v_sub.user_id AND o.id <> v_sub.id AND o.status IN ('active', 'past_due')
    ) THEN
        -- Paid twice while one was live: never grant, flag for an Operator refund.
        v_new := 'flagged';
        v_flagged := true;
    END IF;

    UPDATE public.credit_subscriptions SET
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
    WHERE id = v_sub.id;

    INSERT INTO public.credit_subscription_events (subscription_id, stripe_event_id, type, status, period_end, occurred_at)
    VALUES (v_sub.id, p_event_id, p_type, p_status, p_period_end, p_occurred_at);

    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'stale', false, 'flagged', v_flagged,
                              'subscription_id', v_sub.id, 'user_id', v_sub.user_id, 'status', v_new);
END $$;

-- ── read_own_credit_subscription: the caller's newest, Stripe ids included ─
-- Server use only; the route strips the Stripe ids before replying.
CREATE OR REPLACE FUNCTION public.read_own_credit_subscription(p_auth_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user UUID;
    v_sub  public.credit_subscriptions%ROWTYPE;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    SELECT u.id INTO v_user FROM public.users u JOIN auth.users a ON a.id = p_auth_id::UUID WHERE u.auth_id = p_auth_id;
    IF v_user IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    SELECT * INTO v_sub FROM public.credit_subscriptions x WHERE x.user_id = v_user
    ORDER BY (x.status IN ('active', 'past_due')) DESC, x.created_at DESC LIMIT 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', true, 'subscription', NULL);
    END IF;
    RETURN jsonb_build_object('ok', true, 'subscription', jsonb_build_object(
        'id', v_sub.id, 'plan_id', v_sub.plan_id, 'status', v_sub.status,
        'price_usd_cents', v_sub.price_usd_cents, 'credits_per_cycle', v_sub.credits_per_cycle,
        'current_period_end', v_sub.current_period_end, 'cancel_at_period_end', v_sub.cancel_at_period_end,
        'started_at', v_sub.started_at, 'ended_at', v_sub.ended_at, 'end_reason', v_sub.end_reason,
        'created_at', v_sub.created_at,
        'stripe_subscription_id', v_sub.stripe_subscription_id, 'stripe_customer_id', v_sub.stripe_customer_id));
END $$;

-- ── mark_credit_subscription_renewal: our side of a change made at Stripe ─
-- 'cancel' records that it will not renew; the credits stay until the paid
-- period ends (ADR-0064). 'resume' undoes that while it is still running.
-- Both idempotent; only the owner's live Subscription.
CREATE OR REPLACE FUNCTION public.mark_credit_subscription_renewal(p_auth_id TEXT, p_subscription_id UUID, p_mode TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_sub public.credit_subscriptions%ROWTYPE;
BEGIN
    IF p_mode IS NULL OR p_mode NOT IN ('cancel', 'resume') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_MODE');
    END IF;
    SELECT x.* INTO v_sub FROM public.credit_subscriptions x JOIN public.users u ON u.id = x.user_id
    WHERE x.id = p_subscription_id AND u.auth_id = p_auth_id
    FOR UPDATE OF x;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_FOUND');
    END IF;
    IF v_sub.status NOT IN ('active', 'past_due') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_LIVE');
    END IF;
    UPDATE public.credit_subscriptions SET cancel_at_period_end = (p_mode = 'cancel'), updated_at = now()
    WHERE id = v_sub.id;
    RETURN jsonb_build_object('ok', true, 'status', v_sub.status, 'cancel_at_period_end', p_mode = 'cancel',
                              'current_period_end', v_sub.current_period_end);
END $$;

-- ── Grants ──────────────────────────────────────────────────────────────
DO $$
DECLARE fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.list_credit_subscription_plans()',
        'public.start_credit_subscription(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER)',
        'public.record_credit_subscription_session(TEXT, UUID, TEXT)',
        'public.apply_credit_subscription_event(TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ)',
        'public.read_own_credit_subscription(TEXT)',
        'public.mark_credit_subscription_renewal(TEXT, UUID, TEXT)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
    REVOKE ALL ON FUNCTION public.credit_subscription_events_append_only() FROM PUBLIC, anon, authenticated;
END $$;
