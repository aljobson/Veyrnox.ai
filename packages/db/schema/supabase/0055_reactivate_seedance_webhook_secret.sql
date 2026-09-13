-- Retest seedance-2.0-fast on OpenRouter after OPENROUTER_WEBHOOK_SECRET was
-- replaced with the funded workspace's signing secret (owner approved in chat
-- 2026-09-13). Stays on only if the test reaches STORED.
UPDATE public.model_catalog
   SET active = true,
       updated_at = now()
 WHERE id = 'seedance-2.0-fast'
   AND provider = 'openrouter';
