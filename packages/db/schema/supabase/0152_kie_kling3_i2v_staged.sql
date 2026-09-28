-- Separate candidate, not a swap: kie does not document negative_prompt.
-- First/last-frame i2v, mode=pro (1080p), sound=false, multi_shots=false.
-- Retained kie quote: $0.09/second, $0.45/5s and $0.90/10s.
-- 28 credits gives headroom above the 26-credit floor at $0.01796 provider
-- allowance per credit (largest $129/3000 pack, 8% + $0.30 fee, 50% target).
-- Stay inactive until output, billed cost and gateway completion/refund are
-- verified. The current fal route and its negative-prompt control stay active.
-- Replay must not overwrite a future activation or repricing.
INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('kling-3.0-i2v-kie', 'Kling 3.0 Pro I2V (kie, no audio)', 'kie', 'market:kling-3.0/video', 'image-to-video', 28, 0.4500, 'per_second', 5, false, false)
ON CONFLICT (id) DO NOTHING;
