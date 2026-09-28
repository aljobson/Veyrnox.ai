-- Separate wholesale options (ADR-0020), not replacements for the fal routes.
-- KIE rate card checked 2026-09-28: dialogue $0.07/1000 chars; Flux $0.025/1K image.
-- No seed control. Dialogue uses James/Arabella/Bradford/Xavier stock voices.
-- Remain inactive until live output, billing, storage and completion/refund
-- verification pass. Replay never overrides later activation or repricing.
INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s,
     provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('elevenlabs-dialogue-kie', 'ElevenLabs Dialogue v3 (KIE voices, no seed)', 'kie',
     'market:elevenlabs/text-to-dialogue-v3', 'text-to-speech', 5, 0.0700, 'per_generation', NULL, false, false),
    ('flux-2-pro-1k-kie', 'Flux.2 Pro 1K (kie, no seed)', 'kie',
     'market:flux-2/pro-text-to-image', 'text-to-image', 2, 0.0250, 'per_generation', NULL, false, false)
ON CONFLICT (id) DO NOTHING;
