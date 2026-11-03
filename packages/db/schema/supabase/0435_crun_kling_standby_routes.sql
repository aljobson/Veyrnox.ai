-- 0435 — Crun standby routes for the two Kling offers (ADR-0256, phase 5).
--
--   offer               Crun model   Crun credits        recorded cost  today's route
--   kling-3.0-i2v-kie   kling/v3     18 a second x 5     $0.4369        kie $0.5050
--   kling-2.6-pro-kie   kling/v2-6   55 a 5 s clip       $0.2670        kie $0.3150
--
-- Both are the pro, audio-off, single-shot tier the kie rows are costed at. Credits are from Crun's price page read
-- 2026-11-03 (Kling 3.0 no audio 1080P, Kling 2.6 pro no audio 5 s). Cost is credits at the owner's real top-up
-- rate of 206 Crun credits per $1 (the $50 plan), so 90 / 206 = $0.4369 and 55 / 206 = $0.2670. The $1,250 plan
-- (224 per $1) would be about 8% lower; the lower rate is not assumed.
--
-- Same unit as the kie rows: per_second over a 5 s unit, so a 10 s clip costs twice. The two Kling 3.0 and 2.6 sound
-- tiers are not routed: Crun bills sound at 1.5x (3.0) and 2x (2.6), and the adapter pins audio off.
--
-- Priority 2, `standby`, no parity record: chooseRoute never picks one. They exist so the sweep and the failover
-- know the routes, and so a paid probe can attach evidence. Activating one, putting it first or cutting the offer's
-- price are separate migrations after a probe and the owner's word.
--
-- Idempotent: ON CONFLICT DO NOTHING. Rollback: DELETE the two rows.

BEGIN;

INSERT INTO public.model_routes
    (model_id, supplier, endpoint, cost_per_unit, cost_unit, billing_seconds, priority, state, provenance)
SELECT v.model_id, 'crun', v.endpoint, v.cost, 'per_second', 5, 2, 'standby', 'licensed_reseller'
  FROM (VALUES
        ('kling-3.0-i2v-kie', 'crun:kling/v3',   0.4369::numeric),
        ('kling-2.6-pro-kie', 'crun:kling/v2-6', 0.2670::numeric)
       ) AS v(model_id, endpoint, cost)
  JOIN public.model_catalog c ON c.id = v.model_id
 -- Skip an offer that already has this route or a priority-2 route. model_routes_max_three (0374) is a BEFORE
 -- INSERT trigger and raises before ON CONFLICT can act once an offer has three routes, so a replay must not
 -- attempt the insert. A priority-2 slot taken by another supplier is left alone and the assertion below rejects it.
 WHERE NOT EXISTS (SELECT 1 FROM public.model_routes r
                    WHERE r.model_id = v.model_id
                      AND (r.priority = 2 OR (r.supplier = 'crun' AND r.endpoint = v.endpoint)))
ON CONFLICT (model_id, priority) DO NOTHING;

DO $$
DECLARE n BIGINT;
BEGIN
    SELECT count(*) INTO n FROM public.model_routes
     WHERE supplier = 'crun' AND cost_unit = 'per_second' AND billing_seconds = 5
       AND endpoint IN ('crun:kling/v3', 'crun:kling/v2-6');
    IF n <> 2 THEN
        RAISE EXCEPTION 'Expected two Crun Kling standby routes, found %', n;
    END IF;
END $$;

COMMIT;
