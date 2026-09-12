-- Record the nano-banana endpoint that production already uses.
--
-- 0002 seeded provider_endpoint = 'nano-banana', a placeholder, and no later
-- migration corrected it. Production was fixed to 'fal-ai/nano-banana'
-- outside the migration history, so a fresh database built from this folder
-- came up with a dead endpoint for the one model every early test used.
-- Found while replaying all migrations into the eu-central-1 project
-- (xdxdzmsztyzbnzeforxx) and diffing its catalog against us-east-2.
--
-- Idempotent: a no-op where the endpoint is already correct.

UPDATE public.model_catalog
   SET provider_endpoint = 'fal-ai/nano-banana',
       updated_at = now()
 WHERE id = 'nano-banana'
   AND provider_endpoint <> 'fal-ai/nano-banana';
