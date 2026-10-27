-- 0402 — Motion-transfer offers, staged inactive (ADR-0269).
--
-- Two offers, priced per 5 s of output like every video row. The output is as
-- long as the template's own driving clip (5 s or 10 s, lib/motionClips.js), and
-- the server sets that length; the caller never sends one.
--
--   motion-transfer  Kling 3.0 Motion Control Standard on fal, 720p.
--                    fal endpointBilling read 2026-10-27: $0.126 per output second.
--                    5 x 0.126 = $0.63; ceil(0.63 / 0.01796) = 36 credits (0366 floor:
--                    63000 <= 36 x 1796 = 64656; 35 x 1796 = 62860 would breach).
--   motion-replace   Wan 2.2 Animate Replace on fal, pinned to 720p.
--                    fal lists $0.08 per output second, but the staging probe on
--                    2026-10-27 was billed 7.5 s ($0.60) for one 5 s clip (fal usage
--                    export). Recorded at the billed $0.60 per 5 s: 34 credits
--                    (60000 <= 34 x 1796 = 61064; 33 x 1796 = 59268 breaches).
--
-- Approved by the owner in chat on 2026-10-27: "Kling 3.0 Motion Control Std at 36
-- credits per 5 s, Wan Replace at 23 for phase 2, flags shipped off", then, after the
-- billed probe: "motion-replace at 34 credits per 5 s, recorded cost $0.60".
--
-- INACTIVE on purpose. Activation is a separate migration after the staging probes
-- (billed seconds read from fal's usage page, output host checked) and 24 h of clean
-- reconciliation. Even when active, the generation route refuses both offers unless
-- MOTION_TRANSFER_ENABLED / MOTION_REPLACE_ENABLED is "true".
--
-- Apply only through the owner-approved apply-migrations workflow.
INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('motion-transfer', 'Motion Transfer (photo follows a template clip)', 'fal',
     'fal-ai/kling-video/v3/standard/motion-control', 'image-to-video', 36, 0.6300, 'per_second', 5, false, false),
    ('motion-replace', 'Motion Replace (photo replaces the performer)', 'fal',
     'fal-ai/wan/v2.2-14b/animate/replace', 'image-to-video', 34, 0.6000, 'per_second', 5, false, false)
ON CONFLICT (id) DO NOTHING;

-- Fail loudly if either id already existed with other values (ON CONFLICT kept the old row).
DO $$
DECLARE drift TEXT;
BEGIN
    SELECT string_agg(id, ', ') INTO drift
      FROM public.model_catalog
     WHERE (id = 'motion-transfer' AND (provider IS DISTINCT FROM 'fal'
              OR provider_endpoint IS DISTINCT FROM 'fal-ai/kling-video/v3/standard/motion-control'
              OR modality IS DISTINCT FROM 'image-to-video' OR credits_5s IS DISTINCT FROM 36
              OR provider_cost_per_unit IS DISTINCT FROM 0.6300 OR cost_unit IS DISTINCT FROM 'per_second'
              OR billing_seconds IS DISTINCT FROM 5 OR gated_flag IS DISTINCT FROM false))
        OR (id = 'motion-replace' AND (provider IS DISTINCT FROM 'fal'
              OR provider_endpoint IS DISTINCT FROM 'fal-ai/wan/v2.2-14b/animate/replace'
              OR modality IS DISTINCT FROM 'image-to-video' OR credits_5s IS DISTINCT FROM 34
              OR provider_cost_per_unit IS DISTINCT FROM 0.6000 OR cost_unit IS DISTINCT FROM 'per_second'
              OR billing_seconds IS DISTINCT FROM 5 OR gated_flag IS DISTINCT FROM false));
    IF drift IS NOT NULL THEN
        RAISE EXCEPTION 'motion catalog rows drifted from 0402: %', drift;
    END IF;
    IF (SELECT count(*) FROM public.model_catalog WHERE id IN ('motion-transfer', 'motion-replace')) <> 2 THEN
        RAISE EXCEPTION 'Expected both motion catalog rows after 0402';
    END IF;
END $$;
