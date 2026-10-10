-- Sales Channel on every Top-up grant (ADR-0018 decision 2, ADR-0019).
--
-- A Sales Channel is where a Top-up is bought: web, the iOS App Store or
-- Google Play. Each channel has its own Merchant of Record and its own Credit
-- Pack prices, so:
--   credit_packs.sales_channel — a pack belongs to one channel; iOS and Play
--                                packs will be their own rows at their own
--                                prices. Existing packs are web.
--   purchases.sales_channel    — copied from the pack; a composite foreign key
--                                keeps the two from disagreeing.
--   ledger grant reason        — grant:topup:<channel> (was grant:topup:stripe),
--                                so the ledger itself records the channel.
--
-- purchase_create takes the channel the caller sells through and only accepts
-- that channel's packs; the 4-argument form is dropped. The active-needs-a-
-- Stripe-price constraint from 0035 is left alone: web is the only channel
-- with packs, and the store channels will need their own product-id columns
-- when they arrive.
--
-- The defaults exist only to backfill the rows already present (web packs, no
-- purchases) and are dropped, so every new row states its channel.
--
-- Idempotent: IF NOT EXISTS, guarded constraint add, DROP DEFAULT and
-- DROP ... IF EXISTS re-run, OR REPLACE; REVOKE/GRANT re-run.

ALTER TABLE public.credit_packs
    ADD COLUMN IF NOT EXISTS sales_channel TEXT NOT NULL DEFAULT 'web'
        CONSTRAINT credit_packs_sales_channel_known CHECK (sales_channel IN ('web', 'app_store', 'google_play'));
ALTER TABLE public.credit_packs ALTER COLUMN sales_channel DROP DEFAULT;
CREATE UNIQUE INDEX IF NOT EXISTS credit_packs_id_channel_idx ON public.credit_packs (id, sales_channel);

ALTER TABLE public.purchases
    ADD COLUMN IF NOT EXISTS sales_channel TEXT NOT NULL DEFAULT 'web'
        CONSTRAINT purchases_sales_channel_known CHECK (sales_channel IN ('web', 'app_store', 'google_play'));
ALTER TABLE public.purchases ALTER COLUMN sales_channel DROP DEFAULT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'purchases_pack_channel_fkey') THEN
        ALTER TABLE public.purchases
            ADD CONSTRAINT purchases_pack_channel_fkey
            FOREIGN KEY (pack_id, sales_channel) REFERENCES public.credit_packs (id, sales_channel);
    END IF;
END $$;

DROP FUNCTION IF EXISTS public.purchase_create(TEXT, TEXT, TEXT, TEXT);

