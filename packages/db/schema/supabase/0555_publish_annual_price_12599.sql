-- Publish annual: $126.00 -> $125.99 (12600 -> 12599 cents) so the web price equals the
-- App Store and Google Play price. Apple has no $126.00 price point; $125.99 is the nearest
-- one, and the owner requires identical prices on every channel.
--
-- Only NEW purchases see $125.99. A running subscription keeps the price snapshot it was
-- started with (its own price_usd_cents on the subscription row), so no renewal changes.
-- Stripe has no Product/Price object for this plan (checkout uses inline price_data from this
-- row), so nothing changes there. No ledger or balance table is touched.
--
-- Replay-safe: matches the old 12600 or the new 12599 and assigns the absolute value.
BEGIN;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.social_publish_plans
       SET price_usd_cents = 12599, updated_at = now()
     WHERE id = 'publish-annual' AND billing_interval = 'year'
       AND price_usd_cents IN (12600, 12599);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one publish-annual row at 12600 or 12599 cents, updated %', affected;
    END IF;
END $$;


NOTIFY pgrst, 'reload schema';
COMMIT;
