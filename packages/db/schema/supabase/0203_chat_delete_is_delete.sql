-- Deleting a chat now deletes it. Until now chat_delete_thread only set deleted_at, so the text of a "deleted" chat stayed
-- in the database indefinitely (until the whole account was deleted) while the screen said "Delete this chat?" and the
-- privacy notice promises deletion. The thread row is removed and its messages go with it (ON DELETE CASCADE). The job and
-- its ledger entry stay: they are the money record, and a chat job never holds message text (chat_messages.job_id is
-- ON DELETE SET NULL, and the job row keeps only the model, the options and the credits).
CREATE OR REPLACE FUNCTION public.chat_delete_thread(p_auth_id TEXT, p_thread_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_n INTEGER;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    DELETE FROM public.chat_threads WHERE id = p_thread_id AND user_id = v_user;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_user IS NULL OR v_n = 0 THEN RETURN jsonb_build_object('ok', false, 'code', 'THREAD_NOT_FOUND'); END IF;
    RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.chat_delete_thread(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_delete_thread(TEXT, UUID) TO service_role;

-- Chats that were only hidden before this change go now. Safe to run again: it matches nothing once they are gone.
DELETE FROM public.chat_threads WHERE deleted_at IS NOT NULL;
