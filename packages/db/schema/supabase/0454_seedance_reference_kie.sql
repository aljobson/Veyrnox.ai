-- ADR-0333: INACTIVE until a billed staging probe verifies price and real-person references.
-- PROVISIONAL, UNVERIFIED: ~10 billed seconds x ~$0.125 = $1.25.
-- ceil(1.25 / 0.01796) = 70 credits; catalog price is normative.
-- Includes <=5.05s reference plus 5s output; replace via a new migration before activation.
-- @Video1/@Image1 prompt tokens are UNVERIFIED for kie. Confirm in the owner probe.
-- If different tokens are required, add a per-model prompt in kie shaping; do not edit fal's prompt.
-- Replay preserves any existing price/cost and active state; later migrations own those changes.
-- The catalog UPDATE guard permits this insert-only DO NOTHING pattern (no catalog UPDATE).
INSERT INTO public.model_catalog
  (id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,cost_unit,billing_seconds,gated_flag,active)
VALUES
  ('seedance-2.0-reference-kie','Seedance 2.0 · Reference · kie','kie','market:bytedance/seedance-2',
   'image-to-video',70,1.2500,'per_second',5,false,false)
ON CONFLICT (id) DO NOTHING;
