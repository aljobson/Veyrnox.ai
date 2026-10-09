-- Chat history budget (ADR-0067): the newest message always reaches the model.
--
-- chat_turn_context kept the messages whose running total of characters (newest first) fit the budget. A newest message longer than
-- the budget alone pushed the total over it, and every older message's total is larger still, so the model got no history at all.
-- That needs a reply over 24,000 characters, which a row with a high reply cap (Thinking, Deep research) can write.
--
-- Now each message counts for at most the budget, and one longer than that is cut to its last <budget> characters. The newest message
-- therefore always fits; older ones still go in only while the total stays within the budget. A budget of 0 still returns nothing.
-- Same signature as 0193, so the grants stay; they are repeated below as the project asks.

CREATE OR REPLACE FUNCTION public.chat_turn_context(p_auth_id TEXT, p_thread_id UUID, p_history_chars INTEGER)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_thread public.chat_threads%ROWTYPE; v_hist JSONB; v_budget INTEGER := GREATEST(COALESCE(p_history_chars, 0), 0);
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    SELECT * INTO v_thread FROM public.chat_threads WHERE id = p_thread_id AND user_id = v_user AND deleted_at IS NULL;
    IF v_user IS NULL OR NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'THREAD_NOT_FOUND'); END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('role', m.role, 'content', m.content) ORDER BY m.seq), '[]'::jsonb)
    INTO v_hist FROM (
        SELECT role, seq,
               CASE WHEN length(content) > v_budget THEN right(content, v_budget) ELSE content END AS content,
               sum(least(length(content), v_budget)) OVER (ORDER BY seq DESC) AS running
        FROM public.chat_messages WHERE thread_id = p_thread_id AND status IN ('complete', 'canceled')
    ) m WHERE v_budget > 0 AND m.running <= v_budget;
    RETURN jsonb_build_object('ok', true, 'user_id', v_user, 'model_id', v_thread.model_id,
        'system_prompt', v_thread.system_prompt, 'history', v_hist);
END $$;

REVOKE ALL ON FUNCTION public.chat_turn_context(TEXT, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_turn_context(TEXT, UUID, INTEGER) TO service_role;
