-- Price the direct, owner-verified PVC speech path without exposing it in the
-- general model picker. Activation is an explicit runtime gate because it
-- requires an eligible ElevenLabs account and the owner-policy rollout.
INSERT INTO public.model_catalog
  (id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,gated_flag,active)
VALUES
  ('verified-voice-tts','Verified Voice TTS','elevenlabs',
   'elevenlabs/text-to-speech/eleven_multilingual_v2','text-to-speech',4,0.0800,true,false)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE actual RECORD;
BEGIN
  SELECT provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,gated_flag,active
    INTO actual FROM public.model_catalog WHERE id='verified-voice-tts';
  IF actual.provider IS DISTINCT FROM 'elevenlabs'
     OR actual.provider_endpoint IS DISTINCT FROM 'elevenlabs/text-to-speech/eleven_multilingual_v2'
     OR actual.modality IS DISTINCT FROM 'text-to-speech'
     OR actual.credits_5s IS DISTINCT FROM 4
     OR actual.provider_cost_per_unit IS DISTINCT FROM 0.0800
     OR actual.gated_flag IS DISTINCT FROM true
     OR actual.active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'verified-voice-tts catalog row drift';
  END IF;
END $$;
