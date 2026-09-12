-- Applied to Supabase on 2026-09-12 under the name
-- `0022_cost_unit_and_deactivate_seedance` (version 20260912145610).
-- Renumbered to 0029 to match real apply order after two sessions
-- collided on 0018-0022; see scripts/check-migration-numbers.sh.
--
-- Two changes.
--
-- 1. Record the UNIT of provider_cost_per_unit. Migration 0021 fixed
--    three rows whose per-second video rates had been stored as if they
--    were per-clip; seedance-2.0-fast sold at -30.9% (a loss) until the
--    watcher caught it. Storing the unit lets scripts/check-fal-catalog.mjs
--    multiply correctly and fail the build instead of filing a soft note.
--
--    cost_unit: 'per_generation' (images, audio, per-clip video)
--               'per_second'     (multiply by billing_seconds)
--    billing_seconds: the clip length credits_5s is priced for (5s).
--
--    provider_cost_per_unit stays the TOTAL cost for one generation, so
--    nothing downstream changes; the new columns describe how fal bills,
--    which is what the watcher needs to compare like for like.
--
-- 2. Deactivate seedance-2.0-fast. fal charges $0.2419/s ($1.21 per 5s);
--    at the 50% floor that is 74 credits / $2.44, roughly 4x the market
--    rate for the same model. Honest pricing makes it unsellable, so it
--    comes off the shelf rather than misleading anyone. Al's call
--    2026-09-12. Reactivate if we find a cheaper route.

ALTER TABLE public.model_catalog
    ADD COLUMN IF NOT EXISTS cost_unit TEXT NOT NULL DEFAULT 'per_generation',
    ADD COLUMN IF NOT EXISTS billing_seconds NUMERIC(6,2) NULL;

ALTER TABLE public.model_catalog
    DROP CONSTRAINT IF EXISTS model_catalog_cost_unit_check;
ALTER TABLE public.model_catalog
    ADD CONSTRAINT model_catalog_cost_unit_check
    CHECK (cost_unit IN ('per_generation', 'per_second'));

UPDATE public.model_catalog SET cost_unit = 'per_second', billing_seconds = 5
 WHERE id IN ('wan-2.5','kling-2.6-pro','kling-3.0-i2v','minimax-hailuo-02','seedance-2.0-fast');

UPDATE public.model_catalog SET cost_unit = 'per_generation', billing_seconds = NULL
 WHERE id IN ('nano-banana','flux-2-pro','seedream-4','ace-step','veo-3.1','veo-3.1-fast');

UPDATE public.model_catalog
   SET active = false, updated_at = now()
 WHERE id = 'seedance-2.0-fast';
