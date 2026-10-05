-- Deep research pricing and the search model (ADR-0070), from scripts/measure-chat-research.mjs run live on 2026-10-05.
--
-- What the measurements showed (4 paid runs, 3 questions each):
--   * The reasoning models were bad searchers. Claude Sonnet 5.5 returned no text on 6 of 12 searches (it accepts only effort
--     'minimal' and still spends the token cap thinking) at $0.045 to $0.077 each; GPT-6 Luna read up to 109,000 tokens of page
--     text per search, cost up to $0.151 and took up to 105 s. A whole run ran 23 to 116 s and cost up to $0.51.
--   * A cheap non-reasoning model for the plan and the searches (Mistral Small, 2603) returned text on 23 of 23 searches, at a
--     near-flat $0.0079 to $0.0082 each (2,000 to 4,000 tokens read), with Claude Sonnet 5.5 writing the answer. Runs took 24 to
--     44 s and cost $0.05 to $0.07.
-- So the plan and searches run on a separate model, set per row here, and only Claude Sonnet 5.5 offers research for now.
--
-- Price. A plain Sonnet reply is already 4 Credits, priced for a 4,096-token reply from 9,000 tokens of input (0196). The research
-- write is capped at the same 4,096 tokens and read at most about 6,500 tokens of notes, so it fits inside what the base price
-- covers. The option's own extra cost is therefore the plan and four searches:
--     plan $0.0001 + 4 x $0.0082 = $0.0329, recorded at $0.0400 for headroom   ->   ceil(0.0400 / 0.01796) = 3 Credits
-- Total 7 Credits per research reply. Checked against the whole run: the plan and searches plus a write at the cap come to at most
-- about $0.087 (6,454 input x $2/M + 4,096 output x $10/M = $0.054, plus $0.033), and 7 Credits clears the floor for that, too.
--
-- Not offered: GPT-6 Luna (searches too slow and dear, one run reached 116 s of the 120 s ceiling) and every other row.
-- Apply only through the owner-approved workflow. CHAT_RESEARCH_ENABLED stays "false" until the owner flips it.
--
-- Idempotent: IF NOT EXISTS, constraints dropped and re-added by name, and the update uses absolute values.

ALTER TABLE public.model_catalog ADD COLUMN IF NOT EXISTS chat_research_search_model TEXT;

ALTER TABLE public.model_catalog DROP CONSTRAINT IF EXISTS model_catalog_chat_research_check;
ALTER TABLE public.model_catalog ADD CONSTRAINT model_catalog_chat_research_check CHECK (
    num_nonnulls(chat_research_extra_credits, chat_research_extra_cost, chat_research_write_max_tokens, chat_research_search_model) IN (0, 4)
    AND (chat_research_extra_credits IS NULL OR (
        chat_research_extra_credits >= 1
        AND chat_research_extra_cost > 0
        AND chat_research_extra_credits >= ceil(chat_research_extra_cost / 0.01796)
        AND chat_research_write_max_tokens BETWEEN 256 AND 8192
        AND chat_research_search_model ~ '^[a-z0-9][a-z0-9._:/-]{0,100}$'))
);

ALTER TABLE public.model_catalog DROP CONSTRAINT IF EXISTS model_catalog_chat_research_text_only_check;
ALTER TABLE public.model_catalog ADD CONSTRAINT model_catalog_chat_research_text_only_check CHECK (
    modality = 'text' OR num_nonnulls(chat_research_extra_credits, chat_research_extra_cost, chat_research_write_max_tokens, chat_research_search_model) = 0
);

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET chat_research_extra_credits = 3,
           chat_research_extra_cost = 0.0400,
           chat_research_write_max_tokens = 4096,
           chat_research_search_model = 'mistralai/mistral-small-2603',
           updated_at = now()
     WHERE id = 'chat-claude-sonnet-5.5' AND provider = 'openrouter-chat' AND provider_endpoint = 'anthropic/claude-sonnet-5.5'
       AND modality = 'text' AND chat_max_reply_tokens = 4096;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one chat-claude-sonnet-5.5 row with a 4096-token reply cap, updated %', affected;
    END IF;
END $$;
