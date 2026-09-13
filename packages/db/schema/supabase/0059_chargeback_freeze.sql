-- Chargeback Freeze (#97, ADR-0018 decision 8, ADR-0019).
-- Applied name: 0059_chargeback_freeze.
--
-- A Chargeback Freezes the account: generating (ledger_debit) and buying
-- (create_pending_top_up) are refused with ACCOUNT_FROZEN. Sign-in, the
-- library, downloads and deletion are untouched. Two things Freeze:
--
--   inferred  apply_top_up_refund, when the refund makes progress and the
--             user generated since that Top-up was credited: a job created
--             after credited_at that did not end in a Credit Refund.
--   reported  apply_dispute_event(order, 'created', reference), for the order's
--             credited Top-up. 'resolved' only appends to the log; it never
--             unfreezes.
--
-- users.frozen_at     the marker. Set once; freezing a Frozen account again
--                     appends a log entry and changes nothing else.
-- account_actions     append-only log (trigger, like ledger_entries): user,
--                     freeze / unfreeze / dispute_resolved, actor ('system' or
--                     the Operator's name), reason, related Top-up, timestamp.
--                     An inferred Freeze also records credits_taken and
--                     credits_shortfall: the Pack Credits the refund took back
--                     and the part it could not, so an Operator can see what
--                     was written off without the Worker logs.
-- unfreeze_account    (user, Operator name, reason): the only way out. Both
--                     must be non-blank. It clears the marker and appends to
--                     the log.
--
-- Every Freeze takes the user's credit_balances row lock, the lock ledger_debit
-- takes before its Frozen check, so no generation slips in between.
-- create_pending_top_up checks under its users-row lock.
--
-- Replaces: ledger_debit (0037 body plus the Frozen check), create_pending_top_up
-- (0041 body plus the Frozen check), apply_top_up_refund (0058 body plus the
-- Freeze).
--
-- Idempotent: IF NOT EXISTS, OR REPLACE, guarded trigger; REVOKE/GRANT re-run.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS public.account_actions (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    action      TEXT        NOT NULL CHECK (action IN ('freeze', 'unfreeze', 'dispute_resolved')),
    actor       TEXT        NOT NULL CHECK (length(btrim(actor)) BETWEEN 1 AND 120),
    reason      TEXT        NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
    top_up_id   UUID        NULL REFERENCES public.top_ups(id) ON DELETE RESTRICT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.account_actions ADD COLUMN IF NOT EXISTS credits_taken     INTEGER NULL CHECK (credits_taken >= 0);
ALTER TABLE public.account_actions ADD COLUMN IF NOT EXISTS credits_shortfall INTEGER NULL CHECK (credits_shortfall >= 0);
CREATE INDEX IF NOT EXISTS account_actions_user_idx ON public.account_actions (user_id, created_at);

CREATE OR REPLACE FUNCTION public.account_actions_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'account_actions is append-only (attempted %)', TG_OP;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                   WHERE tgname = 'account_actions_no_update'
                     AND tgrelid = 'public.account_actions'::regclass) THEN
        CREATE TRIGGER account_actions_no_update
            BEFORE UPDATE OR DELETE ON public.account_actions
            FOR EACH ROW EXECUTE FUNCTION public.account_actions_append_only();
    END IF;
END $$;

ALTER TABLE public.account_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_actions FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_actions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.account_actions_append_only() FROM PUBLIC, anon, authenticated;

-- ── freeze_account: the shared Freeze. Internal, called by definer functions.
-- The caller must hold the user's credit_balances row lock. p_taken and
-- p_shortfall are set by the inferred Freeze only (NULL for a dispute).
CREATE OR REPLACE FUNCTION public.freeze_account(
    p_user_id UUID,
    p_reason TEXT,
    p_top_up_id UUID,
    p_taken INTEGER DEFAULT NULL,
    p_shortfall INTEGER DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_already BOOLEAN;
BEGIN
    SELECT u.frozen_at IS NOT NULL INTO v_already FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
    IF NOT v_already THEN
        UPDATE public.users SET frozen_at = now() WHERE id = p_user_id;
    END IF;
    INSERT INTO public.account_actions (user_id, action, actor, reason, top_up_id, credits_taken, credits_shortfall)
    VALUES (p_user_id, 'freeze', 'system', p_reason, p_top_up_id, p_taken, p_shortfall);
    RETURN v_already;
END $$;

-- No EXECUTE grant on purpose: apply_top_up_refund and apply_dispute_event call
-- it through the owner's privilege, so all three must keep the same owner.
REVOKE ALL ON FUNCTION public.freeze_account(UUID, TEXT, UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated, service_role;

-- ── ledger_debit: 0037 body, plus the Frozen check after the replay probe ──
CREATE OR REPLACE FUNCTION public.ledger_debit(
    p_user_id UUID,
    p_idempotency_key TEXT,
    p_credits INTEGER,
    p_reason TEXT,
    p_model_id TEXT,
    p_inputs JSONB,
    p_limit_per_window INTEGER DEFAULT 0,
    p_window_seconds INTEGER DEFAULT 60
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_existing UUID;
    v_current_balance INTEGER;
    v_free_balance INTEGER;
    v_free_part INTEGER;
    v_new_job_id UUID;
    v_count INTEGER;
    v_reset_seconds INTEGER;
BEGIN
    IF p_credits IS NULL OR p_credits <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CREDITS',
                                   'message', format('credits must be a positive integer (got %s)', p_credits));
    END IF;

    SELECT balance, free_balance INTO v_current_balance, v_free_balance FROM public.credit_balances
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF v_current_balance IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NO_BALANCE_ROW',
                                   'message', format('no credit_balances row for user %s', p_user_id));
    END IF;

    SELECT id INTO v_existing FROM public.jobs
    WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
    IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'job_id', v_existing,
                                   'idempotent', true, 'balance_after', v_current_balance);
    END IF;

    -- Under the balance lock every Freeze also takes, so none races this.
    IF EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.frozen_at IS NOT NULL) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN');
    END IF;

    IF p_limit_per_window IS NOT NULL AND p_limit_per_window > 0 THEN
        SELECT count(*) INTO v_count FROM public.jobs
        WHERE user_id = p_user_id
          AND created_at > now() - make_interval(secs => p_window_seconds);
        IF v_count >= p_limit_per_window THEN
            SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
                MIN(created_at) + make_interval(secs => p_window_seconds) - now()
            ))))::int INTO v_reset_seconds
            FROM public.jobs
            WHERE user_id = p_user_id
              AND created_at > now() - make_interval(secs => p_window_seconds);
            RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED',
                                       'count', v_count, 'limit', p_limit_per_window,
                                       'retry_after_seconds', COALESCE(v_reset_seconds, p_window_seconds));
        END IF;
    END IF;

    IF v_current_balance < p_credits THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_BALANCE',
                                   'message', format('insufficient balance: have %s, need %s', v_current_balance, p_credits),
                                   'balance', v_current_balance);
    END IF;

    BEGIN
        INSERT INTO public.jobs (user_id, idempotency_key, model_id, credits, inputs, state)
        VALUES (p_user_id, p_idempotency_key, p_model_id, p_credits, p_inputs, 'DEBITED')
        RETURNING id INTO v_new_job_id;
    EXCEPTION WHEN unique_violation THEN
        SELECT id INTO v_existing FROM public.jobs
        WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
        RETURN jsonb_build_object('ok', true, 'job_id', v_existing,
                                   'idempotent', true, 'balance_after', v_current_balance);
    END;

    v_free_part := LEAST(v_free_balance, p_credits);

    INSERT INTO public.ledger_entries (user_id, delta, free_delta, reason, job_id)
    VALUES (p_user_id, -p_credits, -v_free_part, p_reason, v_new_job_id);

    UPDATE public.credit_balances
    SET balance = balance - p_credits, free_balance = free_balance - v_free_part, updated_at = now()
    WHERE user_id = p_user_id;

    RETURN jsonb_build_object('ok', true, 'job_id', v_new_job_id,
                               'idempotent', false, 'balance_after', v_current_balance - p_credits);
