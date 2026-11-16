-- 0553 — the 1-credit chat models are now 2 credits a reply (owner request 2026-11-16, web and mobile app).
--
-- 0545 moved seven non-chat rows from 1 to 2 credits but not the LLM chat rows, which are separate model_catalog rows
-- (provider 'openrouter-chat', ids 'chat-*'). The chat picker, /api/models-style reads and the mobile app all read
-- credits_5s, so this one change moves web and the app together (credits per reply = credits_5s + the extra of each
-- option chosen, lib/chat.js replyPrice).
--
-- Base price per reply after 0519 (the last migration to set it):
--   chat-claude-opus-5.5 8, chat-claude-sonnet-5.5 4, chat-gpt-6.1-sol 4, chat-grok-4.7 3, chat-gemini-3.8-flash 2   -> unchanged
--   chat-gpt-6-luna 1, chat-deepseek-v4.1-flash 1, chat-llama-4-maverick 1, chat-ministral-14b 1, chat-mistral-small 1 -> 2
-- Only those five move. The per-option extras (Thinking, Web search, Images, long message) are not a model price and stay
-- as 0519 left them, so a Thinking reply on DeepSeek is 2 + 1 = 3 credits.
-- Raising a price cannot trip the ADR-0014 floor trigger (0366, model_catalog_margin_floor): it only refuses a price below
-- ceil(cost / 0.01796). Jobs already submitted keep the price they were debited at; only new replies cost 2.
-- Idempotent: absolute value by id, exactly five rows asserted (applying twice still touches the same five rows).
-- Rollback: a new migration setting these five ids back to 1.
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET credits_5s = 2, updated_at = now()
     WHERE provider = 'openrouter-chat' AND modality = 'text'
       AND id IN ('chat-gpt-6-luna', 'chat-deepseek-v4.1-flash', 'chat-llama-4-maverick', 'chat-ministral-14b', 'chat-mistral-small');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 5 THEN
        RAISE EXCEPTION 'Expected 5 one-credit chat rows, updated %', affected;
    END IF;
END $$;
