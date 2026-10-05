-- How a chat row's Web search runs (ADR-0067 amendment 8).
--   'plugin'  OpenRouter's web plugin: what runs today. The page text it injects cannot be capped, which is why its recorded
--             worst case is only a planning bound (0210).
--   'capped'  our own search call, with each result cut to a fixed length before the model sees it, so the worst case is real
--             and the Credits for it can be low.
-- The price and the engine must change together, so a cheap price can never be charged for the uncapped plugin. This migration
-- only adds the column, defaulting every row to 'plugin': it changes nothing a user sees and the release before it keeps working.
-- A later, separate migration flips a row to 'capped' and re-prices it in one statement, after the capped search is live and its
-- cost has been measured. The code that reads this column ships only after this migration is applied.
ALTER TABLE public.model_catalog ADD COLUMN IF NOT EXISTS chat_web_engine TEXT NOT NULL DEFAULT 'plugin';

ALTER TABLE public.model_catalog DROP CONSTRAINT IF EXISTS model_catalog_chat_web_engine_check;
ALTER TABLE public.model_catalog ADD CONSTRAINT model_catalog_chat_web_engine_check CHECK (
    chat_web_engine IN ('plugin', 'capped')
    -- Capped is a text row that has a Web search price.
    AND (chat_web_engine = 'plugin' OR (modality = 'text' AND chat_web_extra_credits IS NOT NULL))
);
