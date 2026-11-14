-- Chat long messages (ADR-0067 amendment 17). A message may now be up to 30,000 characters (was 8,000). The flat
-- per-reply price still covers a message up to 8,000 characters and 2,000 estimated tokens; a longer one also costs the
-- row's chat_long_text_extra_credits, charged once per reply. A row without the extra keeps the 8,000 limit.
--
-- Worst case it pays for: a long message is capped at 30,000 characters and 7,500 estimated tokens (lib/chat.js; CJK counts
-- one token a character, so the token cap is what binds there), against 2,000 today: 5,500 more input tokens. Plus about 20%
-- for tokenizers that count some characters as more than one token: 6,600 tokens at the model's input rate, the higher of
-- the rate recorded in 0194/0196 and OpenRouter's live list read on 2026-11-14 (public GET /api/v1/models), rounded up:
--   claude-opus-5.5      6,600 x $4.00/M  = $0.0264   2 Credits    claude-sonnet-5.5   6,600 x $2.00/M = $0.0132   1
--   gpt-6.1-sol          6,600 x $2.00/M  = $0.0132   1            grok-4.7            6,600 x $2.00/M = $0.0132   1
--   gemini-3.8-flash     6,600 x $0.825/M = $0.005445 -> $0.0055  1 (live; 0196 recorded $0.75)
--   gpt-6-luna           6,600 x $0.10/M  = $0.00066  -> $0.0007  1
--   deepseek-v4.1-flash  6,600 x $0.30/M  = $0.00198  -> $0.0020  1 (recorded; live is $0.0507)
--   llama-4-maverick     6,600 x $0.35/M  = $0.00231  -> $0.0024  1 (live; 0194 recorded $0.19)
--   ministral-14b        6,600 x $0.20/M  = $0.00132  -> $0.0014  1
--   mistral-small        6,600 x $0.15/M  = $0.00099  -> $0.0010  1
-- Worst-case input for a long message: 6,000 history + 7,500 message + 1,000 system = 14,500 tokens (9,000 before).
-- Credits meet the same margin floor as every other option: credits >= ceil(cost / 0.01796).
--
-- Safe to apply twice. A Worker from before this change validates 8,000 characters and never reads the column; a Worker
-- from after it, on a database without it, reads no long-message offer and refuses a long message before any money moves.

ALTER TABLE public.model_catalog
    ADD COLUMN IF NOT EXISTS chat_long_text_extra_credits INTEGER,
    ADD COLUMN IF NOT EXISTS chat_long_text_extra_cost NUMERIC(10, 4);

ALTER TABLE public.model_catalog DROP CONSTRAINT IF EXISTS model_catalog_chat_long_text_check;
ALTER TABLE public.model_catalog ADD CONSTRAINT model_catalog_chat_long_text_check CHECK (
    num_nonnulls(chat_long_text_extra_credits, chat_long_text_extra_cost) IN (0, 2)
    AND (chat_long_text_extra_credits IS NULL OR (chat_long_text_extra_credits >= 1 AND chat_long_text_extra_cost > 0
         AND chat_long_text_extra_credits >= ceil(chat_long_text_extra_cost / 0.01796)))
);
-- Text rows only: replace the 0198 rule so it covers the new columns too.
ALTER TABLE public.model_catalog DROP CONSTRAINT IF EXISTS model_catalog_chat_options_text_only_check;
ALTER TABLE public.model_catalog ADD CONSTRAINT model_catalog_chat_options_text_only_check CHECK (
    modality = 'text' OR num_nonnulls(chat_thinking_effort, chat_thinking_max_reply_tokens, chat_thinking_extra_credits,
        chat_thinking_extra_cost, chat_web_extra_credits, chat_web_extra_cost, chat_images_extra_credits, chat_images_extra_cost,
        chat_long_text_extra_credits, chat_long_text_extra_cost) = 0
);

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET chat_long_text_extra_credits = CASE id WHEN 'chat-claude-opus-5.5' THEN 2 ELSE 1 END,
           chat_long_text_extra_cost = CASE id WHEN 'chat-claude-opus-5.5' THEN 0.0264 WHEN 'chat-claude-sonnet-5.5' THEN 0.0132
               WHEN 'chat-gpt-6.1-sol' THEN 0.0132 WHEN 'chat-grok-4.7' THEN 0.0132 WHEN 'chat-gemini-3.8-flash' THEN 0.0055
               WHEN 'chat-gpt-6-luna' THEN 0.0007 WHEN 'chat-deepseek-v4.1-flash' THEN 0.0020
               WHEN 'chat-llama-4-maverick' THEN 0.0024 WHEN 'chat-ministral-14b' THEN 0.0014 ELSE 0.0010 END,
           updated_at = now()
     WHERE id IN ('chat-claude-opus-5.5', 'chat-claude-sonnet-5.5', 'chat-gpt-6.1-sol', 'chat-grok-4.7', 'chat-gemini-3.8-flash',
                  'chat-gpt-6-luna', 'chat-deepseek-v4.1-flash', 'chat-llama-4-maverick', 'chat-ministral-14b', 'chat-mistral-small')
       AND provider = 'openrouter-chat';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 10 THEN
        RAISE EXCEPTION 'Expected ten chat rows to price long messages on, updated %', affected;
    END IF;
