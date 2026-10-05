-- First chat text models (ADR-0067), staged INACTIVE. Replay preserves any later
-- activation or repricing; nothing here turns chat on.
--
-- Price is flat per reply, so provider_cost_per_unit records the WORST CASE of
-- one reply, checked against OpenRouter's public model list on 2026-10-05:
--   9,000 input tokens (24,000 history chars + 4,000 instruction chars + 8,000
--   text chars, at ~4 chars/token) plus 1,024 output tokens (MAX_REPLY_TOKENS).
--   Real replies cost less, so margin on a typical reply is higher than the floor.
-- Floor: credits >= ceil(provider cost / 0.01796), docs/pricing/50-percent-margin.md.
--
-- Chosen because none has mandatory reasoning, so the 1,024-token cap cannot be
-- spent on hidden reasoning and leave an empty reply. The adapter sends no
-- reasoning parameter; reasoning models need that first (docs/product/chat-handoff).
--
--   llama-4-maverick  9,000 x $0.19/M + 1,024 x $0.65/M = $0.002376 -> $0.0024
--   ministral-14b     9,000 x $0.20/M + 1,024 x $0.20/M = $0.002005 -> $0.0021
--   mistral-small     9,000 x $0.15/M + 1,024 x $0.60/M = $0.001964 -> $0.0020
--
-- Inactive until the endpoint answers a live streamed request on staging.
INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s,
     provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('chat-llama-4-maverick', 'Llama 4 Maverick', 'openrouter',
     'meta-llama/llama-4-maverick', 'text', 1, 0.0024, 'per_generation', NULL, false, false),
    ('chat-ministral-14b', 'Ministral 14B', 'openrouter',
     'mistralai/ministral-14b-2512', 'text', 1, 0.0021, 'per_generation', NULL, false, false),
    ('chat-mistral-small', 'Mistral Small', 'openrouter',
     'mistralai/mistral-small-2603', 'text', 1, 0.0020, 'per_generation', NULL, false, false)
ON CONFLICT (id) DO NOTHING;