END $$;

-- ── create_pending_top_up: 0041 body, plus the Frozen check ───────────────
-- Before the replay probe: a replayed key would open a fresh checkout.
CREATE OR REPLACE FUNCTION public.create_pending_top_up(
    p_auth_id TEXT,
    p_pack_id TEXT,
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
    v_user_id UUID;
    v_frozen BOOLEAN;
    v_pack public.credit_packs%ROWTYPE;
    v_count INTEGER;
    v_retry INTEGER;
    v_top_up_id UUID;
    v_existing public.top_ups%ROWTYPE;
BEGIN
    IF p_limit_per_window IS NULL OR p_limit_per_window <= 0
       OR p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BAD_LIMIT');
    END IF;

    SELECT u.id, u.frozen_at IS NOT NULL INTO v_user_id, v_frozen FROM public.users u
    WHERE u.auth_id = p_auth_id
    FOR NO KEY UPDATE;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    IF v_frozen THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN');
    END IF;

    IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,128}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REQUIRED');
    END IF;

    SELECT * INTO v_existing FROM public.top_ups t
    WHERE t.user_id = v_user_id AND t.idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_existing.pack_id <> p_pack_id THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REUSED');
        END IF;
        RETURN jsonb_build_object(
            'ok', true,
            'idempotent', true,
            'top_up_id', v_existing.id,
            'credits', v_existing.credits,
            'price_usd_cents', v_existing.price_usd_cents,
            'variant_id', v_existing.variant_id
        );
    END IF;

    IF p_consent_version IS NULL OR p_consent_version !~ '^[A-Za-z0-9._-]{1,32}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CONSENT_VERSION_REQUIRED');
    END IF;

    SELECT * INTO v_pack FROM public.credit_packs p
    WHERE p.id = p_pack_id AND p.active AND p.variant_id IS NOT NULL;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PACK_NOT_FOUND');
    END IF;

    SELECT count(*) INTO v_count FROM public.top_ups t
    WHERE t.user_id = v_user_id
      AND t.created_at > now() - make_interval(secs => p_window_seconds);
    IF v_count >= p_limit_per_window THEN
        SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
            min(t.created_at) + make_interval(secs => p_window_seconds) - now()
        ))))::int INTO v_retry
        FROM public.top_ups t
        WHERE t.user_id = v_user_id
          AND t.created_at > now() - make_interval(secs => p_window_seconds);
        RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED',
            'retry_after_seconds', COALESCE(v_retry, p_window_seconds));
    END IF;

    INSERT INTO public.top_ups (user_id, pack_id, idempotency_key, sales_channel, credits,
                                price_usd_cents, variant_id, consent_at, consent_version)
    VALUES (v_user_id, v_pack.id, p_idempotency_key, v_pack.sales_channel, v_pack.credits,
            v_pack.price_usd_cents, v_pack.variant_id, now(), p_consent_version)
    RETURNING id INTO v_top_up_id;

    RETURN jsonb_build_object(
        'ok', true,
        'idempotent', false,
        'top_up_id', v_top_up_id,
        'credits', v_pack.credits,
        'price_usd_cents', v_pack.price_usd_cents,
        'variant_id', v_pack.variant_id
    );
