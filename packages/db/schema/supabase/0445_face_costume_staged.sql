-- Costumes (A9): one Face Filter, `face-costume`, on fal's Nano Banana edit. INACTIVE.
-- The customer sends a style only; the wording is ours (lib/costumePrompts.js).
--
--   face-costume   A9   fal-ai/nano-banana/edit   about $0.039 per image -> 3 credits
--
-- The price is NOT read from fal's model page (it lists none). 0.0390 is the figure
-- fal has published for Nano Banana; confirm it from the staging bill before any
-- activation. Credits are the ADR-0014 floor, ceil(0.039 / 0.0165) = 3.
--
-- CLAUDE.md (Money & billing): a model is only `active = true` once its
-- provider_endpoint has been verified against the live provider. Before activation,
-- on staging: run one job per style on a face photo, read fal's billed cost, check
-- the output and the refund path, then activate in a separate migration. The
-- upload-admission seam (lib/uploadAdmission.js) applies as for A1-A5.
--
-- Idempotent: ON CONFLICT DO NOTHING. Replay preserves any later activation or
-- repricing. This file changes no existing row, so no row-count assertion applies.

INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('face-costume', 'Costumes', 'fal', 'fal-ai/nano-banana/edit', 'image-to-image', 3, 0.0390, 'per_generation', NULL, false, false)
ON CONFLICT (id) DO NOTHING;
