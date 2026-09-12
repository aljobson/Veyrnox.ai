-- ADR-0014: price every model at the 50% margin floor ($0.033/credit
-- reference) and add Veo 3.1 Fast. Al: "most cost-effective solution".
BEGIN;
UPDATE public.model_catalog SET credits_5s = 16,  updated_at = now() WHERE id = 'wan-2.5';
UPDATE public.model_catalog SET credits_5s = 28,  updated_at = now() WHERE id = 'seedance-2.0-fast';
UPDATE public.model_catalog SET credits_5s = 22,  updated_at = now() WHERE id = 'kling-2.6-pro';
UPDATE public.model_catalog SET credits_5s = 31,  updated_at = now() WHERE id = 'kling-3.0-i2v';
UPDATE public.model_catalog SET credits_5s = 19,  updated_at = now() WHERE id = 'minimax-h3';
UPDATE public.model_catalog SET credits_5s = 122, updated_at = now() WHERE id = 'veo-3.1';
UPDATE public.model_catalog SET credits_5s = 2,   updated_at = now() WHERE id = 'flux-2-pro';
UPDATE public.model_catalog SET credits_5s = 3,   updated_at = now() WHERE id = 'seedream-4';
UPDATE public.model_catalog SET credits_5s = 4,   updated_at = now() WHERE id = 'nano-banana';
UPDATE public.model_catalog SET credits_5s = 1,   updated_at = now() WHERE id = 'ace-step';
INSERT INTO public.model_catalog (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, gated_flag, active)
VALUES ('veo-3.1-fast', 'Veo 3.1 Fast', 'fal', 'fal-ai/veo3.1/fast', 'text-to-video', 46, 0.75, false, true)
ON CONFLICT (id) DO UPDATE SET provider_endpoint = EXCLUDED.provider_endpoint, credits_5s = EXCLUDED.credits_5s,
  provider_cost_per_unit = EXCLUDED.provider_cost_per_unit, active = true, updated_at = now();
COMMIT;
