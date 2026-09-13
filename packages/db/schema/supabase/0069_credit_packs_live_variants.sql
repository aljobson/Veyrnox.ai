-- Launch (#101): point the three web Credit Packs at LemonSqueezy's live-mode
-- variants. Production has held the test-mode ids (#91) since they were set
-- by hand; live mode has different ids.
--
-- DRAFT until the __LIVE_*__ placeholders are replaced with the live variant
-- ids from GET /v1/variants?filter[product_id]=<live product id> (live API
-- key). Applied unfilled, the variant_id CHECK rejects the update and the
-- migration fails without changing anything.
--
-- Apply only in the launch window, with the live LEMONSQUEEZY_API_KEY and
-- LEMONSQUEEZY_WEBHOOK_SECRET set and LEMONSQUEEZY_TEST_MODE "false": a live
-- variant with the test key fails at checkout, and the webhook only credits
-- orders in the mode it expects.
--
-- Idempotent: a row moves only from its own test-mode id, so a second run
-- changes nothing, and a fresh database (variant_id NULL) is untouched.
-- One statement: if any web pack is still on a test-mode id afterwards (its
-- credits or price no longer match), it raises and nothing is changed.
-- Pending Top-ups keep the variant they copied; a test-mode order paid after
-- the switch is refused by the webhook's test_mode check.
DO $$
BEGIN
    UPDATE public.credit_packs AS p
       SET variant_id = v.live_variant_id
      FROM (VALUES
            ('web-100',  100,  1000, '2120823', '__LIVE_100__'),
            ('web-300',  300,  2500, '2120828', '__LIVE_300__'),
            ('web-1000', 1000, 7500, '2120831', '__LIVE_1000__')
           ) AS v(id, credits, price_usd_cents, test_variant_id, live_variant_id)
     WHERE p.id = v.id
       AND p.sales_channel = 'web'
       AND p.credits = v.credits
       AND p.price_usd_cents = v.price_usd_cents
       AND p.variant_id = v.test_variant_id;

    IF EXISTS (SELECT 1 FROM public.credit_packs
                WHERE sales_channel = 'web'
                  AND variant_id IN ('2120823', '2120828', '2120831')) THEN
        RAISE EXCEPTION 'credit_packs: a web pack is still on a test-mode variant id';
    END IF;
END
$$;
