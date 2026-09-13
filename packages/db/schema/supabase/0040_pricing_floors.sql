-- Credit Pack pricing floors (ADR-0018 decision 4, ADR-0014, ADR-0019).
--
-- An active Credit Pack must satisfy both floors, checked whenever a pack is
-- activated or repriced and whenever a channel's fee changes:
--   gross — price ≥ $0.075 per credit, so a pack always costs at least the
--           Starter Subscription reference rate;
--   net   — price minus the channel's worst-case Merchant of Record and card
--           fees, before tax, ≥ $0.033 per credit, so ADR-0014's 50% margin
--           holds on cash received.
--
-- sales_channels holds each channel's fee as one worst case. web, for a UK
-- Stripe account on Managed Payments (stripe.com/gb/pricing, 2026-09-13):
--   3.50%  Managed Payments fee, on top of card fees
--   3.15%  international (non-EEA) card, the most expensive card class
--   2.00%  currency conversion
--   = 8.65%, and Stripe does not say whether it is charged on the
--   tax-inclusive total, so assume it is at the highest EU VAT rate (27%):
--   8.65% × 1.27 = 10.99% → fee_bps 1100
--   20p fixed per transaction → 30 US cents, leaving room for the exchange rate.
-- Re-derive and update the row when Stripe's pricing changes; the trigger
-- refuses a fee that would put an active pack under the net floor.
--
-- Prices are recorded in USD cents. Stripe Price amounts cannot be edited, so
-- scripts/set-credit-pack-price.mjs reads the amount from the Stripe Price
-- itself when a pack is priced; these triggers then enforce the floors on
-- what was recorded, however it was written.
--
-- App Store and Google Play have no sales_channels row yet, so their packs
-- cannot be activated until their fees are entered.
--
-- Idempotent: IF NOT EXISTS, ON CONFLICT DO NOTHING, guarded constraint add,
-- OR REPLACE, DROP TRIGGER IF EXISTS; REVOKE/GRANT re-run.

CREATE TABLE IF NOT EXISTS public.sales_channels (
    id                  TEXT        PRIMARY KEY CHECK (id IN ('web', 'app_store', 'google_play')),
    merchant_of_record  TEXT        NOT NULL,
    fee_bps             INTEGER     NOT NULL CHECK (fee_bps >= 0 AND fee_bps < 10000),
    fee_fixed_cents     INTEGER     NOT NULL CHECK (fee_fixed_cents >= 0),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.sales_channels (id, merchant_of_record, fee_bps, fee_fixed_cents)
VALUES ('web', 'Stripe Managed Payments', 1100, 30)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.sales_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_channels FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_channels FROM anon, authenticated;

ALTER TABLE public.credit_packs
    ADD COLUMN IF NOT EXISTS price_cents INTEGER NULL
        CONSTRAINT credit_packs_price_cents_positive CHECK (price_cents > 0),
    ADD COLUMN IF NOT EXISTS currency TEXT NULL
        CONSTRAINT credit_packs_currency_usd CHECK (currency = 'usd');

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'credit_packs_sales_channel_fkey') THEN
        ALTER TABLE public.credit_packs
            ADD CONSTRAINT credit_packs_sales_channel_fkey
            FOREIGN KEY (sales_channel) REFERENCES public.sales_channels (id);
    END IF;
END $$;

-- NULL when the price clears both floors, otherwise the reason it does not.
-- Floors are in tenths of a US cent per credit: 75 = $0.075, 33 = $0.033.
CREATE OR REPLACE FUNCTION public.credit_pack_floor_violation(
    p_credits INTEGER,
    p_price_cents INTEGER,
    p_currency TEXT,
    p_fee_bps INTEGER,
    p_fee_fixed_cents INTEGER
) RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_fee_cents BIGINT;
    v_net_cents BIGINT;
