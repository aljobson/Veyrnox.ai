-- Activate inworld-tts for its live end-to-end test (owner approved in chat
-- 2026-09-13). If the test generation does not reach STORED, a follow-up
-- migration switches it off again.
UPDATE public.model_catalog
   SET active = true,
       updated_at = now()
 WHERE id = 'inworld-tts';