END $$;

-- ── apply_top_up_refund: 0058 body, plus the inferred Chargeback Freeze ───
CREATE OR REPLACE FUNCTION public.apply_top_up_refund(
    p_order_id TEXT,
    p_refunded_cents BIGINT,
    p_total_cents BIGINT,
    p_top_up_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_top_up public.top_ups%ROWTYPE;
    v_balance INTEGER;
    v_free INTEGER;
    v_share INTEGER;
    v_owed INTEGER;
    v_taken INTEGER;
    v_frozen BOOLEAN := false;
BEGIN
    IF p_order_id IS NULL OR p_order_id !~ '^[0-9]{1,20}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_ORDER_ID');
    END IF;
    IF p_total_cents IS NULL OR p_total_cents <= 0 OR p_refunded_cents IS NULL
       OR p_refunded_cents < 0 OR p_refunded_cents > p_total_cents OR p_total_cents > 2147483647 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_AMOUNT');
    END IF;

    SELECT * INTO v_top_up FROM public.top_ups t WHERE t.order_id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        IF EXISTS (SELECT 1 FROM public.top_up_flagged_orders f WHERE f.order_id = p_order_id) THEN
            RETURN jsonb_build_object('ok', true, 'idempotent', false, 'flagged', true, 'taken', 0, 'shortfall', 0,
                                      'frozen', false);
        END IF;
        IF EXISTS (SELECT 1 FROM public.top_ups t WHERE t.id = p_top_up_id AND t.status = 'pending') THEN
            RETURN jsonb_build_object('ok', false, 'code', 'NOT_CREDITED_YET');
        END IF;
        RETURN jsonb_build_object('ok', false, 'code', 'ORDER_NOT_FOUND');
    END IF;

    -- A replay or an older amount changes nothing, so it can never re-Freeze
    -- an account an Operator has unfrozen.
    IF p_refunded_cents <= v_top_up.refunded_cents THEN
        SELECT b.balance INTO v_balance FROM public.credit_balances b WHERE b.user_id = v_top_up.user_id;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'top_up_id', v_top_up.id,
                                  'user_id', v_top_up.user_id, 'taken', 0, 'shortfall', 0,
                                  'balance_after', v_balance, 'frozen', false);
    END IF;

    v_share := (v_top_up.credits::BIGINT * p_refunded_cents / p_total_cents)::INTEGER;
    v_owed := v_share - (v_top_up.credits::BIGINT * v_top_up.refunded_cents / p_total_cents)::INTEGER;

    SELECT b.balance, b.free_balance INTO v_balance, v_free
    FROM public.credit_balances b WHERE b.user_id = v_top_up.user_id FOR UPDATE;
    v_taken := GREATEST(0, LEAST(v_owed, v_balance - v_free));

    IF v_taken > 0 THEN
        INSERT INTO public.ledger_entries (user_id, delta, free_delta, reason, job_id)
        VALUES (v_top_up.user_id, -v_taken, 0, 'reverse:topup_refund', NULL);
        UPDATE public.credit_balances
        SET balance = balance - v_taken, updated_at = now()
        WHERE user_id = v_top_up.user_id;
    END IF;

    UPDATE public.top_ups
    SET refunded_cents = p_refunded_cents::INTEGER,
        clawed_back_credits = clawed_back_credits + v_taken
    WHERE id = v_top_up.id;

    -- Chargeback: generated since this Top-up was credited, and the job did
    -- not end in a Credit Refund.
    IF EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.user_id = v_top_up.user_id
          AND j.created_at > v_top_up.credited_at
          AND j.state <> 'REFUNDED'
    ) THEN
        PERFORM public.freeze_account(v_top_up.user_id,
            format('Top-up Refund of %s cents on order %s after generating', p_refunded_cents, p_order_id),
            v_top_up.id, v_taken, v_owed - v_taken);
        v_frozen := true;
    END IF;

    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'top_up_id', v_top_up.id,
                              'user_id', v_top_up.user_id, 'share', v_share,
                              'taken', v_taken, 'shortfall', v_owed - v_taken,
                              'balance_after', v_balance - v_taken, 'frozen', v_frozen);
