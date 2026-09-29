-- Separate no-seed, one-reference 2K editing option (ADR-0020).
-- Supplier playground verified 2026-09-29: 1800 credits at $5/333000 =
-- $0.027027...; conservatively rounded to $0.0271, as for the text route.
-- Inactive until deployed gateway/poll/storage verification. Replay preserves
-- any later activation or repricing. The existing fal edit is unchanged.
INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s,
     provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('nano-banana-pro-edit-grsai', 'Nano Banana Pro Edit (GrsAI, no seed)', 'grsai',
     'grsai:nano-banana-pro-edit', 'image-to-image', 2, 0.0271,
     'per_generation', NULL, false, false)
ON CONFLICT (id) DO NOTHING;
