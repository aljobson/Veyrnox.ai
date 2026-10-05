-- Activate the five held-back chat models (ADR-0067): DeepSeek V4.1 Flash, Gemini 3.8 Flash, Grok 4.7, GPT-6.1 Sol and
-- Claude Opus 5.5. Each was checked live on 2026-10-05 through the repository's own adapter and message builder, on its own
-- row settings (4,096-token cap, reasoning effort low; Thinking at effort high with 8,192 tokens): a plain reply and a
-- Thinking reply, both non-empty, and the Thinking reply to a short sums puzzle was correct (101.20 / 50.60 / 35.60) on all five.
-- Gemini 3.8 Flash took about 14 s to start a Thinking reply, so the screen shows that cost, not the model, as the reason to
-- keep Thinking optional.
-- Base Credits per reply: DeepSeek 1, Gemini 2, Grok 3, GPT-6.1 Sol 4, Opus 7; extras are priced on the rows (0197, 0198).
-- Apply only through the owner-approved workflow. CHAT_ENABLED is already "true"; this changes which models appear.
-- The predicate pins slug, price, recorded cost and both reasoning settings, so an edited row fails loudly.
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET active = true, updated_at = now()
     WHERE provider = 'openrouter-chat' AND modality = 'text' AND gated_flag = false
       AND chat_max_reply_tokens = 4096 AND chat_reasoning_effort = 'low'
       AND (id, provider_endpoint, credits_5s, provider_cost_per_unit) IN (
            ('chat-deepseek-v4.1-flash', 'deepseek/deepseek-v4.1-flash', 1, 0.0077),
            ('chat-gemini-3.8-flash',    'google/gemini-3.8-flash',      2, 0.0222),
            ('chat-grok-4.7',            'x-ai/grok-4.7',                3, 0.0452),
            ('chat-gpt-6.1-sol',         'openai/gpt-6.1-sol',           4, 0.0590),
            ('chat-claude-opus-5.5',     'anthropic/claude-opus-5.5',    7, 0.1180));
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 5 THEN
        RAISE EXCEPTION 'Expected five verified premium chat rows, updated %', affected;
    END IF;
END $$;
