-- Stage the verified GrsAI Nano Banana Pro 2K route INACTIVE (ADR-0020).
-- 2026-09-24 live task: 15-e87e0b94-981a-4f63-8c1d-ce511920333d.
-- Observed: 2048x2048 PNG, 41s, 1800 GrsAI credits charged.
-- The owner's $5 / 333000-credit pack costs $0.027027... per image.
-- Round UP to $0.0271 for the NUMERIC(10,4) cost column; the ADR-0014
-- floor is ceil(0.0271 / 0.0165) = 2 Veyrnox credits. No bulk discount assumed.
-- This neither activates GrsAI nor changes the existing kie/fal rows.
-- Activate separately after the deployed gateway -> polling -> R2 path is
-- verified, GRSAI_API_KEY is provisioned and the owner approves the workflow.
INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s,
     provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('nano-banana-pro-grsai', 'Nano Banana Pro (GrsAI)', 'grsai',
     'grsai:nano-banana-pro', 'text-to-image', 2, 0.0271,
     'per_generation', NULL, false, false)
ON CONFLICT (id) DO NOTHING;
