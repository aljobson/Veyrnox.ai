-- Kling O1 reference launches inactive. Activation is a later migration after
-- the host-run staging proof in ADR-0301, including billing and refund evidence.
-- fal price read 2026-10-29: $0.168/output second, $0.84 per 5-second unit.
-- The standing floor is ceil(0.84 / 0.01796) = 47 credits; 10 seconds costs 94.
INSERT INTO public.model_catalog
  (id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,cost_unit,billing_seconds,gated_flag,active)
VALUES
  ('kling-o1-reference','Kling O1 · Reference','fal','fal-ai/kling-video/o1/video-to-video/reference',
   'video-to-video',47,0.8400,'per_second',5,false,false)
ON CONFLICT (id) DO UPDATE SET
  name=EXCLUDED.name,
  provider=EXCLUDED.provider,
  provider_endpoint=EXCLUDED.provider_endpoint,
  modality=EXCLUDED.modality,
  credits_5s=EXCLUDED.credits_5s,
  provider_cost_per_unit=EXCLUDED.provider_cost_per_unit,
  cost_unit=EXCLUDED.cost_unit,
  billing_seconds=EXCLUDED.billing_seconds,
  gated_flag=EXCLUDED.gated_flag,
  active=EXCLUDED.active;
