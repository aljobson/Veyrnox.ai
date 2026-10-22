-- 0365 — Flatten the Credit Pack price curve (ADR-0037, amendment 1).
--
-- The entry pack costs $0.100 a credit and the top pack $0.043. Every catalog
-- price is set so a credit may carry $0.01796 of provider cost and still leave
-- 50% of gross after an 8% + $0.30 fee (ADR-0037), and that bound is tightest
-- at the $129/3000 pack. The smaller packs carried far more room than that
-- (about 71% at the entry pack), so they can give more credits for the same
-- price and stay at or above the 50% target for the worst-costed credit.
--
--   now                      after
--   web-100   $10 /  100     web-160   $10 /  160   ($0.0625 a credit)
--   web-270   $19 /  270     web-330   $19 /  330   ($0.0576)
--   web-1200  $59 / 1200     web-1300  $59 / 1300   ($0.0454)
--   web-3000  $129 / 3000    web-3000  unchanged    ($0.0430)
--
-- Same rule as 0121: new ids carry the new credit counts so historical
-- purchases and pending checkout idempotency keys keep their meaning, the old
-- packs are deactivated (never deleted, never rewritten), and a pending top-up
-- keeps the price and credits it was opened with. Prices are $0.043 or more a
-- credit, which is the credit_packs_sticker_floor (0121); the legacy net floor
-- (0041) holds for each new row too, so the existing constraints still bound
-- every pack. Rollback: reactivate the three retired ids, deactivate the three
-- new ones (a forward migration; applied files stay as they are).
--
-- Evidence and the options considered: docs/pricing/matching-buzzy-prices-2026-10-22.md.
-- Idempotent: INSERT ... ON CONFLICT DO NOTHING, and absolute assignments.

BEGIN;

DO $$
DECLARE affected INTEGER;
BEGIN
    INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, active)
    VALUES ('web-160', 'web', 160, 1000, true),
           ('web-330', 'web', 330, 1900, true),
           ('web-1300', 'web', 1300, 5900, true)
    ON CONFLICT (id) DO NOTHING;
    IF (SELECT count(*) FROM public.credit_packs WHERE sales_channel = 'web'
        AND ((id = 'web-160' AND credits = 160 AND price_usd_cents = 1000)
          OR (id = 'web-330' AND credits = 330 AND price_usd_cents = 1900)
          OR (id = 'web-1300' AND credits = 1300 AND price_usd_cents = 5900))) <> 3 THEN
        RAISE EXCEPTION 'New credit pack rows missing or changed';
    END IF;

    -- Make the three new packs sellable on a replay too (absolute value).
    UPDATE public.credit_packs SET active = true, updated_at = now()
    WHERE sales_channel = 'web' AND id IN ('web-160', 'web-330', 'web-1300');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 3 THEN
        RAISE EXCEPTION 'Expected three new credit packs, updated %', affected;
    END IF;

    -- Retire the three packs they replace, guarded by their exact shape so
    -- drift cannot silently retire a different offer.
    UPDATE public.credit_packs SET active = false, updated_at = now()
    WHERE sales_channel = 'web' AND (
        (id = 'web-100' AND credits = 100 AND price_usd_cents = 1000) OR
        (id = 'web-270' AND credits = 270 AND price_usd_cents = 1900) OR
        (id = 'web-1200' AND credits = 1200 AND price_usd_cents = 5900));
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 3 THEN
        RAISE EXCEPTION 'Expected three original credit packs, updated %', affected;
    END IF;

    -- The top pack stays exactly as it was.
    IF NOT EXISTS (SELECT 1 FROM public.credit_packs WHERE id = 'web-3000' AND sales_channel = 'web'
                   AND credits = 3000 AND price_usd_cents = 12900 AND active) THEN
        RAISE EXCEPTION 'web-3000 missing or changed';
    END IF;

    -- Per-pack margin guard. 0121 checked the catalog against the $129 pack's
    -- rate alone; each pack has its own fixed-fee share, so check each one:
    --   price * (1 - 0.08) - 0.30 - credits * 0.01796 >= price * 0.50
    -- in cents, scaled by 1000: price*420 - 30000 >= credits * 1796.
    IF EXISTS (SELECT 1 FROM public.credit_packs WHERE sales_channel = 'web' AND active
               AND price_usd_cents::bigint * 420 - 30000 < credits::bigint * 1796) THEN
        RAISE EXCEPTION 'An active credit pack falls below the 50 percent contribution scenario';
    END IF;

    -- Exactly these four web packs are sellable.
    IF (SELECT string_agg(id || ':' || credits || ':' || price_usd_cents, ',' ORDER BY credits)
        FROM public.credit_packs WHERE sales_channel = 'web' AND active)
       IS DISTINCT FROM 'web-160:160:1000,web-330:330:1900,web-1300:1300:5900,web-3000:3000:12900' THEN
        RAISE EXCEPTION 'Active web credit packs are not the expected four';
    END IF;
END $$;

COMMIT;
