-- 0369 — Crun as a known supplier, and four standby routes (ADR-0256, phase 5).
--
-- Adds 'crun' to the supplier list on model_routes, then records four routes
-- as `standby`, priority 2, provenance `unverified`, with no parity record:
--
--   offer                 Crun model                       recorded cost   today's route
--   veo-3.1-lite-kie      google/veo3-1-lite-t2v           $0.0670 (15 cr)    kie  $0.15
--   veo-3.1-fast-kie      google/veo3-1-fast-t2v           $0.1339 (30 cr)    kie  $0.30
--   veo-3.1-kie           google/veo3-1-t2v                $1.0045 (225 cr)   kie  $1.25
--   seedance-2.0-fast     bytedance/seedance2-0-fast-t2v   $0.2902 (65 cr)    OpenRouter $0.4536
--
-- Costs are Crun's published credits at its top tier (224 credits per $1,
-- crun.ai pricing, read 2026-10-23), not invoices. A standby route is never
-- chosen: chooseRoute needs state `active` and a parity record, and nothing
-- reads model_routes yet. Activating one needs Crun's written answers on
-- resale and upstream supply, a paid parity probe, and the owner's approval.
--
-- Idempotent: constraint dropped and re-added, ON CONFLICT DO NOTHING.
-- Rollback: DELETE the four rows; the wider supplier list is harmless.

BEGIN;

ALTER TABLE public.model_routes DROP CONSTRAINT IF EXISTS model_routes_supplier_check;
ALTER TABLE public.model_routes ADD CONSTRAINT model_routes_supplier_check
    CHECK (supplier IN ('fal', 'kie', 'grsai', 'byteplus', 'openrouter', 'crun'));

INSERT INTO public.model_routes
    (model_id, supplier, endpoint, cost_per_unit, cost_unit, priority, state, provenance)
SELECT v.model_id, 'crun', v.endpoint, v.cost, 'per_generation', 2, 'standby', 'unverified'
  FROM (VALUES
        ('veo-3.1-lite-kie', 'crun:google/veo3-1-lite-t2v', 0.0670::numeric),
        ('veo-3.1-fast-kie', 'crun:google/veo3-1-fast-t2v', 0.1339::numeric),
        ('veo-3.1-kie', 'crun:google/veo3-1-t2v', 1.0045::numeric),
        ('seedance-2.0-fast', 'crun:bytedance/seedance2-0-fast-t2v', 0.2902::numeric)
       ) AS v(model_id, endpoint, cost)
  JOIN public.model_catalog c ON c.id = v.model_id AND c.active
ON CONFLICT (model_id, priority) DO NOTHING;

DO $$
DECLARE n BIGINT;
BEGIN
    SELECT count(*) INTO n FROM public.model_routes WHERE supplier = 'crun' AND state = 'standby' AND provenance = 'unverified';
    IF n <> 4 THEN
        RAISE EXCEPTION 'Expected four Crun standby routes, found %', n;
    END IF;
END $$;

COMMIT;
