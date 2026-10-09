-- Chat options (ADR-0067 amendment 2): Thinking and Web search are priced add-ons stored on the catalog
-- row. A reply costs the row's base Credits plus the extra for each option the user turns on; the app
-- only looks these up and adds them. A row offers an option only when all of its columns are set.
--
-- Each extra carries its own recorded worst-case cost, and the table refuses an extra priced under the
-- margin floor (credits >= ceil(cost / 0.01796), docs/pricing/50-percent-margin.md).
--   Thinking: effort 'high' and a larger reply cap (8,192). The extra is the added output only,
--     (8,192 - 4,096) x the model's output rate.
--   Web search: OpenRouter's web plugin, 3 results. A live check on 2026-10-05 showed a $0.0200 search fee
--     and about 12,700 extra input tokens (about 17,500 at the default 5 results). The recorded worst case
--     is the $0.0200 fee plus 16,000 extra input tokens at the model's input rate.
ALTER TABLE public.model_catalog
    ADD COLUMN IF NOT EXISTS chat_thinking_effort TEXT,
    ADD COLUMN IF NOT EXISTS chat_thinking_max_reply_tokens INTEGER,
    ADD COLUMN IF NOT EXISTS chat_thinking_extra_credits INTEGER,
    ADD COLUMN IF NOT EXISTS chat_thinking_extra_cost NUMERIC(10, 4),
    ADD COLUMN IF NOT EXISTS chat_web_extra_credits INTEGER,
    ADD COLUMN IF NOT EXISTS chat_web_extra_cost NUMERIC(10, 4);

ALTER TABLE public.model_catalog DROP CONSTRAINT IF EXISTS model_catalog_chat_thinking_check;
ALTER TABLE public.model_catalog ADD CONSTRAINT model_catalog_chat_thinking_check CHECK (
    num_nonnulls(chat_thinking_effort, chat_thinking_max_reply_tokens, chat_thinking_extra_credits, chat_thinking_extra_cost) IN (0, 4)
    AND (chat_thinking_effort IS NULL OR chat_thinking_effort IN ('none', 'minimal', 'low', 'medium', 'high'))
    AND (chat_thinking_max_reply_tokens IS NULL OR chat_thinking_max_reply_tokens BETWEEN 256 AND 8192)
    AND (chat_thinking_max_reply_tokens IS NULL OR chat_thinking_max_reply_tokens >= COALESCE(chat_max_reply_tokens, 1024))
    AND (chat_thinking_extra_credits IS NULL OR (chat_thinking_extra_credits >= 1 AND chat_thinking_extra_cost > 0
         AND chat_thinking_extra_credits >= ceil(chat_thinking_extra_cost / 0.01796)))
);
ALTER TABLE public.model_catalog DROP CONSTRAINT IF EXISTS model_catalog_chat_web_check;
ALTER TABLE public.model_catalog ADD CONSTRAINT model_catalog_chat_web_check CHECK (
    num_nonnulls(chat_web_extra_credits, chat_web_extra_cost) IN (0, 2)
    AND (chat_web_extra_credits IS NULL OR (chat_web_extra_credits >= 1 AND chat_web_extra_cost > 0
         AND chat_web_extra_credits >= ceil(chat_web_extra_cost / 0.01796)))
);
ALTER TABLE public.model_catalog DROP CONSTRAINT IF EXISTS model_catalog_chat_options_text_only_check;
ALTER TABLE public.model_catalog ADD CONSTRAINT model_catalog_chat_options_text_only_check CHECK (
    modality = 'text' OR num_nonnulls(chat_thinking_effort, chat_thinking_max_reply_tokens, chat_thinking_extra_credits,
        chat_thinking_extra_cost, chat_web_extra_credits, chat_web_extra_cost) = 0
);

