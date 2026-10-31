-- Seedance 2.0 reference-to-video launches inactive (ADR-0309). Activation is a later migration after a
-- billed staging run proves the price. fal price read 2026-10-31: $0.3024/output second at 720p without
-- video input, $1.512 per 5-second unit. Floor = ceil(1.512 / 0.01796) = 85 credits; 10 seconds costs 170.
INSERT INTO public.model_catalog
  (id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,cost_unit,billing_seconds,gated_flag,active)
VALUES
  ('seedance-2.0-reference','Seedance 2.0 · Reference','fal','bytedance/seedance-2.0/reference-to-video',
   'image-to-video',85,1.5120,'per_second',5,false,false)
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
