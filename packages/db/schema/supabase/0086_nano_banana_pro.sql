-- Nano Banana Pro on fal (upstream review, 2026-09-22). Price read from the
-- fal model page on 2026-09-22: $0.15 per image, 4K and web search extra.
-- The capability record (lib/modelCapabilities.js) pins resolution 2K, one
-- image and web search off, so every request bills the $0.15 rate.
-- Credits at the 50% floor, $0.033 per credit: ceil(0.15 / 0.0165) = 10.
--
--   nano-banana-pro        text to image              active
--   nano-banana-pro-edit   one reference image + text INACTIVE until the
--                          create page can upload a source image
--
-- A live generation of nano-banana-pro runs straight after this applies; if it
-- fails, a follow-up migration switches it off.
INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('nano-banana-pro', 'Nano Banana Pro', 'fal', 'fal-ai/nano-banana-pro', 'text-to-image', 10, 0.1500, 'per_generation', NULL, false, true),
    ('nano-banana-pro-edit', 'Nano Banana Pro Edit', 'fal', 'fal-ai/nano-banana-pro/edit', 'image-to-image', 10, 0.1500, 'per_generation', NULL, false, false)
ON CONFLICT (id) DO NOTHING;
