-- Switch Web search to the capped search and re-price it, in one statement (ADR-0067 amendment 8).
--
-- The capped search is our own call to Exa for the user's message: 3 results, at most 2,000 characters each, so the model reads at
-- most 7,000 characters of search text (7,000 tokens at one token per character, the ceiling for any language). Measured on
-- 2026-10-05 with the real key (scripts/measure-capped-search.mjs, 5 searches): Exa charged a flat $0.007 per search. The fee
-- bound is the dearest search x 1.5 rounded up, $0.011.
--
-- Each row's recorded Web search cost is that fee bound plus 7,000 input tokens at the row's input rate, and the Credits are the
-- margin floor (credits >= ceil(cost / 0.01796); the table's own CHECK enforces it). Unlike 0210, this is a real ceiling: the
-- text is cut on our side before the model sees it.
--
-- Credits (from the uncapped plugin's 0210 price): Opus 18 -> 3, Sonnet / GPT-6.1 Sol / Grok 11 -> 2, every other model 4 to 7 -> 1.
-- The engine and the price change together on purpose. A capped row offers Web search only while EXA_API_KEY is set and refuses it
-- before any Credits move if the key is ever removed, so this low price can never be charged for the uncapped plugin.
--
-- Apply only through the owner-approved workflow, and only after the capped search code is deployed and EXA_API_KEY is set on that
-- environment. The predicate pins each row's old (0210) or new cost, so a hand-edited row fails loudly and the statement can be
-- applied twice. Rollback: set chat_web_engine back to 'plugin' AND restore the 0210 price in one statement; never one without the other.
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog m
       SET chat_web_engine        = 'capped',
           chat_web_extra_credits = v.new_credits,
           chat_web_extra_cost    = v.new_cost,
           updated_at = now()
      FROM (VALUES
            ('chat-claude-opus-5.5', 0.3160, 3, 0.0390),
            ('chat-claude-sonnet-5.5', 0.1880, 2, 0.0250),
            ('chat-deepseek-v4.1-flash', 0.0792, 1, 0.0131),
            ('chat-gemini-3.8-flash', 0.1080, 1, 0.0163),
            ('chat-gpt-6-luna', 0.0664, 1, 0.0117),
            ('chat-gpt-6.1-sol', 0.1880, 2, 0.0250),
            ('chat-grok-4.7', 0.1880, 2, 0.0250),
            ('chat-llama-4-maverick', 0.0720, 1, 0.0124),
            ('chat-ministral-14b', 0.0728, 1, 0.0124),
            ('chat-mistral-small', 0.0696, 1, 0.0121)
           ) AS v(id, old_cost, new_credits, new_cost)
     WHERE m.id = v.id AND m.provider = 'openrouter-chat' AND m.modality = 'text'
       AND m.chat_web_extra_cost IN (v.old_cost, v.new_cost);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 10 THEN
        RAISE EXCEPTION 'Expected ten chat rows to switch to the capped web search, updated %', affected;
    END IF;
END $$;
