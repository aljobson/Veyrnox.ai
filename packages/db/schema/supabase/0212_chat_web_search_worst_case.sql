-- Web search worst cases, re-measured (ADR-0067 amendment 2 follow-up, 2026-10-05).
--
-- 0197 recorded a Web search extra as a $0.02 search fee plus 16,000 input tokens at the row's rate. A live probe on
-- 2026-10-05 (scripts/measure-chat-research.mjs, 12 searches on Claude Sonnet 5.5 and GPT-6 Luna) broke both numbers:
--   * the web plugin injected 12,417 to 49,862 input tokens per search, and OpenRouter documents no way to cap that text;
--   * the plugin's own fee was not fixed: $0.01 to $0.05 per search, in steps of $0.01 (one per page fetched), on both models.
-- Sonnet searches cost $0.043 to $0.161 against a recorded $0.0520; Luna $0.022 to $0.033 against $0.0216.
--
-- The new recorded cost is a planning bound, not a guarantee: a $0.06 fee (the observed maximum $0.05 plus 20%) plus 64,000
-- input tokens (the observed maximum 49,862 plus about 28%) at each model's input rate. Credits follow the margin floor
-- (credits >= ceil(cost / 0.01796), docs/pricing/50-percent-margin.md); the table's own CHECK enforces it. If a search ever
-- reads more than that, the overshoot is the one case the flat price does not cover.
--
-- Credits: Opus 18, Sonnet / GPT-6.1 Sol / Grok 11, Gemini 7, DeepSeek 5, Llama / Ministral 5, Luna / Mistral Small 4.
-- Apply only through the owner-approved workflow. The predicate pins each row's old or new recorded cost, so a row that was
-- edited by hand fails loudly, and the statement can be applied twice.
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog m
       SET chat_web_extra_credits = v.new_credits,
           chat_web_extra_cost    = v.new_cost,
           updated_at = now()
      FROM (VALUES
            ('chat-claude-opus-5.5', 0.0840, 18, 0.3160),
            ('chat-claude-sonnet-5.5', 0.0520, 11, 0.1880),
            ('chat-gpt-6.1-sol', 0.0520, 11, 0.1880),
            ('chat-grok-4.7', 0.0520, 11, 0.1880),
            ('chat-gemini-3.8-flash', 0.0320, 7, 0.1080),
            ('chat-deepseek-v4.1-flash', 0.0248, 5, 0.0792),
            ('chat-gpt-6-luna', 0.0216, 4, 0.0664),
            ('chat-llama-4-maverick', 0.0231, 5, 0.0720),
            ('chat-ministral-14b', 0.0232, 5, 0.0728),
            ('chat-mistral-small', 0.0224, 4, 0.0696)
           ) AS v(id, old_cost, new_credits, new_cost)
     WHERE m.id = v.id AND m.provider = 'openrouter-chat' AND m.modality = 'text'
       AND m.chat_web_extra_cost IN (v.old_cost, v.new_cost);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 10 THEN
        RAISE EXCEPTION 'Expected ten chat rows to re-price Web search on, updated %', affected;
    END IF;
END $$;
