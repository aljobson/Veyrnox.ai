-- 0584 — Kling 2.6 Pro (public id kling-2.6-pro-a1): Crun becomes the first route again, kie second. The price does
-- not change (ADR-0256, ADR-0037). This reverses 0561. It is the owner's call (2026-11-23: "Crun first", then "Back to
-- Crun" when asked about this offer), taken knowing the speed cost below.
--
-- Cost, per 5 s clip as recorded: Crun $0.2670 (55 Crun credits at 206 per $1), kie $0.3150. Crun first saves about 15%
-- of supplier cost (0.0480 a clip) and keeps both routes inside the 18-credit floor (18 x 0.01796 = 0.3233).
--
-- Speed, the reason 0561 moved it to kie, measured 2026-11-19, 5 s clips, audio off, same prompt, three runs each:
--   Crun (through the gateway)  325 s, 386 s, 678 s   median 386 s
--   fal  (staging key, direct)  162 s, 135 s, 254 s    median 162 s
--   kie  163 s once, early November
-- A person waits that time for each 2.6 clip. NOT established: whether Crun is faster today. Re-time one clip through
-- the gateway after applying; if it is still several minutes, put kie first again with a forward migration.
--
-- What this does, in order, so every database reaches one state:
--   1. puts Crun first through the guarded model_route_reorder, where it is not already first (it re-checks parity and
--      breakers and copies the first route's supplier, endpoint and cost to the catalog row);
--   2. asserts the offer is served by Crun at the unchanged 18 credits with kie second.
--
-- Existing jobs keep their debit. Idempotent. Rollback: a forward migration with model_route_reorder (kie first), as 0561.

BEGIN;

DO $$
DECLARE res jsonb;
BEGIN
    IF EXISTS (SELECT 1 FROM public.model_catalog WHERE id = 'kling-2.6-pro-kie' AND provider <> 'crun') THEN
        SELECT public.model_route_reorder(
            'kling-2.6-pro-kie',
            (SELECT array_agg(id ORDER BY CASE supplier WHEN 'crun' THEN 0 ELSE 1 END, priority)
               FROM public.model_routes WHERE model_id = 'kling-2.6-pro-kie' AND state = 'active'),
            'Crun first for Kling 2.6 Pro: owner decision 2026-11-23, supplier cost 0.2670 vs kie 0.3150; speed trade known (0561)'
        ) INTO res;
        IF NOT COALESCE((res->>'ok')::boolean, false) THEN
            RAISE EXCEPTION 'Could not put Crun first for kling-2.6-pro-kie: %', res;
        END IF;
    END IF;
END $$;

DO $$
DECLARE n BIGINT;
BEGIN
    SELECT count(*) INTO n FROM public.model_catalog c
     WHERE c.id = 'kling-2.6-pro-kie' AND c.provider = 'crun' AND c.provider_endpoint = 'crun:kling/v2-6'
       AND c.cost_unit = 'per_second' AND c.billing_seconds = 5 AND c.credits_5s = 18
       AND c.provider_cost_per_unit = (SELECT r.cost_per_unit FROM public.model_routes r
                                        WHERE r.model_id = c.id AND r.supplier = 'crun' AND r.endpoint = c.provider_endpoint);
    IF n <> 1 THEN
        RAISE EXCEPTION 'Expected kling-2.6-pro-kie served by Crun at 18 credits, found % matching rows', n;
    END IF;
    SELECT count(*) INTO n FROM public.model_routes
     WHERE model_id = 'kling-2.6-pro-kie' AND state = 'active'
       AND ((priority = 1 AND supplier = 'crun' AND endpoint = 'crun:kling/v2-6')
         OR (priority = 2 AND supplier = 'kie' AND endpoint = 'market:kling-2.6/text-to-video'));
    IF n <> 2 THEN
        RAISE EXCEPTION 'Expected Crun first and kie second on kling-2.6-pro-kie, found % matching routes', n;
    END IF;
END $$;

COMMIT;
