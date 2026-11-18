-- 0559 — Kling 3.0 Pro image-to-video (the kie offer, public id kling-3.0-i2v-a1): Crun becomes the first route;
-- the price does not change (ADR-0256, ADR-0037).
--
-- Evidence (the owner's paid probe, 2026-11-17 19:44:14 UTC, scripts/probe-crun.mjs kling-3-10s, endpoint crun:kling/v3,
-- model kling/v3, mode pro = 1080p, audio off, single shot, one start frame, 10 s):
--   Crun log row 290***df4 (the full task id was not recorded): Success, 180 credits, 161 s. 180 = 18 credits a second
--   x 10 s, as Crun's price page says (Kling 3.0, no audio, 1080p, read 2026-11-17). The charge was read in crun.ai/logs
--   on 2026-11-18 by Claude Code in the owner's signed-in browser pane.
--   For comparison, fal Pro on the same clip length: 260 s on staging, 475 s on production (2026-11-17).
--   Same model, std mode, also served live through the gateway on 2026-11-17 (Kling 3.0 Standard, 0558).
--   NOT established: the output's resolution and content (the clip was not downloaded), which model made it (a clip
--   cannot prove that; it rests on Crun's model id), and the task's output host. One sample.
--
-- Cost: 90 Crun credits per 5 s unit (18 a second) at the owner's top-up rate of 206 per $1 = $0.4369 (0435). kie,
-- now second, is $0.5050. The offer stays at 29 credits, so kie is 0.5050 <= 29 x 0.01796 = $0.5208 and a hop onto it
-- needs no margin waiver. The saving is margin (about 13% a 5 s unit), not a price cut. An image-source request is not
-- hopped to another supplier (0436), so a Crun failure on this offer refunds instead of retrying on kie.
--
-- Not in this migration: kling-3.0-i2v (the fal Pro offer). It sells a negative prompt and an end frame, which Crun's
-- Kling 3.0 does not take as our adapter sends it, so moving it would remove features. That is a product decision.
--
-- What this does, in order, so every database reaches one state:
--   1. records the parity evidence on the Crun route and sets it active (licensed_reseller since 0375);
--   2. puts Crun first through the guarded model_route_reorder, where it is not already first (it re-checks parity and
--      breakers and copies the first route's supplier, endpoint and cost to the catalog row);
--   3. asserts the offer is now served by Crun at the unchanged 29 credits.
--
-- Each UPDATE names the row's exact identity and asserts one row. Idempotent. Existing jobs keep their debit.
-- Rollback: a forward migration with model_route_reorder (kie first).

BEGIN;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_routes
       SET parity_record = 'probe 2026-11-17 19:44:14 UTC (owner): crun:kling/v3 = kling/v3 mode pro (1080p), 10 s, audio off, one start frame, Crun log row 290***df4 (full task id not recorded) Success, 161 s, 180 credits read in crun.ai/logs (18 a second x 10, as the price page says); fal Pro on the same length took 260 s (staging) and 475 s (production); output resolution, content and host not inspected (clip not downloaded); model identity rests on Crun id (a clip cannot prove it); one sample',
           cost_per_unit = 0.4369, state = 'active', updated_at = now()
     WHERE supplier = 'crun' AND endpoint = 'crun:kling/v3' AND model_id = 'kling-3.0-i2v-kie'
       AND provenance = 'licensed_reseller' AND cost_unit = 'per_second' AND billing_seconds = 5
       AND cost_per_unit = 0.4369 AND state IN ('standby', 'active')
       AND (parity_record IS NULL OR parity_record LIKE 'probe 2026-11-17 19:44:14 UTC (owner): crun:kling/v3 =%');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one Crun Kling 3.0 Pro route to prove and activate, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE res jsonb;
BEGIN
    IF EXISTS (SELECT 1 FROM public.model_catalog WHERE id = 'kling-3.0-i2v-kie' AND provider <> 'crun') THEN
        SELECT public.model_route_reorder(
            'kling-3.0-i2v-kie',
            (SELECT array_agg(id ORDER BY CASE supplier WHEN 'crun' THEN 0 ELSE 1 END, priority)
               FROM public.model_routes WHERE model_id = 'kling-3.0-i2v-kie' AND state = 'active'),
            'Crun first for Kling 3.0 Pro (kie offer), parity 2026-11-17 (0559)'
        ) INTO res;
        IF NOT COALESCE((res->>'ok')::boolean, false) THEN
            RAISE EXCEPTION 'Could not put Crun first for kling-3.0-i2v-kie: %', res;
        END IF;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    SELECT count(*) INTO affected FROM public.model_catalog
     WHERE id = 'kling-3.0-i2v-kie' AND provider = 'crun' AND provider_endpoint = 'crun:kling/v3'
       AND provider_cost_per_unit = 0.4369 AND cost_unit = 'per_second' AND billing_seconds = 5 AND credits_5s = 29;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected kling-3.0-i2v-kie served by Crun at 29 credits, found % matching rows', affected;
    END IF;
    SELECT count(*) INTO affected FROM public.model_routes
     WHERE model_id = 'kling-3.0-i2v-kie' AND state = 'active'
       AND ((priority = 1 AND supplier = 'crun' AND endpoint = 'crun:kling/v3')
         OR (priority = 2 AND supplier = 'kie' AND endpoint = 'market:kling-3.0/video'));
    IF affected <> 2 THEN
        RAISE EXCEPTION 'Expected Crun first and kie second on kling-3.0-i2v-kie, found % matching routes', affected;
    END IF;
END $$;

COMMIT;
