-- Deep research as a priced chat option (ADR-0070, accepted 2026-10-05): the columns and the rules, nothing offered yet.
-- A row offers Deep research only when all three columns are set, exactly like Thinking and Web search (0197):
--   chat_research_extra_credits      the Credits added to the row's base price for one research run
--   chat_research_extra_cost         that run's recorded worst-case provider cost in dollars: one plan call, four web
--                                    searches and one write at the reply cap, measured live with
--                                    scripts/measure-chat-research.mjs, never estimated
--   chat_research_write_max_tokens   the cap on the final written answer
-- The table refuses a price under the margin floor, credits >= ceil(cost / 0.01796) (docs/pricing/50-percent-margin.md),
-- the same constant the Thinking and Web search extras use. Research is a text option: a non-text row may not carry it.
--
-- No row is updated here. Prices are set by a later migration, once the probe has produced the worst-case cost for each
-- model; until then no model offers research and the feature flag is off.
--
-- Idempotent: IF NOT EXISTS, constraints dropped and re-added by name.

ALTER TABLE public.model_catalog
    ADD COLUMN IF NOT EXISTS chat_research_extra_credits INTEGER,
    ADD COLUMN IF NOT EXISTS chat_research_extra_cost NUMERIC(10, 4),
    ADD COLUMN IF NOT EXISTS chat_research_write_max_tokens INTEGER;

ALTER TABLE public.model_catalog DROP CONSTRAINT IF EXISTS model_catalog_chat_research_check;
ALTER TABLE public.model_catalog ADD CONSTRAINT model_catalog_chat_research_check CHECK (
    num_nonnulls(chat_research_extra_credits, chat_research_extra_cost, chat_research_write_max_tokens) IN (0, 3)
    AND (chat_research_extra_credits IS NULL OR (
        chat_research_extra_credits >= 1
        AND chat_research_extra_cost > 0
        AND chat_research_extra_credits >= ceil(chat_research_extra_cost / 0.01796)
        AND chat_research_write_max_tokens BETWEEN 256 AND 8192))
);

ALTER TABLE public.model_catalog DROP CONSTRAINT IF EXISTS model_catalog_chat_research_text_only_check;
ALTER TABLE public.model_catalog ADD CONSTRAINT model_catalog_chat_research_text_only_check CHECK (
    modality = 'text' OR num_nonnulls(chat_research_extra_credits, chat_research_extra_cost, chat_research_write_max_tokens) = 0
);
