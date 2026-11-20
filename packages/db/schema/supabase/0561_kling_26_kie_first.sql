-- 0561 — Kling 2.6 Pro (public id kling-2.6-pro-a1): kie becomes the first route again, Crun second. The price does
-- not change (ADR-0256, ADR-0037). This reverses 0436 on speed grounds; it is not a cost saving.
--
-- Why: 0436 put Crun first on 2026-11-03 on cost and a probe of 87 s. Measured 2026-11-19, 5 s clips, audio off, same
-- prompt, three runs each:
--   Crun (through the gateway)  325 s, 386 s, 678 s   median 386 s   Crun's own timer 310 s and 377 s for the first two
--   fal  (staging key, direct)  162 s, 135 s, 254 s    median 162 s   (scripts/probe-kling-26-fal.mjs)
--   kie  163 s once, early November (0106); not re-timed today.
-- Crun's Kling 2.6 now takes 4 to 8 times what it did when 0436 put it first. Every fal run beat Crun's fastest.
-- A person waits that time for each 2.6 clip.
--
-- Cost, per 5 s clip as recorded: Crun $0.2670, kie $0.3150 (0433 raised it from $0.2750; 0438 recorded it on the
-- route), fal $0.3500, Higgsfield $0.1750 (staged dark). So kie first costs about 18% more than Crun first. The offer
-- stays at 18 credits, so kie (0.3150) is inside 18 x 0.01796 = $0.3233, with about $0.008 a clip of room. That is
-- thin: any further kie price rise needs a repricing. This migration trades supplier cost for waiting time.
--
-- NOT established: kie's speed today (one sample, early November). The kie route has been this offer's second active
-- route throughout, so a rollback is the same call the other way. Re-time kie through the gateway after applying.
-- fal is not routed for this offer: its 0.3500 exceeds the 18-credit floor, so it would need about 20 credits.
--
-- What this does, in order, so every database reaches one state:
--   1. puts kie first through the guarded model_route_reorder, where it is not already first (it re-checks parity and
--      breakers and copies the first route's supplier, endpoint and cost to the catalog row);
--   2. asserts the offer is served by kie at the unchanged 18 credits with Crun second.
--
-- Existing jobs keep their debit. Idempotent. Rollback: a forward migration with model_route_reorder (Crun first).

BEGIN;

DO $$
DECLARE res jsonb;
BEGIN
    IF EXISTS (SELECT 1 FROM public.model_catalog WHERE id = 'kling-2.6-pro-kie' AND provider <> 'kie') THEN
        SELECT public.model_route_reorder(
            'kling-2.6-pro-kie',
            (SELECT array_agg(id ORDER BY CASE supplier WHEN 'kie' THEN 0 ELSE 1 END, priority)
               FROM public.model_routes WHERE model_id = 'kling-2.6-pro-kie' AND state = 'active'),
            'kie first for Kling 2.6 Pro: Crun now 325-678 s, fal 135-254 s, kie 163 s once (0561)'
        ) INTO res;
        IF NOT COALESCE((res->>'ok')::boolean, false) THEN
            RAISE EXCEPTION 'Could not put kie first for kling-2.6-pro-kie: %', res;
        END IF;
    END IF;
END $$;

DO $$
DECLARE n BIGINT;
BEGIN
    SELECT count(*) INTO n FROM public.model_catalog c
     WHERE c.id = 'kling-2.6-pro-kie' AND c.provider = 'kie' AND c.provider_endpoint = 'market:kling-2.6/text-to-video'
       AND c.cost_unit = 'per_second' AND c.billing_seconds = 5 AND c.credits_5s = 18
       AND c.provider_cost_per_unit = (SELECT r.cost_per_unit FROM public.model_routes r
                                        WHERE r.model_id = c.id AND r.supplier = 'kie' AND r.endpoint = c.provider_endpoint);
    IF n <> 1 THEN
        RAISE EXCEPTION 'Expected kling-2.6-pro-kie served by kie at 18 credits, found % matching rows', n;
    END IF;
    SELECT count(*) INTO n FROM public.model_routes
     WHERE model_id = 'kling-2.6-pro-kie' AND state = 'active'
       AND ((priority = 1 AND supplier = 'kie' AND endpoint = 'market:kling-2.6/text-to-video')
         OR (priority = 2 AND supplier = 'crun' AND endpoint = 'crun:kling/v2-6'));
    IF n <> 2 THEN
        RAISE EXCEPTION 'Expected kie first and Crun second on kling-2.6-pro-kie, found % matching routes', n;
    END IF;
END $$;

COMMIT;
