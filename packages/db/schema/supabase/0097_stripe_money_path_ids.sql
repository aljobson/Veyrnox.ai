-- Stripe order ids on the money path (ADR-0031).
-- Applied name: 0097_stripe_money_path_ids.
--
-- Billing moved from LemonSqueezy to Stripe, but every order id on the money
-- path is still shaped like a LemonSqueezy numeric order id, '^[0-9]{1,20}$'.
-- A Stripe PaymentIntent id (`pi_3Q...`) fails that shape, so a real payment
-- would be taken by Stripe and credited by nobody: credit_top_up returns
-- INVALID_ORDER_ID, the webhook logs it as a final refusal, and the Top-up
-- stays pending forever. Same for the refund and dispute paths.
--
-- One shared shape for both providers: '^[A-Za-z0-9_]{1,64}$'. It accepts a
-- LemonSqueezy numeric id unchanged and a Stripe `pi_`/`cs_` id, and it is
-- still a strict allow-list — no punctuation, no quotes, no whitespace, so an
-- id can never carry anything but an id. 64 covers Stripe's documented ids
-- with headroom; a longer id is refused, not truncated.
--
-- What changed
--   top_ups_order_id_format             widened (NULL still allowed)
--   top_ups_return_order_id_format      widened (NULL still allowed)
--   top_up_flagged_orders_order_id_check widened (still NOT NULL)
--   credit_packs_variant_id_check       widened (NULL still allowed)
--   credit_packs_active_needs_variant   dropped, and credit_packs.variant_id
--       made nullable: Stripe has no variant ids at all, because Checkout is
--       priced inline from the catalog. Existing pack rows keep the
--       LemonSqueezy variant ids they already carry — the app ignores the
--       column under Stripe — so no row data is deleted or rewritten here.
--   credit_top_up / apply_top_up_refund / apply_dispute_event
--       the order-id guard, to the same shape; and in credit_top_up the
--       variant comparison, so a NULL p_variant_id means "not checked"
--       (Stripe passes null) while a non-null one must still match
--       (LemonSqueezy). Nothing else in the three bodies moves.
--
-- What did NOT change
--   The row lock, the ALREADY_CREDITED / AMOUNT_MISMATCH / CURRENCY_MISMATCH
--   flagging into top_up_flagged_orders, the ledger_grant call, idempotency,
--   the clawback arithmetic and the frozen-account handling are the live
--   0054 / 0066 / 0059 bodies verbatim. top_ups_order_id_key stays UNIQUE and
--   top_up_flagged_orders_pkey is untouched, so one order id still credits at
--   most one Top-up. The ledger stays append-only.
--
-- Rollback is a mirror file, not an edit to this one: a later NNNN migration
-- that re-adds the four narrow CHECKs and re-creates the three bodies with
-- the numeric guard. Widening a CHECK is forward-safe (every row that passed
-- the old shape passes the new one); narrowing it back is not, once a Stripe
-- id has been stored.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS before each ADD, DROP NOT NULL is a
-- no-op when already nullable, OR REPLACE, REVOKE/GRANT re-run.

-- ── The four format CHECKs ────────────────────────────────────────────────

ALTER TABLE public.top_ups DROP CONSTRAINT IF EXISTS top_ups_order_id_format;
ALTER TABLE public.top_ups ADD CONSTRAINT top_ups_order_id_format
    CHECK (order_id IS NULL OR order_id ~ '^[A-Za-z0-9_]{1,64}$');

ALTER TABLE public.top_ups DROP CONSTRAINT IF EXISTS top_ups_return_order_id_format;
ALTER TABLE public.top_ups ADD CONSTRAINT top_ups_return_order_id_format
    CHECK (return_order_id IS NULL OR return_order_id ~ '^[A-Za-z0-9_]{1,64}$');

ALTER TABLE public.top_up_flagged_orders DROP CONSTRAINT IF EXISTS top_up_flagged_orders_order_id_check;
ALTER TABLE public.top_up_flagged_orders ADD CONSTRAINT top_up_flagged_orders_order_id_check
    CHECK (order_id ~ '^[A-Za-z0-9_]{1,64}$');

ALTER TABLE public.credit_packs DROP CONSTRAINT IF EXISTS credit_packs_variant_id_check;
ALTER TABLE public.credit_packs ADD CONSTRAINT credit_packs_variant_id_check
    CHECK (variant_id ~ '^[A-Za-z0-9_]{1,64}$');

-- ── A Stripe pack has no variant ──────────────────────────────────────────
-- Nullable already in production; the DROP NOT NULL is here so a database
-- replayed from these files ends in the same state.

ALTER TABLE public.credit_packs DROP CONSTRAINT IF EXISTS credit_packs_active_needs_variant;
ALTER TABLE public.credit_packs ALTER COLUMN variant_id DROP NOT NULL;

