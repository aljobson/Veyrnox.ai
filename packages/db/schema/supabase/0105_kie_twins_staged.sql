-- Stage kie.ai twins of three fal rows, INACTIVE (ADR-0020).
--
-- kie's rate card (api.kie.ai/client/v1/model-pricing/page, read 2026-09-24)
-- lists each of these below the fal price we pay today. Credits are the
-- ADR-0014 floor, ceil(cost / 0.0165), as 0104 sets for the live kie rows.
--
--   row                 fal twin (credits, cost)  kie cost   credits
--   wan-2.5-kie         wan-2.5        31, $0.50   $0.30      19   720p, 5s (10s = 2x)
--   kling-2.6-pro-kie   kling-2.6-pro  22, $0.35   $0.275     17   audio off, 5s (10s = 2x)
--   nano-banana-pro-kie nano-banana-pro 10, $0.15  $0.09       6   2K (1K and 2K bill alike)
--
-- Every row is INACTIVE. CLAUDE.md (Money & billing): a model is only
-- `active = true` once its provider_endpoint has been verified against the
-- live provider. Run `node scripts/verify-kie-endpoints.mjs --submit --only=<id>`
-- with KIE_API_KEY set for each row, confirm kie's dashboard charged the cost
-- above (a wrong tier is a silent margin leak), then activate in a separate
-- migration, swapping the fal twin off as 0075 did for nano-banana.
--
-- Not staged: Nano Banana Pro Edit (the same kie model takes a reference image,
-- so it needs its own endpoint key), Kling 3.0 I2V (its fal row is inactive,
-- 0081), Hailuo 02 (its fal row's state is unsettled, 0015/0021), and the
-- audio rows (already under $0.02 a job).
--
-- Idempotent: ON CONFLICT DO NOTHING.

INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('wan-2.5-kie', 'Wan 2.5 (kie)', 'kie', 'market:wan/2-5-text-to-video', 'text-to-video', 19, 0.3000, 'per_second', 5, false, false),
    ('kling-2.6-pro-kie', 'Kling 2.6 Pro (kie)', 'kie', 'market:kling-2.6/text-to-video', 'text-to-video', 17, 0.2750, 'per_second', 5, false, false),
    ('nano-banana-pro-kie', 'Nano Banana Pro (kie)', 'kie', 'market:nano-banana-pro', 'text-to-image', 6, 0.0900, 'per_generation', NULL, false, false)
ON CONFLICT (id) DO NOTHING;
