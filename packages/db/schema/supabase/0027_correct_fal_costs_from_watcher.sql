-- First run of scripts/check-fal-catalog.mjs found three recorded fal
-- costs that did not match fal's live model pages. All are per-second
-- video rates that had been recorded as if they were per-clip.
--
--   seedance-2.0-fast  recorded $0.45, real $0.2419/s = $1.2095 per 5s
--                      -> we were selling at -30.9% margin (a LOSS on
--                         every single generation)
--   kling-3.0-i2v      recorded $0.50, real $0.112/s  = $0.56 per 5s
--                      -> 45.3%, under the 50% floor
--   nano-banana        recorded $0.06, real $0.039 per image
--                      -> over-recorded; can drop 4cr -> 3cr and still
--                         hold 60.6%, cheaper for the user
--
-- Repriced to the 50% floor at $0.033/credit per ADR-0014.
BEGIN;
UPDATE public.model_catalog
   SET credits_5s = 74, provider_cost_per_unit = 1.2095, updated_at = now()
 WHERE id = 'seedance-2.0-fast';
UPDATE public.model_catalog
   SET credits_5s = 34, provider_cost_per_unit = 0.5600, updated_at = now()
 WHERE id = 'kling-3.0-i2v';
UPDATE public.model_catalog
   SET credits_5s = 3,  provider_cost_per_unit = 0.0390, updated_at = now()
 WHERE id = 'nano-banana';
COMMIT;