-- Web search on the three live models (no thinking: they do not reason).
--   llama-4-maverick  $0.0200 + 16,000 x $0.19/M = $0.02304 -> $0.0231 (rounded up)   2 Credits
--   ministral-14b     $0.0200 + 16,000 x $0.20/M = $0.0232   2 Credits
--   mistral-small     $0.0200 + 16,000 x $0.15/M = $0.0224   2 Credits
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET chat_web_extra_credits = 2,
           chat_web_extra_cost = CASE id WHEN 'chat-llama-4-maverick' THEN 0.0231
                                         WHEN 'chat-ministral-14b' THEN 0.0232
                                         ELSE 0.0224 END,
           updated_at = now()
     WHERE id IN ('chat-llama-4-maverick', 'chat-ministral-14b', 'chat-mistral-small') AND provider = 'openrouter-chat';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 3 THEN
        RAISE EXCEPTION 'Expected three live chat rows to price Web search on, updated %', affected;
    END IF;
END $$;

-- Thinking and Web search on the seven staged premium models (0196). Still inactive.
--                     thinking extra (4,096 x output rate)   web extra ($0.0200 + 16,000 x input rate)
--   claude-sonnet-5.5   $0.0410  3 Credits                    $0.0520  3 Credits
--   claude-opus-5.5     $0.0820  5 Credits                    $0.0840  5 Credits
--   gpt-6.1-sol         $0.0410  3 Credits                    $0.0520  3 Credits
--   gemini-3.8-flash    $0.0154  1 Credit                     $0.0320  2 Credits
--   grok-4.7            $0.0246  2 Credits                    $0.0520  3 Credits
--   gpt-6-luna          $0.0021  1 Credit                     $0.0216  2 Credits
--   deepseek-v4.1-flash $0.0050  1 Credit                     $0.0248  2 Credits
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET chat_thinking_effort = 'high',
           chat_thinking_max_reply_tokens = 8192,
           chat_thinking_extra_credits = CASE id WHEN 'chat-claude-sonnet-5.5' THEN 3 WHEN 'chat-claude-opus-5.5' THEN 5
               WHEN 'chat-gpt-6.1-sol' THEN 3 WHEN 'chat-gemini-3.8-flash' THEN 1 WHEN 'chat-grok-4.7' THEN 2
               WHEN 'chat-gpt-6-luna' THEN 1 ELSE 1 END,
           chat_thinking_extra_cost = CASE id WHEN 'chat-claude-sonnet-5.5' THEN 0.0410 WHEN 'chat-claude-opus-5.5' THEN 0.0820
               WHEN 'chat-gpt-6.1-sol' THEN 0.0410 WHEN 'chat-gemini-3.8-flash' THEN 0.0154 WHEN 'chat-grok-4.7' THEN 0.0246
               WHEN 'chat-gpt-6-luna' THEN 0.0021 ELSE 0.0050 END,
           chat_web_extra_credits = CASE id WHEN 'chat-claude-sonnet-5.5' THEN 3 WHEN 'chat-claude-opus-5.5' THEN 5
               WHEN 'chat-gpt-6.1-sol' THEN 3 WHEN 'chat-gemini-3.8-flash' THEN 2 WHEN 'chat-grok-4.7' THEN 3
               WHEN 'chat-gpt-6-luna' THEN 2 ELSE 2 END,
           chat_web_extra_cost = CASE id WHEN 'chat-claude-sonnet-5.5' THEN 0.0520 WHEN 'chat-claude-opus-5.5' THEN 0.0840
               WHEN 'chat-gpt-6.1-sol' THEN 0.0520 WHEN 'chat-gemini-3.8-flash' THEN 0.0320 WHEN 'chat-grok-4.7' THEN 0.0520
               WHEN 'chat-gpt-6-luna' THEN 0.0216 ELSE 0.0248 END,
           updated_at = now()
     WHERE id IN ('chat-claude-sonnet-5.5', 'chat-claude-opus-5.5', 'chat-gpt-6.1-sol', 'chat-gemini-3.8-flash',
                  'chat-grok-4.7', 'chat-gpt-6-luna', 'chat-deepseek-v4.1-flash') AND provider = 'openrouter-chat';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 7 THEN
        RAISE EXCEPTION 'Expected seven staged premium chat rows to price options on, updated %', affected;
    END IF;
END $$;
