-- Five Face Filter rows on fal (docs/face-filters/PRD.md, A1-A5), all INACTIVE.
-- Prices are fal's list prices read from each model page on 2026-10-20.
-- Credits are the ADR-0014 floor, ceil(cost / 0.0165).
--
--   face-retouch   A1  fal-ai/image-editing/retouch                   $0.04 per image   -> 3
--   face-enhance   A2  fal-ai/image-editing/face-enhancement          $0.04 per image   -> 3
--   face-relight   A3  fal-ai/iclight-v2                              $0.10 per output
--                      megapixel; the canvas is pinned at 1000x1000
--                      (1 MP) and one image, so one job is $0.10       -> 7
--   face-makeup    A4  fal-ai/image-apps-v2/makeup-application        $0.04 per image   -> 3
--   face-age       A5  fal-ai/image-apps-v2/age-modify                $0.04 per image   -> 3
--
-- Not staged here:
--   A6 video relight  never run (Slice 0), costs $0.10-$0.20 per second, and the
--                     Light-X inputs are conditional. Needs a real clip first.
--   A7 / A8           blocked by PRD section 6 (consent, output moderation,
--                     takedown route, retention, published statement).
--
-- All five are INACTIVE. CLAUDE.md (Money & billing): a model is only
-- `active = true` once its provider_endpoint has been verified against the live
-- provider. Slice 0 returned real output for each of these endpoints, but no
-- billed cost has been read. Before activation, on staging: run one job of each,
-- confirm fal's usage page billed the figures above (A3 may round megapixels up
-- to a whole tier; A4 and A5 default to a 4K output ratio nobody has looked at),
-- add the endpoint to BASE_PRICES in scripts/lib/fal-unit-rates.mjs, then
-- activate in a separate migration. Upload hash matching (lib/uploadAdmission.js)
-- must be enrolled and enforced before any of these opens to the public: each
-- one starts from a user's own file.
--
-- The capability records (what each takes, what is pinned) are in
-- lib/additionalModelCapabilities.js. A5 cannot be asked for an age under 18.
--
-- Idempotent: ON CONFLICT DO NOTHING. Replay preserves any later activation
-- or repricing.

INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('face-retouch', 'Skin retouch', 'fal', 'fal-ai/image-editing/retouch', 'image-to-image', 3, 0.0400, 'per_generation', NULL, false, false),
    ('face-enhance', 'Face enhancement', 'fal', 'fal-ai/image-editing/face-enhancement', 'image-to-image', 3, 0.0400, 'per_generation', NULL, false, false),
    ('face-relight', 'Relight (image)', 'fal', 'fal-ai/iclight-v2', 'image-to-image', 7, 0.1000, 'per_generation', NULL, false, false),
    ('face-makeup', 'Digital makeup', 'fal', 'fal-ai/image-apps-v2/makeup-application', 'image-to-image', 3, 0.0400, 'per_generation', NULL, false, false),
    ('face-age', 'Age modify', 'fal', 'fal-ai/image-apps-v2/age-modify', 'image-to-image', 3, 0.0400, 'per_generation', NULL, false, false)
ON CONFLICT (id) DO NOTHING;
