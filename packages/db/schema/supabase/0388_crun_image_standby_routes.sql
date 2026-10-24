-- 0388 — Crun standby routes for two image offers (ADR-0256, phase 5).
--
--   offer             Crun model               recorded cost            today's route
--   nano-banana-kie   google/nano-banana       $0.0146 (3 Crun credits)  kie $0.0200
--   seedream-4        bytedance/seedream-4     $0.0146 (3 Crun credits)  fal $0.0300
--
-- Cost is 3 Crun credits at the owner's real top-up rate (206 credits per $1, so $0.00485 each), from the
-- Crun price pages read 2026-10-23. Crun also lists a 1.8-credit Nano Banana variant; which model that is
-- was not established, so it is not used. Seedream's price page names no resolution; the adapter pins 2K,
-- the size the fal row renders, and the first paid probe confirms the charge.
--
-- Priority 2, `standby`, no parity record: chooseRoute never picks one. They exist so the sweep and the
-- failover know the routes, and so a probe can attach evidence. Activating one, putting it first or
-- cutting the offer's price are separate migrations after a paid probe and the owner's word.
--
-- Idempotent: ON CONFLICT DO NOTHING. Rollback: DELETE the two rows.

BEGIN;

INSERT INTO public.model_routes
    (model_id, supplier, endpoint, cost_per_unit, cost_unit, priority, state, provenance)
SELECT v.model_id, 'crun', v.endpoint, 0.0146::numeric, 'per_generation', 2, 'standby', 'licensed_reseller'
  FROM (VALUES
        ('nano-banana-kie', 'crun:google/nano-banana'),
        ('seedream-4', 'crun:bytedance/seedream-4')
       ) AS v(model_id, endpoint)
  JOIN public.model_catalog c ON c.id = v.model_id AND c.active
ON CONFLICT (model_id, priority) DO NOTHING;

DO $$
DECLARE n BIGINT;
BEGIN
    SELECT count(*) INTO n FROM public.model_routes
     WHERE supplier = 'crun' AND state = 'standby' AND endpoint IN ('crun:google/nano-banana', 'crun:bytedance/seedream-4');
    IF n <> 2 THEN
        RAISE EXCEPTION 'Expected two Crun image standby routes, found %', n;
    END IF;
END $$;

COMMIT;
