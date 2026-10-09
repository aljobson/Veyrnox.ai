-- Chat image attachments (ADR-0068, accepted with the repository defaults). Images are a third priced option:
-- a reply with at least one image costs the row's base Credits plus chat_images_extra_credits. The extra is
-- flat per reply, sized for 4 images at the 2,048 px long edge the turn enforces, and carries its own recorded
-- worst-case cost under the same margin-floor CHECK as the other options.
--
-- Measured live on 2026-10-05, one image at 2,048 px (input tokens; 4,096 px in brackets where it differs):
--   claude sonnet/opus 5.5 4,781 (4,781)   gpt-6.1-sol 4,929   gpt-6-luna 4,929 (19,674: why the edge is capped)
--   grok-4.7 3,689 (3,689)   mistral-small 3,103   ministral-14b 3,091   llama-4-maverick 2,484
--   gemini-3.8-flash 1,096 (1,096)   deepseek-v4.1-flash 1,031 at 4,096 px
-- Worst case per image is that measure plus about 20%, rounded up to 100; four images; at the model's input rate:
--   claude-sonnet-5.5   5,800 x 4 x $2.00/M = $0.0464   3 Credits    claude-opus-5.5  5,800 x 4 x $4.00/M = $0.0928  6
--   gpt-6.1-sol         6,000 x 4 x $2.00/M = $0.0480   3             grok-4.7         4,500 x 4 x $2.00/M = $0.0360  3
--   gpt-6-luna          6,000 x 4 x $0.10/M = $0.0024   1             gemini-3.8-flash 1,400 x 4 x $0.75/M = $0.0042  1
--   deepseek-v4.1-flash 1,300 x 4 x $0.30/M = $0.00156 -> $0.0016 1   llama-4-maverick 3,000 x 4 x $0.19/M = $0.00228 -> $0.0023  1
--   mistral-small       3,800 x 4 x $0.15/M = $0.00228 -> $0.0023 1   ministral-14b    3,800 x 4 x $0.20/M = $0.00304 -> $0.0031  1
ALTER TABLE public.model_catalog
    ADD COLUMN IF NOT EXISTS chat_images_extra_credits INTEGER,
    ADD COLUMN IF NOT EXISTS chat_images_extra_cost NUMERIC(10, 4);

ALTER TABLE public.model_catalog DROP CONSTRAINT IF EXISTS model_catalog_chat_images_check;
ALTER TABLE public.model_catalog ADD CONSTRAINT model_catalog_chat_images_check CHECK (
    num_nonnulls(chat_images_extra_credits, chat_images_extra_cost) IN (0, 2)
    AND (chat_images_extra_credits IS NULL OR (chat_images_extra_credits >= 1 AND chat_images_extra_cost > 0
         AND chat_images_extra_credits >= ceil(chat_images_extra_cost / 0.01796)))
);
-- Text rows only: replace the 0197 rule so it covers the new columns too.
ALTER TABLE public.model_catalog DROP CONSTRAINT IF EXISTS model_catalog_chat_options_text_only_check;
ALTER TABLE public.model_catalog ADD CONSTRAINT model_catalog_chat_options_text_only_check CHECK (
    modality = 'text' OR num_nonnulls(chat_thinking_effort, chat_thinking_max_reply_tokens, chat_thinking_extra_credits,
        chat_thinking_extra_cost, chat_web_extra_credits, chat_web_extra_cost, chat_images_extra_credits, chat_images_extra_cost) = 0
);

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET chat_images_extra_credits = CASE id WHEN 'chat-claude-sonnet-5.5' THEN 3 WHEN 'chat-claude-opus-5.5' THEN 6
               WHEN 'chat-gpt-6.1-sol' THEN 3 WHEN 'chat-grok-4.7' THEN 3 ELSE 1 END,
           chat_images_extra_cost = CASE id WHEN 'chat-claude-sonnet-5.5' THEN 0.0464 WHEN 'chat-claude-opus-5.5' THEN 0.0928
               WHEN 'chat-gpt-6.1-sol' THEN 0.0480 WHEN 'chat-grok-4.7' THEN 0.0360 WHEN 'chat-gpt-6-luna' THEN 0.0024
               WHEN 'chat-gemini-3.8-flash' THEN 0.0042 WHEN 'chat-deepseek-v4.1-flash' THEN 0.0016
               WHEN 'chat-llama-4-maverick' THEN 0.0023 WHEN 'chat-mistral-small' THEN 0.0023 ELSE 0.0031 END,
           updated_at = now()
     WHERE id IN ('chat-claude-sonnet-5.5', 'chat-claude-opus-5.5', 'chat-gpt-6.1-sol', 'chat-grok-4.7', 'chat-gpt-6-luna',
                  'chat-gemini-3.8-flash', 'chat-deepseek-v4.1-flash', 'chat-llama-4-maverick', 'chat-mistral-small', 'chat-ministral-14b')
       AND provider = 'openrouter-chat';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 10 THEN
        RAISE EXCEPTION 'Expected ten chat rows to price Images on, updated %', affected;
    END IF;
END $$;

-- The thread read now carries each user message's attachment metadata (type and pixel size, never a file name
-- or a key), taken from the job that sent it. Files are swept within hours, so this is a record, not a link.
CREATE OR REPLACE FUNCTION public.chat_get_thread(p_auth_id TEXT, p_thread_id UUID, p_message_limit INTEGER DEFAULT 200)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_thread public.chat_threads%ROWTYPE; v_msgs JSONB;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    SELECT * INTO v_thread FROM public.chat_threads WHERE id = p_thread_id AND user_id = v_user AND deleted_at IS NULL;
    IF v_user IS NULL OR NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'THREAD_NOT_FOUND'); END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'role', m.role, 'content', m.content, 'credits', m.credits,
        'status', m.status, 'created_at', m.created_at,
        'attachments', CASE WHEN m.role = 'user' AND jsonb_typeof(m.job_inputs->'attachments') = 'array'
                            THEN m.job_inputs->'attachments' ELSE '[]'::jsonb END) ORDER BY m.seq), '[]'::jsonb)
    INTO v_msgs FROM (
        SELECT cm.*, j.inputs AS job_inputs
        FROM public.chat_messages cm LEFT JOIN public.jobs j ON j.id = cm.job_id
        WHERE cm.thread_id = p_thread_id
        ORDER BY cm.seq DESC LIMIT LEAST(GREATEST(COALESCE(p_message_limit, 200), 1), 500)
    ) m;
    RETURN jsonb_build_object('ok', true,
        'thread', jsonb_build_object('id', v_thread.id, 'model_id', v_thread.model_id, 'title', v_thread.title,
            'system_prompt', v_thread.system_prompt, 'pinned', v_thread.pinned, 'updated_at', v_thread.updated_at),
        'messages', v_msgs);
END $$;

REVOKE ALL ON FUNCTION public.chat_get_thread(TEXT, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_get_thread(TEXT, UUID, INTEGER) TO service_role;
