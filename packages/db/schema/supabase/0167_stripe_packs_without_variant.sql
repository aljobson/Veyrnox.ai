-- 0167: Stripe-priced Credit Packs can be bought (ADR-0031, ADR-0037).
--
-- 0121 added web-270, web-1200 and web-3000 with no variant_id: under Stripe
-- the Checkout Session is priced inline from the Top-up row, so a pack has no
-- provider variant. But create_pending_top_up (0059) still selected only packs
-- with a variant, and top_ups.variant_id was NOT NULL, so every purchase of a
-- new pack returned PACK_NOT_FOUND. ADR-0031 kept the check on the assumption
-- that every pack would stay populated; 0121 broke that assumption.
--
-- Changes:
--   * top_ups.variant_id becomes nullable. Existing rows keep their value.
--   * create_pending_top_up: 0059 body, minus `AND p.variant_id IS NOT NULL`.
--     Being active is what makes a pack sellable.
--
-- Unchanged: credit_top_up (0097) already skips the variant comparison when
-- the provider sends none, which Stripe never does. The amount check against
-- price_usd_cents is the guard. credit_packs.variant_id and its UNIQUE stay.

ALTER TABLE public.top_ups ALTER COLUMN variant_id DROP NOT NULL;

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
    WHERE p.id = p_pack_id AND p.active;
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

REVOKE ALL ON FUNCTION public.create_pending_top_up(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_pending_top_up(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.create_pending_top_up(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_pending_top_up(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) TO service_role;
