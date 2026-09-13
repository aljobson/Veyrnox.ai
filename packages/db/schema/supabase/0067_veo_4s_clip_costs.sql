-- Applied name: 0067_veo_4s_clip_costs.
-- Merged as 0066 in #153, which duplicated 0066_freeze_since_purchase (#152,
-- already applied to production); renumbered before it was applied.
-- Veo 3.1 on fal now requests 4-second 720p clips with audio (owner decision
-- 2026-09-13, option c). fal defaulted to 8s, so the recorded per-clip costs
-- ($0.75 / $2.00) were below what fal billed ($1.20 / $3.20), leaving both
-- rows at ~21% margin. Prices stay; costs now match the 4s request:
--   veo-3.1-fast  $0.15/s x 4s = $0.60  -> 46 credits ($1.52) ~60% margin
--   veo-3.1       $0.40/s x 4s = $1.60  -> 122 credits ($4.03) ~60% margin
-- cost_unit per_second / billing_seconds 4 lets the fal catalog watcher
-- compare the page's per-second rate. Apply only after the 4s request code
-- (lib/providerDuration.js VEO_SHAPE) is deployed.
UPDATE public.model_catalog
   SET name = 'Veo 3.1 Fast (4s)',
       provider_cost_per_unit = 0.6000,
       cost_unit = 'per_second',
       billing_seconds = 4,
       updated_at = now()
 WHERE id = 'veo-3.1-fast' AND provider = 'fal';

UPDATE public.model_catalog
   SET name = 'Veo 3.1 (4s)',
       provider_cost_per_unit = 1.6000,
       cost_unit = 'per_second',
       billing_seconds = 4,
       updated_at = now()
 WHERE id = 'veo-3.1' AND provider = 'fal';
