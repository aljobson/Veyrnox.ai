-- 0556 — Kling 3.0 Standard image-to-video, staged INACTIVE (ADR-0350).
--
-- A faster, lower-resolution route for the same job as kling-3.0-i2v (Pro). fal's Standard endpoint
-- takes the same fields as Pro. Staging probe 2026-11-17, same 10 s image-to-video clip, audio off:
--   Standard  113 s and 136 s render, 1172x784 output
--   Pro       260 s render,           1760x1176 output
-- (a production Pro run of the same length took 475 s). Pro stays the default; nothing here changes it.
--
-- Cost: fal's model page, read 2026-11-17: $0.084 per second audio off ($0.126 audio on). The gateway pins
-- audio off. 5 s unit: 5 x 0.084 = $0.42, and ceil(0.42 / 0.01796) = 24 credits at the ADR-0037 floor
-- (10 s costs 48 through the existing duration multiplier). fal's billing object lists base price 0.14 for
-- this endpoint, as it does for Pro (billed $0.112 audio off), so the page sentence is the source.
--
-- INACTIVE on purpose: the figure above comes from the page, not from fal's bill. The owner reads the bill for
-- fal request ids 01a1e8f2-7f17-7f70-94a8-3debfa373c9c and 01a1e8f0-4540-7ff3-a634-e0605e3c2bb2 (both Standard,
-- 10 s) and, if it shows $0.84 each, activates with a one-line migration setting active = true.
--
-- Idempotent: the insert skips an existing row; a replay never reprices or reactivates a later edit.
-- Rollback: DELETE the row while it is inactive and unused.
BEGIN;

INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('kling-3.0-standard-i2v', 'Kling 3.0 Standard · I2V', 'fal', 'fal-ai/kling-video/v3/standard/image-to-video',
     'image-to-video', 24, 0.4200, 'per_second', 5, false, false)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE r public.model_catalog%ROWTYPE;
BEGIN
    SELECT * INTO r FROM public.model_catalog WHERE id = 'kling-3.0-standard-i2v';
    IF NOT FOUND OR r.provider IS DISTINCT FROM 'fal'
       OR r.provider_endpoint IS DISTINCT FROM 'fal-ai/kling-video/v3/standard/image-to-video'
       OR r.modality IS DISTINCT FROM 'image-to-video'
       OR r.provider_cost_per_unit IS DISTINCT FROM 0.4200
       OR r.cost_unit IS DISTINCT FROM 'per_second' OR r.billing_seconds IS DISTINCT FROM 5
       OR r.credits_5s < CEIL(0.42 / 0.01796) THEN
        RAISE EXCEPTION 'kling-3.0-standard-i2v is missing or does not match its recorded identity and floor price';
    END IF;
END $$;

COMMIT;