-- ── purchase_create: 0038 body, plus the Sales Channel ────────────────────
CREATE OR REPLACE FUNCTION public.purchase_create(
    p_auth_id TEXT,
    p_pack_id TEXT,
    p_idempotency_key TEXT,
    p_supply_consent_version TEXT,
    p_sales_channel TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_pack public.credit_packs%ROWTYPE;
    v_existing public.purchases%ROWTYPE;
    v_recent INTEGER;
    v_id UUID;
BEGIN
    IF p_supply_consent_version IS NULL OR p_supply_consent_version !~ '^[a-z0-9-]{1,64}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SUPPLY_CONSENT_REQUIRED');
    END IF;
    IF p_sales_channel IS NULL OR p_sales_channel NOT IN ('web', 'app_store', 'google_play') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SALES_CHANNEL');
    END IF;

    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;

    -- Take the balance lock purchase_reverse holds while it Freezes, so this
    -- check cannot race a Freeze being written. Unlike ledger_debit, a replay
    -- is refused too: answering it would reopen a payable Checkout Session.
    PERFORM 1 FROM public.credit_balances WHERE user_id = v_user_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.account_freezes WHERE user_id = v_user_id AND unfrozen_at IS NULL) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN');
    END IF;

    -- Serialise this user's purchase creation so the rate-limit count and
    -- the idempotency probe below cannot race.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('purchase:' || v_user_id::text, 0));

    SELECT * INTO v_existing FROM public.purchases
    WHERE user_id = v_user_id AND idempotency_key = p_idempotency_key;
    IF v_existing.id IS NOT NULL THEN
        IF v_existing.pack_id <> p_pack_id OR v_existing.sales_channel <> p_sales_channel THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REUSED');
        END IF;
        -- Stripe keeps idempotency keys for 24h; past that a retry could
        -- mint a second session for the same purchase.
        IF v_existing.state = 'PENDING' AND v_existing.created_at < now() - interval '23 hours' THEN
            RETURN jsonb_build_object('ok', false, 'code', 'PURCHASE_EXPIRED');
        END IF;
        -- A replay keeps the consent recorded when the purchase was created.
        SELECT * INTO v_pack FROM public.credit_packs WHERE id = v_existing.pack_id;
        RETURN jsonb_build_object('ok', true, 'idempotent', true,
            'purchase_id', v_existing.id, 'state', v_existing.state,
            'credits', v_existing.credits, 'stripe_price_id', v_pack.stripe_price_id);
    END IF;

    -- A channel only sells its own packs, at its own prices.
    SELECT * INTO v_pack FROM public.credit_packs
    WHERE id = p_pack_id AND sales_channel = p_sales_channel AND active;
    IF v_pack.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PACK_UNAVAILABLE');
    END IF;

    SELECT count(*) INTO v_recent FROM public.purchases
    WHERE user_id = v_user_id AND created_at > now() - interval '10 minutes';
    IF v_recent >= 5 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
    END IF;

    INSERT INTO public.purchases (user_id, pack_id, sales_channel, credits, idempotency_key, supply_consent_version, supply_consent_at)
    VALUES (v_user_id, v_pack.id, v_pack.sales_channel, v_pack.credits, p_idempotency_key, p_supply_consent_version, now())
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('ok', true, 'idempotent', false,
        'purchase_id', v_id, 'state', 'PENDING',
        'credits', v_pack.credits, 'stripe_price_id', v_pack.stripe_price_id);
END $$;

-- ── purchase_fulfil: 0038 body, grant reason names the Sales Channel ──────
CREATE OR REPLACE FUNCTION public.purchase_fulfil(
    p_purchase_id UUID,
    p_session_id TEXT,
    p_payment_intent TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_p public.purchases%ROWTYPE;
    v_grant JSONB;
BEGIN
    IF p_session_id IS NULL OR p_session_id = '' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SESSION');
    END IF;

    SELECT * INTO v_p FROM public.purchases WHERE id = p_purchase_id FOR UPDATE;
    IF v_p.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PURCHASE_NOT_FOUND');
    END IF;

    IF v_p.state <> 'PENDING' THEN
        IF v_p.stripe_session_id = p_session_id THEN
            RETURN jsonb_build_object('ok', true, 'idempotent', true,
                'user_id', v_p.user_id, 'credits', v_p.credits);
        END IF;
        RETURN jsonb_build_object('ok', false, 'code', 'SESSION_MISMATCH');
    END IF;

    v_grant := public.ledger_grant(v_p.user_id, v_p.credits, 'grant:topup:' || v_p.sales_channel);
    IF (v_grant->>'ok')::boolean IS NOT TRUE THEN
        -- Abort the transaction so the purchase stays PENDING and the
        -- webhook's 500 makes Stripe redeliver.
        RAISE EXCEPTION 'ledger_grant rejected purchase %: %', p_purchase_id, v_grant->>'code';
    END IF;

    UPDATE public.purchases
    SET state = 'PAID', stripe_session_id = p_session_id,
        stripe_payment_intent = NULLIF(p_payment_intent, ''),
        paid_at = now(), updated_at = now()
    WHERE id = p_purchase_id;

    RETURN jsonb_build_object('ok', true, 'idempotent', false,
        'user_id', v_p.user_id, 'credits', v_p.credits,
        'balance_after', v_grant->'balance_after',
        'frozen', EXISTS (SELECT 1 FROM public.account_freezes WHERE user_id = v_p.user_id AND unfrozen_at IS NULL));
END $$;

DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.purchase_create(TEXT, TEXT, TEXT, TEXT, TEXT)',
        'public.purchase_fulfil(UUID, TEXT, TEXT)'
    ]
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END $$;
