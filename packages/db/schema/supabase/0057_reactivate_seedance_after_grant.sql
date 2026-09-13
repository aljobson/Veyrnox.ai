-- Retest seedance-2.0-fast after granting the test account 100 credits
-- (grant reason: Al Jobson testing). Owner approved in chat 2026-09-13.
UPDATE public.model_catalog
   SET active = true,
       updated_at = now()
 WHERE id = 'seedance-2.0-fast'
   AND provider = 'openrouter';
