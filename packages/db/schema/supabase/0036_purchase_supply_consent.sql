-- Supply Consent on the pending Top-up (ADR-0018 decision 6, ADR-0020).
--
-- purchase_create now requires the consent wording version the buyer ticked
-- and records it with a server timestamp. The version is checked for shape
-- here; POST /api/v1/checkout checks it equals the current wording
-- (lib/supplyConsent.js).
--
-- The columns are NOT NULL with no backfill: no purchase row exists in any
-- environment when this runs (0035 has never taken a payment). If that ever
-- stops being true, this migration fails loudly rather than inventing consent.
--
-- The 3-argument purchase_create from 0035 is dropped so no caller can create
-- a purchase without consent.
--
-- Idempotent: IF NOT EXISTS, DROP IF EXISTS, OR REPLACE; REVOKE/GRANT re-run.

ALTER TABLE public.purchases
    ADD COLUMN IF NOT EXISTS supply_consent_version TEXT NOT NULL
        CONSTRAINT purchases_supply_consent_version_shape CHECK (supply_consent_version ~ '^[a-z0-9-]{1,64}$'),
    ADD COLUMN IF NOT EXISTS supply_consent_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP FUNCTION IF EXISTS public.purchase_create(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.purchase_create(
    p_auth_id TEXT,
    p_pack_id TEXT,
    p_idempotency_key TEXT,
    p_supply_consent_version TEXT
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

    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;

    -- Serialise this user's purchase creation so the rate-limit count and
    -- the idempotency probe below cannot race.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('purchase:' || v_user_id::text, 0));

    SELECT * INTO v_existing FROM public.purchases
    WHERE user_id = v_user_id AND idempotency_key = p_idempotency_key;
    IF v_existing.id IS NOT NULL THEN
        IF v_existing.pack_id <> p_pack_id THEN
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

    SELECT * INTO v_pack FROM public.credit_packs WHERE id = p_pack_id AND active;
    IF v_pack.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PACK_UNAVAILABLE');
    END IF;

    SELECT count(*) INTO v_recent FROM public.purchases
    WHERE user_id = v_user_id AND created_at > now() - interval '10 minutes';
    IF v_recent >= 5 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
    END IF;

    INSERT INTO public.purchases (user_id, pack_id, credits, idempotency_key, supply_consent_version, supply_consent_at)
    VALUES (v_user_id, v_pack.id, v_pack.credits, p_idempotency_key, p_supply_consent_version, now())
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('ok', true, 'idempotent', false,
        'purchase_id', v_id, 'state', 'PENDING',
        'credits', v_pack.credits, 'stripe_price_id', v_pack.stripe_price_id);
END $$;

REVOKE ALL ON FUNCTION public.purchase_create(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purchase_create(TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.purchase_create(TEXT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_create(TEXT, TEXT, TEXT, TEXT) TO service_role;