END $$;

-- ── apply_dispute_event: reported Chargebacks (ADR-0019) ──────────────────
-- Returns {ok:true, user_id, top_up_id, already_frozen} for 'created',
-- {ok:true, user_id, top_up_id} for 'resolved', or {ok:false, code} with code
-- INVALID_ORDER_ID, INVALID_EVENT or TOP_UP_NOT_FOUND. The user is always the
-- credited Top-up's owner, never one named by the caller.
CREATE OR REPLACE FUNCTION public.apply_dispute_event(
    p_order_id TEXT,
    p_event TEXT,
    p_reference TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_top_up public.top_ups%ROWTYPE;
    v_reason TEXT;
    v_already BOOLEAN;
BEGIN
    IF p_order_id IS NULL OR p_order_id !~ '^[0-9]{1,20}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_ORDER_ID');
    END IF;
    IF p_event IS NULL OR p_event NOT IN ('created', 'resolved') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_EVENT');
    END IF;

    SELECT * INTO v_top_up FROM public.top_ups t WHERE t.order_id = p_order_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'TOP_UP_NOT_FOUND');
    END IF;

    v_reason := left(format('LemonSqueezy dispute %s on order %s',
                            COALESCE(NULLIF(btrim(p_reference), ''), 'without reference'), p_order_id), 500);

    -- Same lock order as ledger_debit.
    PERFORM 1 FROM public.credit_balances b WHERE b.user_id = v_top_up.user_id FOR UPDATE;

    IF p_event = 'created' THEN
        v_already := public.freeze_account(v_top_up.user_id, v_reason, v_top_up.id);
        RETURN jsonb_build_object('ok', true, 'user_id', v_top_up.user_id, 'top_up_id', v_top_up.id,
                                  'already_frozen', v_already);
    END IF;

    INSERT INTO public.account_actions (user_id, action, actor, reason, top_up_id)
    VALUES (v_top_up.user_id, 'dispute_resolved', 'system', v_reason, v_top_up.id);
    RETURN jsonb_build_object('ok', true, 'user_id', v_top_up.user_id, 'top_up_id', v_top_up.id);
END $$;

-- ── unfreeze_account: the only way out of Frozen ──────────────────────────
-- Service-role only. p_operator is the Operator's name as written in the log;
-- any route that calls this must take it from a verified identity, never
-- from a request body.
CREATE OR REPLACE FUNCTION public.unfreeze_account(
    p_user_id UUID,
    p_operator TEXT,
    p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_frozen BOOLEAN;
BEGIN
    IF p_operator IS NULL OR length(btrim(p_operator)) NOT BETWEEN 1 AND 120
       OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'OPERATOR_AND_REASON_REQUIRED');
    END IF;

    PERFORM 1 FROM public.credit_balances b WHERE b.user_id = p_user_id FOR UPDATE;
    SELECT u.frozen_at IS NOT NULL INTO v_frozen FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
    IF v_frozen IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    IF NOT v_frozen THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_FROZEN');
    END IF;

    UPDATE public.users SET frozen_at = NULL WHERE id = p_user_id;
    INSERT INTO public.account_actions (user_id, action, actor, reason, top_up_id)
    VALUES (p_user_id, 'unfreeze', btrim(p_operator), btrim(p_reason), NULL);
    RETURN jsonb_build_object('ok', true);
END $$;

DO $$
DECLARE fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.ledger_debit(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB, INTEGER, INTEGER)',
        'public.create_pending_top_up(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER)',
        'public.apply_top_up_refund(TEXT, BIGINT, BIGINT, UUID)',
        'public.apply_dispute_event(TEXT, TEXT, TEXT)',
        'public.unfreeze_account(UUID, TEXT, TEXT)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END $$;
