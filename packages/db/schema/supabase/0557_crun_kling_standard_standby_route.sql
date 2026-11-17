-- 0557 — Crun standby route for the Kling 3.0 Standard (720p) image-to-video offer (ADR-0256 phase 5, ADR-0350).
--
--   offer                    Crun endpoint       Crun credits     recorded cost   fal today
--   kling-3.0-standard-i2v   crun:kling/v3-std   14 a second x 5  $0.3398         $0.4200 (0.084 a second x 5)
--
-- `crun:kling/v3-std` is the adapter's name for Crun's `kling/v3` at `mode: "std"` (720p); `crun:kling/v3` stays
-- `mode: "pro"` (1080p). Credits are from Crun's price page (Kling 3.0, no audio, 720p, read 2026-11-17) at the
-- owner's real top-up rate of 206 Crun credits per $1 (the $50 plan), so 70 / 206 = $0.3398. The same page prices
-- the $1,250 plan (224 per $1) about 8% lower; the lower rate is not assumed.
--
-- Priority 2, `standby`, no parity record: chooseRoute never picks it. The offer itself is inactive (0556) and has no
-- priority-1 route yet, so activating the offer is a later migration that adds its fal route too. Nothing here
-- activates a route, reorders routes or changes a price: a paid Crun probe and the owner's word come first.
--
-- Idempotent: the insert is skipped when the offer already has this route or a priority-2 route (the 0374 trigger
-- raises before ON CONFLICT can act once an offer has three routes). Rollback: DELETE the one row.

BEGIN;

INSERT INTO public.model_routes
    (model_id, supplier, endpoint, cost_per_unit, cost_unit, billing_seconds, priority, state, provenance)
SELECT v.model_id, 'crun', v.endpoint, v.cost, 'per_second', 5, 2, 'standby', 'licensed_reseller'
  FROM (VALUES
        ('kling-3.0-standard-i2v', 'crun:kling/v3-std', 0.3398::numeric)
       ) AS v(model_id, endpoint, cost)
  JOIN public.model_catalog c ON c.id = v.model_id
 WHERE NOT EXISTS (SELECT 1 FROM public.model_routes r
                    WHERE r.model_id = v.model_id
                      AND (r.priority = 2 OR (r.supplier = 'crun' AND r.endpoint = v.endpoint)))
ON CONFLICT (model_id, priority) DO NOTHING;

DO $$
DECLARE n BIGINT;
BEGIN
    SELECT count(*) INTO n FROM public.model_routes
     WHERE supplier = 'crun' AND cost_unit = 'per_second' AND billing_seconds = 5
       AND model_id = 'kling-3.0-standard-i2v' AND endpoint = 'crun:kling/v3-std';
    IF n <> 1 THEN
        RAISE EXCEPTION 'Expected one Crun Kling Standard standby route, found %', n;
    END IF;
END $$;

COMMIT;
