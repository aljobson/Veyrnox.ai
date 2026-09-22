-- Lip sync on fal, prices agreed by the owner in chat 2026-09-22. Both bill
-- by output seconds; the gateway reads each upload's length from its headers
-- (lib/mediaLength.js) and refuses one over the model's cap before the debit
-- (ADR-0028). Credits at the 50% floor, $0.033 per credit: ceil(cost / 0.0165).
--
--   latentsync          video + speech, each at most 40s:
--                       $0.20 flat up to 40s of output          -> 13
--   kling-avatar-v2     photo + speech at most 10s:
--                       $0.0562/s x 10s = $0.562                -> 35
--                       (34 was quoted in chat; 34 x $0.0165 = $0.561 is
--                       a hair under the floor, so it is 35)
--
-- A live generation of each runs straight after this applies; any that
-- fails is switched off by a follow-up migration.
INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('latentsync', 'LatentSync lip sync (video + speech, up to 40s)', 'fal', 'fal-ai/latentsync', 'video-to-video', 13, 0.2000, 'per_generation', NULL, false, true),
    ('kling-avatar-v2', 'Kling AI Avatar v2 (photo + speech, up to 10s)', 'fal', 'fal-ai/kling-video/ai-avatar/v2/standard', 'image-to-video', 35, 0.5620, 'per_generation', NULL, false, true)
ON CONFLICT (id) DO NOTHING;
