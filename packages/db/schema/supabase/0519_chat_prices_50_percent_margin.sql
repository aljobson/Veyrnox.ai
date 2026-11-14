-- Chat prices re-checked for the 50% margin (ADR-0067 amendment 18, 2026-11-14). The owner asked that every LLM keep a 50%
-- margin against what the providers charge now.
--
-- Rates: OpenRouter's public endpoint list read 2026-11-14 (GET /api/v1/models/<slug>/endpoints, no key). The adapter routes
-- with only `data_collection: deny`, no provider order and no price cap, so a reply can land on any standard-tier endpoint of
-- the model. The recorded rate is therefore the dearest standard-tier endpoint, or the rate recorded in 0194/0196 if higher.
-- Regional endpoints (Bedrock us-east-1/eu-west-1, Vertex us/europe, Azure us/eu, Mistral eu/us) list about 10% above the
-- model's headline rate. Opt-in tiers (flex, priority, fast, ultrafast) are excluded: a request only gets one by asking.
--                        input $/M (was)   output $/M (was)   source endpoint
--   claude-opus-5.5      4.40 (4.00)       22.00 (20.00)      Bedrock regional / Azure us / Vertex us
--   claude-sonnet-5.5    2.20 (2.00)       11.00 (10.00)      same
--   gpt-6.1-sol          2.20 (2.00)       11.00 (10.00)      Bedrock us-east-1 / Azure eu, us
--   grok-4.7             2.20 (2.00)        6.60 (6.00)       xAI zdr/us
--   gemini-3.8-flash     0.825 (0.75)       4.125 (3.75)      Vertex us (also the headline rate since 2026-11)
--   gpt-6-luna           0.11 (0.10)        0.55 (0.50)       Azure us, eu / Bedrock us-east-1
--   deepseek-v4.1-flash  0.45 (0.30)        1.80 (1.20)       Parasail / Fireworks (headline is now $0.0507 / $0.2028)
--   llama-4-maverick     0.35 (0.19)        1.15 (0.65)       Google Vertex us-east5 (Parasail 0.35 / 1.00)
--   ministral-14b        0.22 (0.20)        0.22 (0.20)       Mistral eu
--   mistral-small        0.165 (0.15)       0.66 (0.60)       Mistral eu / us
--
-- Worst cases, the same shapes as before, at those rates; each cost rounded up to $0.0001:
--   base       9,000 input (Grok 10,300) + the reply cap (4,096; 1,024 on the three starters) output   (0194, 0196)
--   Thinking   4,096 more output tokens                                                                (0197)
--   Web search $0.011 capped-search fee bound + 7,000 input tokens                                     (0220)
--   Images     four images at the per-image bound of 0198                                              (0198)
--   long text  6,600 input tokens                                                                      (0517)
--                        base            Thinking        Web search      Images          long text
--   claude-opus-5.5      0.1298  8 (7)   0.0902  6 (5)   0.0418  3       0.1021  6       0.0291  2
--   claude-sonnet-5.5    0.0649  4       0.0451  3       0.0264  2       0.0511  3       0.0146  1
--   gpt-6.1-sol          0.0649  4       0.0451  3       0.0264  2       0.0528  3       0.0146  1
--   grok-4.7             0.0497  3       0.0271  2       0.0264  2       0.0396  3       0.0146  1
--   gemini-3.8-flash     0.0244  2       0.0169  1       0.0168  1       0.0047  1       0.0055  1
--   gpt-6-luna           0.0033  1       0.0023  1       0.0118  1       0.0027  1       0.0008  1
--   deepseek-v4.1-flash  0.0115  1       0.0074  1       0.0142  1       0.0024  1       0.0030  1
--   llama-4-maverick     0.0044  1       -               0.0135  1       0.0042  1       0.0024  1
--   ministral-14b        0.0023  1       -               0.0126  1       0.0034  1       0.0015  1
--   mistral-small        0.0022  1       -               0.0122  1       0.0026  1       0.0011  1
--   editor-ai-edit-gemini-3.8-flash: 9,000 x $0.825/M + 4,096 x $4.125/M = $0.0244, Credits stay 3 (floor 2).
-- Credits are the margin floor, credits >= ceil(cost / 0.01796) (docs/pricing/50-percent-margin.md: $0.01796 of provider cost
-- per Credit leaves half of a Credit's selling price after payment fees); the table's CHECKs enforce it. No price is lowered. Only Claude Opus 5.5
-- goes up: base 7 -> 8 Credits, Thinking 5 -> 6. At its headline rate Opus clears 7 and 5; the regional endpoints do not.
-- Sonnet's Deep research extra stays $0.0400 / 3 Credits: plan + four Mistral Small searches at +10% is $0.0362.
--
-- Apply only through the owner-approved workflow. Absolute values, so it can be applied twice.

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog m
       SET credits_5s = v.base_credits, provider_cost_per_unit = v.base_cost,
           chat_thinking_extra_credits = v.think_credits, chat_thinking_extra_cost = v.think_cost,
           chat_web_extra_cost = v.web_cost, chat_images_extra_cost = v.images_cost, chat_long_text_extra_cost = v.long_cost,
           updated_at = now()
      FROM (VALUES
            ('chat-claude-opus-5.5', 'anthropic/claude-opus-5.5', 8, 0.1298, 6, 0.0902, 0.0418, 0.1021, 0.0291),
            ('chat-claude-sonnet-5.5', 'anthropic/claude-sonnet-5.5', 4, 0.0649, 3, 0.0451, 0.0264, 0.0511, 0.0146),
            ('chat-gpt-6.1-sol', 'openai/gpt-6.1-sol', 4, 0.0649, 3, 0.0451, 0.0264, 0.0528, 0.0146),
            ('chat-grok-4.7', 'x-ai/grok-4.7', 3, 0.0497, 2, 0.0271, 0.0264, 0.0396, 0.0146),
            ('chat-gemini-3.8-flash', 'google/gemini-3.8-flash', 2, 0.0244, 1, 0.0169, 0.0168, 0.0047, 0.0055),
            ('chat-gpt-6-luna', 'openai/gpt-6-luna', 1, 0.0033, 1, 0.0023, 0.0118, 0.0027, 0.0008),
            ('chat-deepseek-v4.1-flash', 'deepseek/deepseek-v4.1-flash', 1, 0.0115, 1, 0.0074, 0.0142, 0.0024, 0.0030)
           ) AS v(id, endpoint, base_credits, base_cost, think_credits, think_cost, web_cost, images_cost, long_cost)
     WHERE m.id = v.id AND m.provider = 'openrouter-chat' AND m.provider_endpoint = v.endpoint AND m.modality = 'text';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 7 THEN
        RAISE EXCEPTION 'Expected seven premium chat rows to re-price, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog m
       SET provider_cost_per_unit = v.base_cost, chat_web_extra_cost = v.web_cost,
           chat_images_extra_cost = v.images_cost, chat_long_text_extra_cost = v.long_cost,
           updated_at = now()
      FROM (VALUES
            ('chat-llama-4-maverick', 'meta-llama/llama-4-maverick', 0.0044, 0.0135, 0.0042, 0.0024),
            ('chat-ministral-14b', 'mistralai/ministral-14b-2512', 0.0023, 0.0126, 0.0034, 0.0015),
            ('chat-mistral-small', 'mistralai/mistral-small-2603', 0.0022, 0.0122, 0.0026, 0.0011)
           ) AS v(id, endpoint, base_cost, web_cost, images_cost, long_cost)
     WHERE m.id = v.id AND m.provider = 'openrouter-chat' AND m.provider_endpoint = v.endpoint AND m.modality = 'text';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 3 THEN
        RAISE EXCEPTION 'Expected three starter chat rows to re-price, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET provider_cost_per_unit = 0.0244, updated_at = now()
     WHERE id = 'editor-ai-edit-gemini-3.8-flash' AND provider = 'openrouter-chat'
       AND provider_endpoint = 'google/gemini-3.8-flash' AND modality = 'text';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one editor-ai-edit-gemini-3.8-flash row to re-price, updated %', affected;
    END IF;
END $$;
