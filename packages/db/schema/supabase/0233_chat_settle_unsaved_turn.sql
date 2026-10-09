-- A reply that was delivered is charged even when it cannot be stored (ADR-0067 amendment 9).
--
-- chat_complete_turn (0193) writes both messages and ends the job in one transaction, so when it answers that the
-- messages cannot be stored (the chat was deleted before the reply finished, or the text is refused) the job is left
-- SUBMITTED. Until now that turn ended uncharged. The person has the reply, so the job now ends charged:
-- chat_settle_unsaved_turn moves it SUBMITTED -> STORED and writes no message.
--
-- It never touches the ledger: the debit was taken when the turn started, and STORED is what keeps it (ledger_refund
-- refuses a STORED job and sweep_stuck_jobs does not select one). error_code records why the job has no messages.
-- Replaying it, or calling it for a job chat_complete_turn already finished, changes nothing.
-- A reply the provider cut off is refunded as before; the caller does not settle that one.
--
-- Additive and safe to apply twice. The Worker calls it only after this is applied; before that the call fails and
-- the turn ends as it did.
CREATE OR REPLACE FUNCTION public.chat_settle_unsaved_turn(p_job_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job public.jobs%ROWTYPE;
BEGIN
    SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
    IF NOT FOUND OR v_job.inputs->>'kind' IS DISTINCT FROM 'chat' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'JOB_NOT_FOUND');
    END IF;
    IF v_job.state = 'STORED' THEN
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'user_id', v_job.user_id, 'credits', v_job.credits);
    END IF;
    IF v_job.state <> 'SUBMITTED' THEN RETURN jsonb_build_object('ok', false, 'code', 'BAD_STATE'); END IF;

    UPDATE public.jobs SET state = 'STORED', error_code = 'reply_not_saved', updated_at = now() WHERE id = p_job_id;
    RETURN jsonb_build_object('ok', true, 'user_id', v_job.user_id, 'credits', v_job.credits);
END $$;

REVOKE ALL ON FUNCTION public.chat_settle_unsaved_turn(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_settle_unsaved_turn(UUID) TO service_role;
