-- Add Sana beside FLUX, never as a replacement. ADR-0037.
-- fal's live OpenAPI schema verified 2026-09-24; public rate $0.01/MP.
-- Registry pins one 1024x768 PNG, 18 steps, safety on, async output.
-- Stage inactive until a real submit -> webhook -> R2 -> STORED generation,
-- billed charge and failure/refund are verified. No local FAL_KEY available.
-- At $129/3000 and assumed 8% + $0.30 payment fees, 1 credit leaves 68.5%
-- contribution before other operating costs. No quality-equivalence claim.
INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s,
     provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('sana-1.5-4.8b', 'Sana v1.5 4.8B', 'fal', 'fal-ai/sana/v1.5/4.8b',
     'text-to-image', 1, 0.0100, 'per_generation', NULL, false, false)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.model_catalog
        WHERE id = 'sana-1.5-4.8b' AND name = 'Sana v1.5 4.8B'
          AND provider = 'fal' AND provider_endpoint = 'fal-ai/sana/v1.5/4.8b'
          AND modality = 'text-to-image' AND credits_5s = 1
          AND provider_cost_per_unit = 0.0100 AND cost_unit = 'per_generation'
          AND billing_seconds IS NULL AND NOT gated_flag) THEN
        RAISE EXCEPTION 'Sana catalog identity, price or billed unit differs';
    END IF;
END $$;
