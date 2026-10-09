-- The fal model the video agent buys its clips from, on the books (ADR-0074, production gate G4).
--
-- The runner's agent calls fal-ai/kling-video/v3/standard/text-to-video itself, with its own key, behind the
-- spend meter. ADR-0074 lets v1 call only models recorded in model_catalog under terms the owner accepted, and
-- the owner's 2026-10-08 allowance for this one ended at staging: "added to model_catalog through the usual
-- route before any user can reach it". Accepted by the owner on 2026-10-09 ("go with recommendation").
--
-- Verified against the live provider: seven videos were made through this endpoint on staging (2026-10-08/09).
-- Cost from fal's bill, read 2026-10-09: 153 s at $0.14 a second. Recorded like the other Kling rows
-- (per_second, billing_seconds 5): 5 x 0.14 = $0.70, and ceil(0.70 / 0.0165) = 43 credits at the ADR-0014
-- floor. fal's model page marks it "Commercial use" and carries no preview label (read 2026-10-09).
--
-- INACTIVE on purpose: this is a record, not a product. Nobody can pick or buy it; a user reaches the model
-- only through the `video-agent` row, whose price already carries its cost. Selling it directly would be a
-- separate decision and its own migration.
INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('kling-3.0-standard-t2v', 'Kling 3.0 Standard (text-to-video)', 'fal', 'fal-ai/kling-video/v3/standard/text-to-video', 'text-to-video', 43, 0.7000, 'per_second', 5, false, false)
ON CONFLICT (id) DO NOTHING;
