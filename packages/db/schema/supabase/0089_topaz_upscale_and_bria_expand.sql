-- Two image tools that bill by size, now that the gateway reads an upload's
-- pixel size (lib/uploadSource.js imageDimensions) and refuses a source over
-- the model's cap before the debit. Prices read from the fal model pages on
-- 2026-09-22. Credits at the 50% floor, $0.033 per credit: ceil(cost / 0.0165).
--
--   topaz-upscale  2x, source at most 6 MP, so output at most 24 MP:
--                  $0.08 tier                                      -> 5
--   bria-expand    $0.04 per generation at any size; canvas worked out
--                  from the source and the chosen aspect ratio     -> 3
--
-- A live generation of each runs straight after this applies; any that
-- fails is switched off by a follow-up migration.
INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('topaz-upscale', 'Topaz Upscale 2x (up to 6 MP)', 'fal', 'fal-ai/topaz/upscale/image', 'image-to-image', 5, 0.0800, 'per_generation', NULL, false, true),
    ('bria-expand', 'Bria Expand', 'fal', 'fal-ai/bria/expand', 'image-to-image', 3, 0.0400, 'per_generation', NULL, false, true)
ON CONFLICT (id) DO NOTHING;
