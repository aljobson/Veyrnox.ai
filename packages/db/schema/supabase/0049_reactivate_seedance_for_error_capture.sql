-- Reactivate seedance-2.0-fast for one more submit, with the Worker log tail
-- running to capture OpenRouter's rejection (owner approved the retest in chat
-- 2026-09-13). Switched off again straight after unless it reaches STORED.
UPDATE public.model_catalog
   SET active = true,
       updated_at = now()
 WHERE id = 'seedance-2.0-fast'
   AND provider = 'openrouter';
