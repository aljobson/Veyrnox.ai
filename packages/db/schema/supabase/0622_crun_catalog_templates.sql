-- CRUN's live Kling, ByteDance/Seedance and Vidu effect catalogues become customer-runnable.
-- The catalogue response is the quote source. Supplier Credits are converted at the owner's paid
-- rate (206 CRUN credits / USD), then rounded up to the standing 50% margin floor ($0.01796 cost
-- per Veyrnox Credit). The Worker persists the server-validated quote in catalog_template_billing;
-- the spend trigger re-derives both cost and customer charge before the debit can commit.
-- Maximum catalogue costs observed 2026-11-27: Kling 376.32, Seedance 625.3, Vidu 276 CRUN credits.
-- The rows are private dispatch identities: /api/catalog hides them and clients enter through the
-- authenticated catalog-template admission path. Rollback: a forward migration setting active=false.
BEGIN;

INSERT INTO public.model_catalog
  (id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,cost_unit,billing_seconds,gated_flag,active)
VALUES
  ('crun-catalog-kling-template',    'Kling Template Effect',    'crun','crun:kling/template',    'image-to-video',102,1.8268,'per_generation',NULL,false,true),
  ('crun-catalog-seedance-template', 'Seedance Template Effect', 'crun','crun:bytedance/template','image-to-video',170,3.0355,'per_generation',NULL,false,true),
  ('crun-catalog-vidu-template',     'Vidu Template Effect',     'crun','crun:vidu/template',     'image-to-video', 75,1.3399,'per_generation',NULL,false,true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.model_routes
  (model_id,supplier,endpoint,cost_per_unit,cost_unit,billing_seconds,priority,state,provenance,parity_record)
SELECT c.id,'crun',c.provider_endpoint,c.provider_cost_per_unit,'per_generation',NULL,1,'active','licensed_reseller',
       'Owner activation 2026-11-27: live CRUN template catalogue contract; per-run cost and price are re-derived from server-validated catalogue metadata by 0622'
FROM public.model_catalog c
WHERE c.id IN ('crun-catalog-kling-template','crun-catalog-seedance-template','crun-catalog-vidu-template')
  AND NOT EXISTS (SELECT 1 FROM public.model_routes r WHERE r.model_id=c.id)
ON CONFLICT (model_id,supplier,endpoint) DO NOTHING;

DO $$ BEGIN
  IF to_regprocedure('private.provider_spend_model_cost_pre_0622(text,jsonb,integer)') IS NULL THEN
    ALTER FUNCTION private.provider_spend_model_cost(TEXT,JSONB,INTEGER) RENAME TO provider_spend_model_cost_pre_0622;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.provider_spend_model_cost(p_model_id TEXT,p_inputs JSONB,p_credits INTEGER)
RETURNS TABLE(provider TEXT,purpose TEXT,cost_microusd BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  b JSONB:=p_inputs->'catalog_template_billing';
  expected_provider TEXT;
  upstream NUMERIC;
  expected_cost BIGINT;
  expected_credits INTEGER;
BEGIN
  expected_provider:=CASE p_model_id
    WHEN 'crun-catalog-kling-template' THEN 'kling'
    WHEN 'crun-catalog-seedance-template' THEN 'seedance'
    WHEN 'crun-catalog-vidu-template' THEN 'vidu'
    ELSE NULL END;
  IF expected_provider IS NULL THEN
    RETURN QUERY SELECT * FROM private.provider_spend_model_cost_pre_0622(p_model_id,p_inputs,p_credits);
    RETURN;
  END IF;
  IF b IS NULL OR jsonb_typeof(b)<>'object' OR (b->>'version')::INTEGER<>1
     OR b->>'provider' IS DISTINCT FROM expected_provider
     OR b->>'catalog_id' !~ ('^'||expected_provider||':[0-9]{1,4}:[0-9]{1,2}:[A-Za-z0-9._-]{1,120}$')
     OR b->>'template_id' !~ '^[A-Za-z0-9._-]{1,120}$'
     OR jsonb_typeof(b->'provider_credits')<>'number' OR jsonb_typeof(b->'cost_microusd')<>'number'
     OR jsonb_typeof(b->'credits')<>'number' THEN
    RAISE EXCEPTION 'PROVIDER_SPEND_LIMIT:closed:60' USING ERRCODE='P0001';
  END IF;
  upstream:=(b->>'provider_credits')::NUMERIC;
  IF upstream<0 OR upstream>100000 THEN RAISE EXCEPTION 'PROVIDER_SPEND_LIMIT:closed:60' USING ERRCODE='P0001'; END IF;
  expected_cost:=GREATEST(1,ceil(upstream*1000000/206)::BIGINT);
  expected_credits:=GREATEST(1,ceil(expected_cost::NUMERIC/17960)::INTEGER);
  IF expected_credits>10000 OR (b->>'cost_microusd')::BIGINT IS DISTINCT FROM expected_cost
     OR (b->>'credits')::INTEGER IS DISTINCT FROM expected_credits OR p_credits IS DISTINCT FROM expected_credits THEN
    RAISE EXCEPTION 'PROVIDER_SPEND_LIMIT:closed:60' USING ERRCODE='P0001';
  END IF;
  RETURN QUERY SELECT 'crun'::TEXT,'job'::TEXT,expected_cost;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  IF expected_provider IS NOT NULL THEN RAISE EXCEPTION 'PROVIDER_SPEND_LIMIT:closed:60' USING ERRCODE='P0001'; END IF;
  RAISE;
END $$;

REVOKE ALL ON FUNCTION private.provider_spend_model_cost_pre_0622(TEXT,JSONB,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.provider_spend_model_cost(TEXT,JSONB,INTEGER) FROM PUBLIC,anon,authenticated,service_role;

DO $$
DECLARE n BIGINT;
BEGIN
  SELECT count(*) INTO n FROM public.model_catalog c
  WHERE c.id IN ('crun-catalog-kling-template','crun-catalog-seedance-template','crun-catalog-vidu-template')
    AND c.active AND NOT c.gated_flag AND c.provider='crun' AND c.cost_unit='per_generation'
    AND round(c.provider_cost_per_unit*100000)<=c.credits_5s*1796;
  IF n<>3 THEN RAISE EXCEPTION 'Expected three active CRUN catalogue-template rows inside the margin floor, found %',n; END IF;
  SELECT count(*) INTO n FROM public.model_routes r
  WHERE r.model_id IN ('crun-catalog-kling-template','crun-catalog-seedance-template','crun-catalog-vidu-template')
    AND r.supplier='crun' AND r.priority=1 AND r.state='active';
  IF n<>3 THEN RAISE EXCEPTION 'Expected three active CRUN catalogue-template routes, found %',n; END IF;
END $$;

COMMIT;
