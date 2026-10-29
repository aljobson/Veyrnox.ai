-- Veyrnox generation prompts are capped at 30,000 characters. JSON escaping
-- can expand one character to six bytes, so every admission/storage boundary
-- uses the route's 256 KiB inputs envelope rather than the legacy 16 KiB cap.
ALTER TABLE public.fal_dispatch
  DROP CONSTRAINT IF EXISTS fal_dispatch_payload_check;
ALTER TABLE public.fal_dispatch
  ADD CONSTRAINT fal_dispatch_payload_check
  CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 262144);

DO $$
DECLARE
  definition TEXT;
  widened TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.admit_fal_dispatch(uuid,text,text,jsonb,jsonb,text,boolean)'::regprocedure
  ) INTO definition;
  IF position('16384' IN definition) > 0 THEN
    widened := replace(definition, '16384', '262144');
    EXECUTE widened;
  ELSIF position('262144' IN definition) = 0 THEN
    RAISE EXCEPTION 'admit_fal_dispatch payload bound was not found';
  END IF;

  SELECT pg_get_functiondef(
    'public.provider_spend_admit_model(uuid,text,text,jsonb,integer)'::regprocedure
  ) INTO definition;
  IF position('16384' IN definition) > 0 THEN
    widened := replace(definition, '16384', '262144');
    EXECUTE widened;
  ELSIF position('262144' IN definition) = 0 THEN
    RAISE EXCEPTION 'provider_spend_admit_model payload bound was not found';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.admit_fal_dispatch(UUID,TEXT,TEXT,JSONB,JSONB,TEXT,BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_fal_dispatch(UUID,TEXT,TEXT,JSONB,JSONB,TEXT,BOOLEAN)
  TO service_role;
REVOKE ALL ON FUNCTION public.provider_spend_admit_model(UUID,TEXT,TEXT,JSONB,INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_spend_admit_model(UUID,TEXT,TEXT,JSONB,INTEGER)
  TO service_role;
