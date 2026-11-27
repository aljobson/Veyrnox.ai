-- 0626 — Record OpenRouter's higher Seedance 2.0 Fast route cost (ADR-0256, issue #2660).
--
-- OpenRouter's public video-model feed moved `bytedance/seedance-2.0-fast`
-- from $4.20 to $5.60 per million video tokens. The priced 5 s 720p unit is
-- 108,000 tokens, so the secondary route now costs $0.6048 instead of $0.4536.
--
-- Crun remains the verified first route at $0.3246 and the customer price stays
-- 19 credits. The OpenRouter route already sat above that price's margin limit
-- (19 x $0.01796 = $0.34124), carries no margin waiver, and is therefore refused
-- by job_route_failover. Raising every Crun-backed job to OpenRouter's 34-credit
-- floor would charge customers for a failover that is not eligible. Enabling that
-- fallback later requires a separate owner decision to reprice or record a waiver.
--
-- This changes only the secondary route's recorded cost. It accepts the old or
-- new value for replay, asserts the exact route, and leaves catalog dispatch,
-- credits, route order, state, provenance and margin-waiver policy unchanged.
-- Rollback: a forward migration with a newly verified OpenRouter price.

BEGIN;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_routes
       SET cost_per_unit = 0.6048, updated_at = now()
     WHERE model_id = 'seedance-2.0-fast'
       AND supplier = 'openrouter'
       AND endpoint = 'bytedance/seedance-2.0-fast'
       AND cost_unit = 'per_generation'
       AND billing_seconds IS NULL
       AND priority = 2
       AND state = 'active'
       AND parity_record IS NOT NULL
       AND margin_waiver_note IS NULL
       AND cost_per_unit IN (0.4536, 0.6048);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one OpenRouter Seedance Fast route at $0.4536 or $0.6048, updated %', affected;
    END IF;
END $$;

COMMIT;
