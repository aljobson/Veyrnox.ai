-- Catalog rows for the kie.ai and OpenRouter providers (ADR-0018).
-- Every row lands INACTIVE: none is sold until its endpoint has run a live
-- generation end to end (CLAUDE.md, Money & billing).
--
-- Credits follow the 50% floor used across the catalog: at $0.033 per
-- credit, credits_5s = ceil(provider_cost / 0.0165).
--
--   veo-3.1-fast-kie  kie veo3_fast, one 8s 720p clip with audio  $0.30 -> 19
--   veo-3.1-kie       kie veo3,      one 8s 720p clip with audio  $1.25 -> 76 (gated, like veo-3.1)
--   nano-banana-kie   kie market google/nano-banana, one image    $0.02 ->  2
--
-- seedance-2.0-fast was switched off in 0029 because fal charged $1.21 per
-- 5s ("reactivate if we find a cheaper route"). OpenRouter sells the same
-- model at $0.4536 per 5s 720p, so the existing row moves provider and stays
-- inactive until verified: 28 credits instead of 74.

INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('veo-3.1-fast-kie', 'Veo 3.1 Fast (kie)', 'kie', 'veo:veo3_fast', 'text-to-video', 19, 0.3000, 'per_generation', NULL, false, false),
    ('veo-3.1-kie', 'Veo 3.1 (kie)', 'kie', 'veo:veo3', 'text-to-video', 76, 1.2500, 'per_generation', NULL, true, false),
    ('nano-banana-kie', 'Nano Banana (kie)', 'kie', 'market:google/nano-banana', 'text-to-image', 2, 0.0200, 'per_generation', NULL, false, false)
ON CONFLICT (id) DO NOTHING;

UPDATE public.model_catalog
   SET provider = 'openrouter',
       provider_endpoint = 'bytedance/seedance-2.0-fast',
       credits_5s = 28,
       provider_cost_per_unit = 0.4536,
       cost_unit = 'per_generation',
       billing_seconds = NULL,
       active = false,
       updated_at = now()
 WHERE id = 'seedance-2.0-fast'
   AND provider = 'fal';
