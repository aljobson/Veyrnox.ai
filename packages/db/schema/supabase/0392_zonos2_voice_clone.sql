-- Zero-shot voice cloning through the fal account Veyrnox already operates.
-- Zonos2 consumes one short owned reference recording and returns generated
-- speech directly, so it needs no persistent provider profile or separate
-- ElevenLabs credential. Price read from fal on 2026-10-25: $0.01/minute.
-- The 1,000-character contract is sold at two credits to preserve the
-- platform's whole-credit margin floor for a normal spoken result.
INSERT INTO public.model_catalog
  (id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,cost_unit,billing_seconds,gated_flag,active)
VALUES
  ('zonos2-voice-clone','Zonos2 Voice Clone','fal','fal-ai/zonos2',
   'text-to-speech',2,0.0100,'per_generation',NULL,false,true)
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

-- Retire the unused direct-provider profile output if it exists. Historical
-- profile records remain private; no destructive data migration is needed.
DO $$
DECLARE affected BIGINT;
BEGIN
  UPDATE public.model_catalog SET active=false WHERE id='verified-voice-tts';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'Expected one verified-voice-tts row, updated %', affected;
  END IF;
END $$;

DO $$
DECLARE actual RECORD;
BEGIN
  SELECT provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,
         cost_unit,billing_seconds,gated_flag,active
    INTO actual FROM public.model_catalog WHERE id='zonos2-voice-clone';
  IF actual.provider IS DISTINCT FROM 'fal'
     OR actual.provider_endpoint IS DISTINCT FROM 'fal-ai/zonos2'
     OR actual.modality IS DISTINCT FROM 'text-to-speech'
     OR actual.credits_5s IS DISTINCT FROM 2
     OR actual.provider_cost_per_unit IS DISTINCT FROM 0.0100
     OR actual.cost_unit IS DISTINCT FROM 'per_generation'
     OR actual.billing_seconds IS NOT NULL
     OR actual.gated_flag IS DISTINCT FROM false
     OR actual.active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'zonos2-voice-clone catalog row drift';
  END IF;
END $$;