BEGIN
    IF p_price_cents IS NULL OR p_currency IS DISTINCT FROM 'usd' THEN
        RETURN 'an active pack needs a USD price';
    END IF;
    IF p_fee_bps IS NULL OR p_fee_fixed_cents IS NULL THEN
        RETURN 'the pack''s sales channel has no fee on record';
    END IF;
    IF p_price_cents::BIGINT * 10 < p_credits::BIGINT * 75 THEN
        RETURN format('gross %s cents for %s credits is under $0.075 per credit', p_price_cents, p_credits);
    END IF;
    -- Round the fee up: the floor must hold on the worst cent.
    v_fee_cents := (p_price_cents::BIGINT * p_fee_bps + 9999) / 10000 + p_fee_fixed_cents;
    v_net_cents := p_price_cents - v_fee_cents;
    IF v_net_cents * 10 < p_credits::BIGINT * 33 THEN
        RETURN format('net %s cents for %s credits is under $0.033 per credit after a %s cent fee',
                      v_net_cents, p_credits, v_fee_cents);
    END IF;
    RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.credit_packs_enforce_floors()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_channel public.sales_channels%ROWTYPE;
    v_problem TEXT;
BEGIN
    IF NOT NEW.active THEN
        RETURN NEW;
    END IF;
    SELECT * INTO v_channel FROM public.sales_channels WHERE id = NEW.sales_channel;
    v_problem := public.credit_pack_floor_violation(NEW.credits, NEW.price_cents, NEW.currency,
                                                    v_channel.fee_bps, v_channel.fee_fixed_cents);
    IF v_problem IS NOT NULL THEN
        RAISE EXCEPTION 'pricing floor: pack % (%): %', NEW.id, NEW.sales_channel, v_problem
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS credit_packs_enforce_floors ON public.credit_packs;
CREATE TRIGGER credit_packs_enforce_floors
    BEFORE INSERT OR UPDATE ON public.credit_packs
    FOR EACH ROW EXECUTE FUNCTION public.credit_packs_enforce_floors();

CREATE OR REPLACE FUNCTION public.sales_channels_enforce_floors()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_pack public.credit_packs%ROWTYPE;
    v_problem TEXT;
BEGIN
    FOR v_pack IN SELECT * FROM public.credit_packs WHERE sales_channel = NEW.id AND active LOOP
        v_problem := public.credit_pack_floor_violation(v_pack.credits, v_pack.price_cents, v_pack.currency,
                                                        NEW.fee_bps, NEW.fee_fixed_cents);
        IF v_problem IS NOT NULL THEN
            RAISE EXCEPTION 'pricing floor: fee change on % breaks active pack %: %', NEW.id, v_pack.id, v_problem
                USING ERRCODE = 'check_violation';
        END IF;
    END LOOP;
    NEW.updated_at := now();
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sales_channels_enforce_floors ON public.sales_channels;
CREATE TRIGGER sales_channels_enforce_floors
    BEFORE UPDATE ON public.sales_channels
    FOR EACH ROW EXECUTE FUNCTION public.sales_channels_enforce_floors();

-- Packs already active before this migration get the same check once.
DO $$
DECLARE
    v_pack public.credit_packs%ROWTYPE;
    v_problem TEXT;
BEGIN
    FOR v_pack IN SELECT * FROM public.credit_packs WHERE active LOOP
        SELECT public.credit_pack_floor_violation(v_pack.credits, v_pack.price_cents, v_pack.currency, c.fee_bps, c.fee_fixed_cents)
        INTO v_problem FROM public.sales_channels c WHERE c.id = v_pack.sales_channel;
        IF v_problem IS NOT NULL OR NOT FOUND THEN
            RAISE EXCEPTION 'pricing floor: active pack % fails: %', v_pack.id, COALESCE(v_problem, 'no sales channel fee');
        END IF;
    END LOOP;
END $$;

DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.credit_pack_floor_violation(INTEGER, INTEGER, TEXT, INTEGER, INTEGER)',
        'public.credit_packs_enforce_floors()',
        'public.sales_channels_enforce_floors()'
    ]
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END $$;
