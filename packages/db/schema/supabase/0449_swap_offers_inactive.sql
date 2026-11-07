-- ADR-0329: two separate offers, inactive until paid billing and consent proof.
-- PROVISIONAL costs; evidence supplied/read 2026-11-07, not paid-billing verification.
-- fal llms.txt: https://fal.ai/models/fal-ai/minimax-h3-max-recast/llms.txt
-- Its worked example is about $2.40 / 10s = $0.24/s including reference tokens;
-- conflicting advertised rates ($0.08/s at 768p, $0.30/s, $3.49/run) need a billed run.
-- Crun publishes no price. Proxy: fal Wan Animate 720p at $0.005/frame x 24fps
-- https://fal.ai/models/fal-ai/wan/v2.2-14b/animate/replace => $0.12/s.
-- An owner Crun probe following scripts/probe-crun.mjs replaces this before activation.
-- lengths:null: ONE per_generation unit covers the ENTIRE accepted source up to 10s,
-- including shorter clips, like 0090 LatentSync. billing_seconds is NULL, not 10.
-- ceil(2.40/0.01796)=134; ceil(1.20/0.01796)=67 (ADR-0037 / 0366).
-- Repricing and activation require a later migration. No model_routes or flags.
-- Swap · Pro (swap-recast) activation and any repricing are BLOCKED until one billed
-- staging fal run is recorded: $0.30/s x 10s = $3.00 exceeds what 134 credits cover
-- at the 50% floor, so re-derive the price from the billed amount first.
-- Swap · Quick is likewise blocked until a Crun paid probe replaces its provisional cost.
INSERT INTO public.model_catalog
  (id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,cost_unit,billing_seconds,gated_flag,active)
VALUES
  ('swap-recast','Swap · Pro','fal','fal-ai/minimax-h3-max-recast',
   'video-to-video',134,2.4000,'per_generation',NULL,false,false),
  ('swap-quick','Swap · Quick','crun','crun:wan/2-2-animate-replace',
   'video-to-video',67,1.2000,'per_generation',NULL,false,false)
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

DO $$
BEGIN
  IF (SELECT count(*) FROM public.model_catalog
      WHERE id IN ('swap-recast','swap-quick') AND active = false AND gated_flag = false) <> 2 THEN
    RAISE EXCEPTION 'Swap offers must both exist and remain inactive';
  END IF;
END;
$$;
