-- Monthly credit value parity with a 50% contribution-margin target (ADR-0037).
-- One-off packs, not subscriptions. Paid balances retain their expiry rules.
-- Snapshot: docs/pricing/live-catalog-2026-09-24.json. No provider switches.
-- Keep pending top-ups and existing jobs at their snapshotted original prices.
BEGIN;

ALTER TABLE public.credit_packs DROP CONSTRAINT IF EXISTS credit_packs_sticker_floor;
ALTER TABLE public.credit_packs ADD CONSTRAINT credit_packs_sticker_floor
    CHECK (price_usd_cents::bigint * 10 >= credits::bigint * 43);
-- Retain the existing $0.033 net-credit floor as an additional conservative
-- legacy constraint; its LemonSqueezy fee formula is NOT a verified Stripe fee.

DO $$
DECLARE affected INTEGER;
BEGIN
    -- Guard existing pack identities so drift cannot silently retire a new offer.
    UPDATE public.credit_packs SET active = false, updated_at = now()
    WHERE sales_channel = 'web' AND (
        (id = 'web-300' AND credits = 300 AND price_usd_cents = 2500) OR
        (id = 'web-1000' AND credits = 1000 AND price_usd_cents = 7500));
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 2 THEN
        RAISE EXCEPTION 'Expected two original credit packs, updated %', affected;
    END IF;

    -- $10/100 remains the low entry-price option. New IDs preserve the meaning
    -- of historical purchases and pending checkout idempotency keys.
    INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, active)
    VALUES ('web-270', 'web', 270, 1900, true),
           ('web-1200', 'web', 1200, 5900, true),
           ('web-3000', 'web', 3000, 12900, true)
    ON CONFLICT (id) DO NOTHING;
    IF (SELECT count(*) FROM public.credit_packs WHERE sales_channel = 'web'
        AND active AND ((id = 'web-270' AND credits = 270 AND price_usd_cents = 1900)
         OR (id = 'web-1200' AND credits = 1200 AND price_usd_cents = 5900)
         OR (id = 'web-3000' AND credits = 3000 AND price_usd_cents = 12900))) <> 3 THEN
        RAISE EXCEPTION 'Parity pack rows missing or changed';
    END IF;

    UPDATE public.model_catalog SET credits_5s = 2, updated_at = now()
    WHERE id = 'nano-banana-kie' AND active AND provider = 'kie'
      AND provider_endpoint = 'market:google/nano-banana'
      AND provider_cost_per_unit = 0.0200 AND cost_unit = 'per_generation'
      AND billing_seconds IS NULL AND credits_5s = 2;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected active Nano Banana at verified $0.02 cost, updated %', affected;
    END IF;

    UPDATE public.model_catalog SET credits_5s = 2, updated_at = now()
    WHERE id = 'flux-2-pro' AND active AND provider = 'fal'
      AND provider_endpoint = 'fal-ai/flux-2-pro'
      AND provider_cost_per_unit = 0.0300 AND cost_unit = 'per_generation'
      AND billing_seconds IS NULL AND credits_5s = 2;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected active FLUX.2 Pro at verified $0.03 cost, updated %', affected;
    END IF;

    UPDATE public.model_catalog SET credits_5s = 9, updated_at = now()
    WHERE id = 'hailuo-02-kie' AND active AND provider = 'kie'
      AND provider_endpoint = 'market:hailuo/02-text-to-video-standard'
      AND provider_cost_per_unit = 0.1500 AND cost_unit = 'per_second'
      AND billing_seconds = 6 AND credits_5s IN (9, 10);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected active Hailuo 02 6s at verified $0.15 cost, updated %', affected;
    END IF;

    -- Owner's 50% target, using the documented 8% + $0.30 fee scenario.
    -- $129/3000 is the tightest proposed pack: each credit can fund $0.01796
    -- of provider cost while retaining half of gross revenue. Historical
    -- video rows store a whole clip cost; only clip-edit stores $/second.
    IF EXISTS (SELECT 1 FROM public.model_catalog WHERE active AND (
        provider_cost_per_unit IS NULL OR provider_cost_per_unit < 0 OR
        credits_5s IS NULL OR credits_5s <= 0 OR
        (CASE WHEN id = 'clip-edit' THEN provider_cost_per_unit * 5
              ELSE provider_cost_per_unit END) > credits_5s * 0.01796)) THEN
        RAISE EXCEPTION 'Active model fails the recorded-cost 50 percent contribution scenario';
    END IF;
END $$;
COMMIT;