END $$;

-- Finish a turn (0193): the user's text may now be 30,000 characters. One over 8,000 is stored only for a job the Worker
-- marked long_text, which is the job it priced with the long-message extra. Otherwise unchanged; same signature, so the
-- grants stay, and they are repeated below as the project asks.
CREATE OR REPLACE FUNCTION public.chat_complete_turn(p_job_id UUID, p_thread_id UUID, p_user_text TEXT, p_reply TEXT, p_status TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job public.jobs%ROWTYPE; v_thread public.chat_threads%ROWTYPE; v_reply UUID;
BEGIN
    IF p_status IS NULL OR p_status NOT IN ('complete', 'canceled', 'error') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
    END IF;
    IF p_user_text IS NULL OR length(btrim(p_user_text)) = 0 OR length(p_user_text) > 30000 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TEXT');
    END IF;
    IF p_reply IS NULL OR length(p_reply) = 0 OR length(p_reply) > 32000 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_REPLY');
    END IF;

    SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
    IF NOT FOUND OR v_job.inputs->>'kind' IS DISTINCT FROM 'chat' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'JOB_NOT_FOUND');
    END IF;
    SELECT * INTO v_thread FROM public.chat_threads
    WHERE id = p_thread_id AND user_id = v_job.user_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'THREAD_NOT_FOUND'); END IF;

    SELECT id INTO v_reply FROM public.chat_messages WHERE job_id = p_job_id AND role = 'assistant';
    IF v_reply IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'state', v_job.state, 'message_id', v_reply,
                                  'refund', v_job.state IN ('FAILED', 'REFUNDED'), 'user_id', v_job.user_id, 'credits', v_job.credits);
    END IF;
    IF v_job.state <> 'SUBMITTED' THEN RETURN jsonb_build_object('ok', false, 'code', 'BAD_STATE'); END IF;
    IF length(p_user_text) > 8000 AND v_job.inputs->>'long_text' IS DISTINCT FROM 'true' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TEXT');
    END IF;

    INSERT INTO public.chat_messages (thread_id, role, content, model_id, job_id, status)
    VALUES (p_thread_id, 'user', btrim(p_user_text), v_job.model_id, p_job_id, 'complete');
    INSERT INTO public.chat_messages (thread_id, role, content, model_id, job_id, credits, status)
    VALUES (p_thread_id, 'assistant', p_reply, v_job.model_id, p_job_id,
            CASE WHEN p_status = 'error' THEN 0 ELSE v_job.credits END, p_status)
    RETURNING id INTO v_reply;

    IF p_status = 'error' THEN
        UPDATE public.jobs SET state = 'FAILED', error_code = 'provider_cut_off', updated_at = now() WHERE id = p_job_id;
    ELSE
        UPDATE public.jobs SET state = 'STORED', updated_at = now() WHERE id = p_job_id;
    END IF;
    UPDATE public.chat_threads
    SET title = CASE WHEN title = 'New chat' THEN left(btrim(regexp_replace(p_user_text, '\s+', ' ', 'g')), 48) ELSE title END,
        updated_at = now()
    WHERE id = p_thread_id;

    RETURN jsonb_build_object('ok', true, 'message_id', v_reply, 'refund', p_status = 'error',
                              'user_id', v_job.user_id, 'credits', v_job.credits);
END $$;

REVOKE ALL ON FUNCTION public.chat_complete_turn(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_complete_turn(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;