-- ── credit_top_up: 0054 body, wider order-id guard, optional variant ──────
-- Returns {ok:true, idempotent, top_up_id, credits, balance_after} or
-- {ok:false, code[, flagged:true]} with code TOP_UP_NOT_FOUND,
-- INVALID_ORDER_ID, ORDER_ALREADY_USED, VARIANT_MISMATCH, AMOUNT_MISMATCH,
-- CURRENCY_MISMATCH or ALREADY_CREDITED. `flagged` means the order is in
-- top_up_flagged_orders (idempotent on order id).
--
-- The caller has already re-fetched the order from the provider and checked
-- it is paid; p_paid_usd_cents is its pre-tax amount. p_variant_id is the
-- LemonSqueezy variant the order was bought against, or NULL under Stripe,
-- which prices the session from the Top-up row itself and has nothing to
-- compare.
CREATE OR REPLACE FUNCTION public.credit_top_up(
    p_top_up_id UUID,
    p_order_id TEXT,
    p_paid_usd_cents INTEGER,
    p_currency TEXT,
    p_variant_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_top_up public.top_ups%ROWTYPE;
    v_code TEXT;
    v_grant JSONB;
    v_balance INTEGER;
BEGIN
    IF p_order_id IS NULL OR p_order_id !~ '^[A-Za-z0-9_]{1,64}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_ORDER_ID');
    END IF;

    SELECT * INTO v_top_up FROM public.top_ups t WHERE t.id = p_top_up_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'TOP_UP_NOT_FOUND');
    END IF;

    -- One order carries one Top-up id in its custom data, so an order already
    -- credited to another Top-up is not a real delivery: refuse, never flag
    -- (flagging would queue a legitimately credited order for refund).
    IF EXISTS (SELECT 1 FROM public.top_ups t WHERE t.order_id = p_order_id AND t.id <> v_top_up.id) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ORDER_ALREADY_USED');
    END IF;

    IF v_top_up.status = 'credited' THEN
        IF v_top_up.order_id = p_order_id THEN
            SELECT b.balance INTO v_balance FROM public.credit_balances b WHERE b.user_id = v_top_up.user_id;
            RETURN jsonb_build_object('ok', true, 'idempotent', true, 'top_up_id', v_top_up.id,
                                      'credits', v_top_up.credits, 'balance_after', v_balance);
        END IF;
        v_code := 'ALREADY_CREDITED';
    -- NULL means the provider has no variant to check (Stripe). A variant the
    -- caller DID name must still match the one the Top-up was started on.
    ELSIF p_variant_id IS NOT NULL AND p_variant_id IS DISTINCT FROM v_top_up.variant_id THEN
        v_code := 'VARIANT_MISMATCH';
    ELSIF p_paid_usd_cents IS DISTINCT FROM v_top_up.price_usd_cents THEN
        v_code := 'AMOUNT_MISMATCH';
    ELSIF p_currency IS DISTINCT FROM 'USD' THEN
        v_code := 'CURRENCY_MISMATCH';
    END IF;

    IF v_code IS NOT NULL THEN
        INSERT INTO public.top_up_flagged_orders (order_id, top_up_id, user_id, reason, paid_usd_cents, currency, variant_id)
        VALUES (p_order_id, v_top_up.id, v_top_up.user_id, lower(v_code), p_paid_usd_cents,
                left(p_currency, 8), left(p_variant_id, 20))
        ON CONFLICT (order_id) DO NOTHING;
        RETURN jsonb_build_object('ok', false, 'code', v_code, 'flagged', true);
    END IF;

    v_grant := public.ledger_grant(v_top_up.user_id, v_top_up.credits, 'grant:topup');
    IF (v_grant->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'credit_top_up: ledger_grant refused (%)', v_grant->>'code';
    END IF;

    UPDATE public.top_ups
    SET status = 'credited', order_id = p_order_id, credited_at = now(),
        grant_entry_id = (v_grant->>'entry_id')::uuid
    WHERE id = v_top_up.id;

    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'top_up_id', v_top_up.id,
                              'credits', v_top_up.credits, 'balance_after', (v_grant->>'balance_after')::int);
END $$;

-- ── apply_top_up_refund: 0066 body, wider order-id guard ──────────────────
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
    IF p_order_id IS NULL OR p_order_id !~ '^[A-Za-z0-9_]{1,64}$' THEN
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

    -- Chargeback: generated since this Top-up was bought, and the job did not
    -- end in a Credit Refund. "Bought" is the pending row's created_at, not
    -- credited_at: the backfill credits and claws back in one transaction
    -- (0063), so credited_at is always later than every job.
    IF EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.user_id = v_top_up.user_id
          AND j.created_at > v_top_up.created_at
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

-- ── apply_dispute_event: 0059 body, wider order-id guard ──────────────────
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
    IF p_order_id IS NULL OR p_order_id !~ '^[A-Za-z0-9_]{1,64}$' THEN
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

-- A changed argument list would make a NEW function inheriting no ACL. These
-- three keep their signatures, so the grants survive — re-stated anyway, by
-- full signature, because a silent regrant is cheaper than a leaked EXECUTE.
DO $$
DECLARE fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.credit_top_up(UUID, TEXT, INTEGER, TEXT, TEXT)',
        'public.apply_top_up_refund(TEXT, BIGINT, BIGINT, UUID)',
        'public.apply_dispute_event(TEXT, TEXT, TEXT)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END $$;
