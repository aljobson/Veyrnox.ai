-- Credit Pack catalog, pending Top-ups, and create_pending_top_up (#92, ADR-0018).
--
-- Numbered 0041, not 0035: unmerged branches already hold 0035-0040
-- (wallet residue, kie/openrouter catalog, the superseded Stripe packs).
-- Applied name: 0041_credit_packs_and_top_ups.
--
-- credit_packs  one row per pack per Sales Channel. Prices are normative here
--               (CLAUDE.md "Money & billing"); ADR-0018's two floors are table
--               CHECKs so no write path can set a price under them. Seeded
--               inactive with no variant: LemonSqueezy variant ids differ
--               between test and live mode, so scripts/seed-credit-packs.mjs
--               sets them from config/credit-packs.json per environment.
-- top_ups       one row per purchase attempt, written before the checkout
--               redirect. Credits, price and variant are copied from the pack
--               so a later price change never alters a started Top-up. The
--               crediting and refund columns arrive with #96/#97.
--
-- No browser access: RLS enabled and forced with no policies, and every
-- privilege revoked from anon/authenticated. Only the Worker (service_role)
-- reads packs and calls the function.

CREATE TABLE IF NOT EXISTS public.credit_packs (
    id               TEXT        PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{1,32}$'),
    sales_channel    TEXT        NOT NULL CHECK (sales_channel IN ('web')),
    credits          INTEGER     NOT NULL CHECK (credits > 0),
    price_usd_cents  INTEGER     NOT NULL CHECK (price_usd_cents > 0),
    variant_id       TEXT        NULL CHECK (variant_id ~ '^[0-9]{1,20}$'),
    active           BOOLEAN     NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (sales_channel, variant_id),
    CONSTRAINT credit_packs_active_needs_variant CHECK (NOT active OR variant_id IS NOT NULL),
    -- A Credit Pack costs more per credit than every Subscription: >= 7.5c.
    CONSTRAINT credit_packs_sticker_floor CHECK (price_usd_cents * 10 >= credits * 75),
    -- Net of the Merchant of Record fee, before tax, >= $0.033/credit.
    -- web = LemonSqueezy: 5% + 1.5% international, charged on the
    -- tax-inclusive total (taken at 27%, the highest EU VAT), plus 50c.
    -- 0.065 * 1.27 = 8.255%, so in 1/100000 cent:
    --   price * (100000 - 8255) - 50 * 100000 >= credits * 3.3 * 100000
    -- A channel with no fee formula here cannot hold a pack.
    CONSTRAINT credit_packs_net_floor CHECK (
        CASE sales_channel
            WHEN 'web' THEN price_usd_cents::bigint * 91745 - 5000000 >= credits::bigint * 330000
            ELSE false
        END
    )
);

INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents) VALUES
    ('web-100',  'web', 100,  1000),
    ('web-300',  'web', 300,  2500),
    ('web-1000', 'web', 1000, 7500)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.top_ups (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    pack_id          TEXT        NOT NULL REFERENCES public.credit_packs(id) ON DELETE RESTRICT,
    sales_channel    TEXT        NOT NULL,
    credits          INTEGER     NOT NULL CHECK (credits > 0),
    price_usd_cents  INTEGER     NOT NULL CHECK (price_usd_cents > 0),
    variant_id       TEXT        NOT NULL,
    status           TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'credited')),
    consent_at       TIMESTAMPTZ NOT NULL,
    consent_version  TEXT        NOT NULL CHECK (consent_version ~ '^[A-Za-z0-9._-]{1,32}$'),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS top_ups_user_created_idx ON public.top_ups (user_id, created_at DESC);

ALTER TABLE public.credit_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_packs FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.top_ups      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.top_ups      FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.credit_packs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.top_ups      FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.credit_packs TO service_role;

-- create_pending_top_up: the only writer of top_ups.
--
-- Returns {ok:true, top_up_id, credits, price_usd_cents, variant_id} or
-- {ok:false, code} with code USER_NOT_FOUND, CONSENT_VERSION_REQUIRED,
-- PACK_NOT_FOUND or RATE_LIMITED (+ retry_after_seconds). The caller has
-- already required explicit consent = true; the timestamp is taken here.
--
-- The rate limit counts under a lock on the user's row, so concurrent
-- requests cannot all pass the check. NO KEY UPDATE, not UPDATE, so FK
-- inserts elsewhere (jobs, ledger_entries) are not blocked by it.
CREATE OR REPLACE FUNCTION public.create_pending_top_up(
    p_auth_id TEXT,
    p_pack_id TEXT,
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
    v_pack public.credit_packs%ROWTYPE;
    v_count INTEGER;
    v_retry INTEGER;
    v_top_up_id UUID;
BEGIN
    IF p_limit_per_window IS NULL OR p_limit_per_window <= 0
       OR p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BAD_LIMIT');
    END IF;

    SELECT u.id INTO v_user_id FROM public.users u
    WHERE u.auth_id = p_auth_id
    FOR NO KEY UPDATE;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
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

    INSERT INTO public.top_ups (user_id, pack_id, sales_channel, credits, price_usd_cents,
                                variant_id, consent_at, consent_version)
    VALUES (v_user_id, v_pack.id, v_pack.sales_channel, v_pack.credits, v_pack.price_usd_cents,
            v_pack.variant_id, now(), p_consent_version)
    RETURNING id INTO v_top_up_id;

    RETURN jsonb_build_object(
        'ok', true,
        'top_up_id', v_top_up_id,
        'credits', v_pack.credits,
        'price_usd_cents', v_pack.price_usd_cents,
        'variant_id', v_pack.variant_id
    );
END $$;

REVOKE ALL ON FUNCTION public.create_pending_top_up(TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_pending_top_up(TEXT, TEXT, TEXT, INTEGER, INTEGER) TO service_role;
