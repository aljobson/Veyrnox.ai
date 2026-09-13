-- Retest seedance-2.0-fast on OpenRouter with a key on the funded account
-- (owner approved in chat 2026-09-13). Stays on only if the test reaches
-- STORED; otherwise a follow-up migration switches it off.
UPDATE public.model_catalog
   SET active = true,
       updated_at = now()
 WHERE id = 'seedance-2.0-fast'
   AND provider = 'openrouter';
