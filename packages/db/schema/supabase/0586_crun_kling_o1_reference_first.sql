-- 0586 — Kling O1 · Reference (kling-o1-reference): Crun becomes the first route (feature mode), fal second. The price stays
-- at 47 credits per 5 s unit, 94 for 10 s (ADR-0256, ADR-0301, ADR-0037). Owner decision 2026-11-23: "Build it anyway", taken
-- knowing the speed and shape trade below.
--
-- Evidence (owner's paid probe, 2026-11-23, Crun model kling/o1-r2v, reference_video_type feature_video, 720p, aspect 16:9, audio
-- off): task 681e4480-3036-44d8-84bb-30311e929b26 succeeded after 364 s for 90 credits, equal to Crun's exact estimate for 5 s.
-- Clip: 5.04 s, 1280x720, h264, no audio stream; two frames read by Claude Code, no watermark. Crun's task record names the
-- upstream as provider "Kling", model_version "kling-o1". Cost: 90 / 206 = $0.4369 per 5 s unit (206 Crun credits per $1), 10 s is
-- 180 credits = $0.8738. fal's recorded cost is $0.84 per 5 s unit (0405), so Crun is about 48% cheaper.
-- NOT established: a side-by-side with fal (the fal staging key was out of balance), that the output follows the reference video's
-- motion (the test reference was a paper boat on water), that Crun fetches our signed R2 links (the probe used Crun's own temporary
-- upload), 10 s, and fal's speed. Crun's 364 s is slow: Kling 2.6 on Crun took a median 386 s and was moved off it for speed (0561).
--
-- Behaviour on this route, which differs from fal's:
--   - Kling refuses aspect_ratio auto in feature mode, so the gateway sends the nearest of 1:1, 16:9 and 9:16 to the uploaded video's
--     own size (lib/crunKlingO1Reference.js). fal follows any shape, so a 4:3 source is made 16:9 here.
--   - Crun needs a prompt; a blank one gets a fixed default sentence.
-- A job with uploaded media never hops (lib/supplierRoutesFailover.js), so fal is a manual fallback only for this offer.
--
-- The offer was activated by 0569 after the 0367 backfill, so it has no route row yet. This migration:
--   1. records fal as the priority-1 route it already is (current dispatch), where the offer has no route;
--   2. adds the Crun route as standby, priority 2, endpoint crun:kling/o1-r2v-ref (OUR name for feature mode; the adapter sends
--      Crun's model kling/o1-r2v);
--   3. records the probe on it, sets it active, and puts Crun first through the guarded model_route_reorder (it re-checks parity,
--      breakers and the offer's margin floor, and copies the first route's supplier, endpoint and cost to the catalog row);
--   4. asserts the end state: Crun first at $0.4369 and fal second at $0.8400, both inside 47 x 0.01796 = $0.8441.
-- Deploy the Worker that has crun:kling/o1-r2v-ref BEFORE applying: a first route the Worker cannot dispatch answers 501.
-- Idempotent. Existing jobs keep their debit. Rollback: a forward migration with model_route_reorder (fal first).

BEGIN;

INSERT INTO public.model_routes
    (model_id, supplier, endpoint, cost_per_unit, cost_unit, billing_seconds, priority, state, provenance, parity_record)
SELECT c.id, c.provider, c.provider_endpoint, c.provider_cost_per_unit, c.cost_unit, c.billing_seconds,
       1, 'active', 'official', 'current dispatch (0586: the offer was activated by 0569, after the 0367 backfill)'
  FROM public.model_catalog c
 WHERE c.id = 'kling-o1-reference' AND c.provider = 'fal' AND c.active
   AND NOT EXISTS (SELECT 1 FROM public.model_routes r WHERE r.model_id = c.id)
ON CONFLICT (model_id, priority) DO NOTHING;

INSERT INTO public.model_routes
    (model_id, supplier, endpoint, cost_per_unit, cost_unit, billing_seconds, priority, state, provenance)
SELECT 'kling-o1-reference', 'crun', 'crun:kling/o1-r2v-ref', 0.4369, 'per_second', 5, 2, 'standby', 'licensed_reseller'
  FROM public.model_catalog c
 WHERE c.id = 'kling-o1-reference' AND c.active
   AND NOT EXISTS (SELECT 1 FROM public.model_routes r
                    WHERE r.model_id = c.id
                      AND (r.priority = 3 OR (r.supplier = 'crun' AND r.endpoint = 'crun:kling/o1-r2v-ref')))
ON CONFLICT (model_id, priority) DO NOTHING;

DO $$
DECLARE affected BIGINT; res jsonb;
BEGIN
    UPDATE public.model_routes
       SET parity_record = 'probe 2026-11-23 (owner): kling/o1-r2v feature_video 720p 16:9 audio off, task 681e4480-3036-44d8-84bb-30311e929b26 success after 364 s, 90 credits (exact estimate), clip 5.04 s 1280x720 h264 no audio, two frames viewed by Claude Code, no watermark; upstream Kling kling-o1 per the task record; not compared with fal, motion transfer and signed-link fetch not proven',
           state = 'active', updated_at = now()
     WHERE model_id = 'kling-o1-reference' AND supplier = 'crun' AND endpoint = 'crun:kling/o1-r2v-ref'
       AND provenance = 'licensed_reseller' AND cost_unit = 'per_second' AND billing_seconds = 5
       AND cost_per_unit = 0.4369 AND state IN ('standby', 'active')
       AND (parity_record IS NULL OR parity_record LIKE 'probe 2026-11-23 (owner): kling/o1-r2v feature_video%');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one Crun Kling O1 reference route to prove and activate, updated %', affected;
    END IF;

    IF EXISTS (SELECT 1 FROM public.model_catalog WHERE id = 'kling-o1-reference' AND provider <> 'crun') THEN
        SELECT public.model_route_reorder(
            'kling-o1-reference',
            (SELECT array_agg(id ORDER BY CASE supplier WHEN 'crun' THEN 0 ELSE 1 END, priority)
               FROM public.model_routes WHERE model_id = 'kling-o1-reference' AND state = 'active'),
            'Crun first for Kling O1 reference, probe 2026-11-23 (0586)'
        ) INTO res;
        IF NOT COALESCE((res->>'ok')::boolean, false) THEN
            RAISE EXCEPTION 'Could not put Crun first for kling-o1-reference: %', res;
        END IF;
    END IF;

    SELECT count(*) INTO affected FROM public.model_catalog
     WHERE id = 'kling-o1-reference' AND provider = 'crun' AND provider_endpoint = 'crun:kling/o1-r2v-ref'
       AND provider_cost_per_unit = 0.4369 AND cost_unit = 'per_second' AND billing_seconds = 5
       AND credits_5s = 47 AND active AND round(0.4369 * 100000) <= 47 * 1796;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected kling-o1-reference served by Crun at 47 credits inside the floor, found % rows', affected;
    END IF;

    SELECT count(*) INTO affected FROM public.model_routes
     WHERE model_id = 'kling-o1-reference' AND state = 'active'
       AND ((priority = 1 AND supplier = 'crun' AND endpoint = 'crun:kling/o1-r2v-ref')
         OR (priority = 2 AND supplier = 'fal' AND endpoint = 'fal-ai/kling-video/o1/video-to-video/reference'
             AND round(cost_per_unit * 100000) <= 47 * 1796));
    IF affected <> 2 THEN
        RAISE EXCEPTION 'Expected Crun first and fal second on kling-o1-reference, found % matching routes', affected;
    END IF;
END $$;

COMMIT;
