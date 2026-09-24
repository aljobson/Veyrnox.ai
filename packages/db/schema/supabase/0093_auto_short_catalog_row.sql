-- Auto Short catalog row (ADR-0029, docs/auto-short/SPEC.md §3 and §8).
--
-- One row, one debit: 110 credits buys one 32-second vertical video (a
-- script, a voiceover, four Veo 3.1 Lite scenes and the stitch). The price
-- is the owner's decision of 2026-09-22 and keeps Veo Lite's
-- credits-per-dollar ratio (23 cr for $0.15). provider_cost_per_unit is the
-- whole chain as measured or quoted in slice 0: 4 x $0.15 scenes, ~$0.03
-- voice, ~$0.003 script, compose pending the fal dashboard; $0.70 is a
-- ceiling. ADR-0014 floor: ceil(0.70 / 0.0165) = 43 <= 110.
--
-- ACTIVE so the owner can run the first live short from the Create page.
-- The picker hides it from every browser without
-- localStorage.veyrnox_auto_short = '1' (slice 4), and nobody can buy credits
-- until a billing provider replaces LemonSqueezy, so in practice only
-- accounts already holding 110 credits can reach it. /api/catalog does list
-- it; a direct API call with a topic is a real, refundable purchase.
--
-- The capability record auto-short:v1 (provider 'veyrnox') is in
-- lib/modelCapabilities.js; the orchestrator is lib/autoShort.js.
-- Rollback is the mirror of this file (active = false), not an edit to it.

INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('auto-short-32s', 'Auto Short (32s)', 'veyrnox', 'auto-short:v1', 'text-to-video', 110, 0.7000, 'per_generation', NULL, false, true)
ON CONFLICT (id) DO NOTHING;
