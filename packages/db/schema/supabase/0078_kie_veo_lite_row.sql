-- Veo 3.1 Lite on kie.ai, catalogued INACTIVE (ADR-0020).
--
-- kie sells three Veo 3.1 tiers per 8s 720p clip with audio (kie.ai/pricing,
-- 2026-09-18): Quality $1.25, Fast $0.30, Lite $0.15. Quality and Fast already
-- have rows (0035, repriced in 0074). Lite is new and has no fal twin, so it is
-- a new product at a new price point rather than a cheaper route to an
-- existing one: half the cost of Fast.
--
-- Credits: 23. There is no parity price to hold, so this keeps the same
-- credits-per-dollar ratio as veo-3.1-fast-kie (46 credits for $0.30). The
-- ADR-0014 floor at $0.15 is ceil(0.15 / 0.0165) = 10, so 23 clears it with
-- the same margin shape as Fast. The price is the owner's to change before
-- activation; nothing is sold at it until then.
--
-- Stays inactive until scripts/verify-kie-endpoints.mjs --only=veo-3.1-lite-kie
-- has returned a real clip from a tempfile.aiquickdraw.com URL with HTTP 200
-- and no redirect, and the dashboard shows it billed $0.15 (ADR-0011).
-- packages/adapters/kie.js accepts veo3_lite as of this change.

INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('veo-3.1-lite-kie', 'Veo 3.1 Lite', 'kie', 'veo:veo3_lite', 'text-to-video', 23, 0.1500, 'per_generation', NULL, false, false)
ON CONFLICT (id) DO NOTHING;
