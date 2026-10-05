-- Activate GPT-6 Luna for chat (ADR-0067), the cheapest premium model. Checked live on 2026-10-05 through the
-- repository's own adapter and message builder: a streamed reply with reasoning effort none and a 4,096-token
-- cap, Thinking (effort high, 8,192 tokens), Web search and an image. It reasons by default, so the row's effort
-- setting matters: without it a 1,024-token cap came back empty in the first live check.
-- Base 1 Credit per reply; Thinking +1, Web search +2, Images +1 (0197, 0198).
-- Apply only through the owner-approved workflow. CHAT_ENABLED stays "false" in production vars until the owner
-- flips it. The predicate pins slug, price and the reasoning setting, so an edited row fails loudly.
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET active = true, updated_at = now()
     WHERE id = 'chat-gpt-6-luna' AND provider = 'openrouter-chat'
       AND provider_endpoint = 'openai/gpt-6-luna' AND modality = 'text'
       AND credits_5s = 1 AND provider_cost_per_unit = 0.0030 AND gated_flag = false
       AND chat_max_reply_tokens = 4096 AND chat_reasoning_effort = 'none';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one verified GPT-6 Luna chat row, updated %', affected;
    END IF;
END $$;
