-- Chat models that reason (ADR-0067 amendment). A catalog row may carry its own reply cap and a
-- reasoning effort; both are NULL for the first three text rows, which keep the 1,024-token default
-- and send no reasoning setting. Reasoning tokens count toward max_tokens and are billed, so a model
-- that thinks needs a larger cap or a hard question can return an empty reply.
ALTER TABLE public.model_catalog
    ADD COLUMN IF NOT EXISTS chat_max_reply_tokens INTEGER,
    ADD COLUMN IF NOT EXISTS chat_reasoning_effort TEXT;

ALTER TABLE public.model_catalog DROP CONSTRAINT IF EXISTS model_catalog_chat_max_reply_tokens_check;
ALTER TABLE public.model_catalog ADD CONSTRAINT model_catalog_chat_max_reply_tokens_check
    CHECK (chat_max_reply_tokens IS NULL OR chat_max_reply_tokens BETWEEN 256 AND 8192);
ALTER TABLE public.model_catalog DROP CONSTRAINT IF EXISTS model_catalog_chat_reasoning_effort_check;
ALTER TABLE public.model_catalog ADD CONSTRAINT model_catalog_chat_reasoning_effort_check
    CHECK (chat_reasoning_effort IS NULL OR chat_reasoning_effort IN ('none', 'minimal', 'low', 'medium', 'high'));
ALTER TABLE public.model_catalog DROP CONSTRAINT IF EXISTS model_catalog_chat_budget_text_only_check;
ALTER TABLE public.model_catalog ADD CONSTRAINT model_catalog_chat_budget_text_only_check
    CHECK (modality = 'text' OR (chat_max_reply_tokens IS NULL AND chat_reasoning_effort IS NULL));

-- Seven models staged INACTIVE. Price is flat per reply, so provider_cost_per_unit is the worst case
-- of one reply, from OpenRouter's public list read 2026-10-05: 9,000 input tokens (24,000 history +
-- 4,000 instruction + 8,000 text characters) plus a full 4,096-token reply. Grok gets 10,300 input
-- tokens because a live check showed it spends about 1,300 on a tiny prompt. Real replies cost far
-- less (a live reply from Claude Sonnet 5.5 cost $0.0018). Floor: credits >= ceil(cost / 0.01796).
--   claude-sonnet-5.5   9,000 x $2.00/M  + 4,096 x $10.00/M = $0.05896 -> $0.0590   4 Credits
--   claude-opus-5.5     9,000 x $4.00/M  + 4,096 x $20.00/M = $0.11792 -> $0.1180   7 Credits
--   gpt-6.1-sol         9,000 x $2.00/M  + 4,096 x $10.00/M = $0.05896 -> $0.0590   4 Credits
--   gemini-3.8-flash    9,000 x $0.75/M  + 4,096 x $3.75/M  = $0.02211 -> $0.0222   2 Credits
--   grok-4.7           10,300 x $2.00/M  + 4,096 x $6.00/M  = $0.04518 -> $0.0452   3 Credits
--   gpt-6-luna          9,000 x $0.10/M  + 4,096 x $0.50/M  = $0.00295 -> $0.0030   1 Credit
--   deepseek-v4.1-flash 9,000 x $0.30/M  + 4,096 x $1.20/M  = $0.00762 -> $0.0077   1 Credit
-- Prices are the owner's call; nothing here is active. Activation needs a live streamed check per
-- slug on staging and a row-count-asserted UPDATE migration.
INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s,
     provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active,
     chat_max_reply_tokens, chat_reasoning_effort)
VALUES
    ('chat-claude-sonnet-5.5', 'Claude Sonnet 5.5', 'openrouter-chat', 'anthropic/claude-sonnet-5.5',
     'text', 4, 0.0590, 'per_generation', NULL, false, false, 4096, 'low'),
    ('chat-claude-opus-5.5', 'Claude Opus 5.5', 'openrouter-chat', 'anthropic/claude-opus-5.5',
     'text', 7, 0.1180, 'per_generation', NULL, false, false, 4096, 'low'),
    ('chat-gpt-6.1-sol', 'GPT-6.1 Sol', 'openrouter-chat', 'openai/gpt-6.1-sol',
     'text', 4, 0.0590, 'per_generation', NULL, false, false, 4096, 'low'),
    ('chat-gemini-3.8-flash', 'Gemini 3.8 Flash', 'openrouter-chat', 'google/gemini-3.8-flash',
     'text', 2, 0.0222, 'per_generation', NULL, false, false, 4096, 'low'),
    ('chat-grok-4.7', 'Grok 4.7', 'openrouter-chat', 'x-ai/grok-4.7',
     'text', 3, 0.0452, 'per_generation', NULL, false, false, 4096, 'low'),
    ('chat-gpt-6-luna', 'GPT-6 Luna', 'openrouter-chat', 'openai/gpt-6-luna',
     'text', 1, 0.0030, 'per_generation', NULL, false, false, 4096, 'none'),
    ('chat-deepseek-v4.1-flash', 'DeepSeek V4.1 Flash', 'openrouter-chat', 'deepseek/deepseek-v4.1-flash',
     'text', 1, 0.0077, 'per_generation', NULL, false, false, 4096, 'low')
ON CONFLICT (id) DO NOTHING;
