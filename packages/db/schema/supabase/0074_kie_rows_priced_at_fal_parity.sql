-- kie.ai rows repriced to their fal twin's credit price (ADR-0020).
--
-- 0035 priced these rows at the ADR-0014 floor (ceil(cost / 0.0165)), which
-- would have handed kie's supplier discount straight to the user: a Veo 3.1
-- Fast clip drops from 46 credits to 19 for the same person. The saving is
-- ours to keep or to spend deliberately, not to give away as a side effect of
-- changing supplier. Credits now match the fal row, so a provider swap is
-- invisible in price and visible only in what the user gets:
--
--   row                fal twin        credits  kie cost  clip
--   veo-3.1-fast-kie   veo-3.1-fast         46    $0.30   8s 720p + audio
--   veo-3.1-kie        veo-3.1             122    $1.25   8s 720p + audio
--   nano-banana-kie    nano-banana           3    $0.02   one image
--
-- The fal twins are 4-second clips at $0.60 and $1.60 (migration 0067), so the
-- same credits buy twice the clip at a third to a half of the cost. Every row
-- stays above the ADR-0014 floor by a wide margin.
--
-- Rows stay INACTIVE. No kie endpoint has run a live generation (CLAUDE.md,
-- Money & billing; ADR-0011). Activation is a separate migration, after the
-- ADR-0020 checklist passes: secrets set, one live generation per row to
-- STORED, and kie's output host confirmed to serve bytes rather than a
-- redirect — copyUrlToR2 refuses redirects and would refund every job.
--
-- Not included: Veo 3.1 Lite ($0.15 per 8s 720p clip, a quarter of Fast).
-- VEO_MODELS in packages/adapters/kie.js allows only veo3_fast and veo3, so a
-- Lite row needs that allowlist widened first and is its own change.

UPDATE public.model_catalog
   SET credits_5s = 46,
       provider_cost_per_unit = 0.3000,
       active = false,
       updated_at = now()
 WHERE id = 'veo-3.1-fast-kie'
   AND provider = 'kie';

UPDATE public.model_catalog
   SET credits_5s = 122,
       provider_cost_per_unit = 1.2500,
       active = false,
       updated_at = now()
 WHERE id = 'veo-3.1-kie'
   AND provider = 'kie';

UPDATE public.model_catalog
   SET credits_5s = 3,
       provider_cost_per_unit = 0.0200,
       active = false,
       updated_at = now()
 WHERE id = 'nano-banana-kie'
   AND provider = 'kie';
