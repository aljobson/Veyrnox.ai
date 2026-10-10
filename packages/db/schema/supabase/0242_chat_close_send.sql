-- A chat send can be asked about by its own key, and closed when it made no job (ADR-0067 amendment 11).
--
-- The browser makes a send's idempotency key before any request. When Stop comes before the reply's `start`, no job
-- id ever reaches it, and the request it gave up on can still be debited a moment later. So the chat kept a warning
-- ("If a reply is still saved, it will show in this chat and use Credits") that nothing could settle: "there is no job
-- for this key" was true now and could stop being true.
--
-- chat_close_send(auth, key) makes the answer final. In one step it either returns the job that send made, or records
-- the key in chat_closed_sends. From then on no chat job can be made for that person and key: a trigger on jobs
-- refuses the insert, which undoes the whole debit that was making it (ledger_debit and submit_free_job insert the
-- job before they write anything else, and a free allowance taken in the same call is undone with it).
-- The two cannot both happen for one key. Each takes the same per-key advisory lock first and holds it to the end of
-- its transaction, so whichever comes second sees what the first committed: a debit that came first is found by the
-- close, and a close that came first is seen by the trigger.
-- "Sees what the first committed" is READ COMMITTED, the level the API runs every call in and the one the ledger's
-- own lock-then-read functions are written for. chat_close_send says nothing under any other level, and no function
-- here or on the debit path sets one (scripts/test-chat-close-send.mjs holds that).
--
-- Only a chat reply's job is refused (0193 marks it `kind: chat` in its inputs, as 0233 reads it). Every other insert
-- into jobs passes untouched, whatever is in chat_closed_sends. A replay of a send that did make a job never reaches
-- the insert, so it is not affected either.
--
-- A closed key is kept for 30 days and at most 200 are kept per person. A request cannot arrive that late: it carries
-- an access token the gateway refuses once expired (Supabase allows a lifetime of 7 days at most), and the turn's
-- steps before the debit are bounded in seconds. Past 200, closing is refused and the browser's warning stays.
--
-- Additive, and safe to apply twice. Until a key is closed the trigger refuses nothing. Nothing calls
-- chat_close_send until the Worker's CHAT_SEND_CLOSE_ENABLED is "true".

CREATE TABLE IF NOT EXISTS public.chat_closed_sends (
    user_id         UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    idempotency_key TEXT        NOT NULL
        CHECK (idempotency_key ~ '^vx-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    closed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, idempotency_key)
);
ALTER TABLE public.chat_closed_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_closed_sends FORCE ROW LEVEL SECURITY;
-- No policy and no grant: only the two definer functions below read or write it.
REVOKE ALL ON TABLE public.chat_closed_sends FROM PUBLIC, anon, authenticated, service_role;

-- SECURITY DEFINER because it must read chat_closed_sends whoever inserts the job, and no role is granted that table.
CREATE OR REPLACE FUNCTION private.refuse_closed_chat_send() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NEW.inputs->>'kind' IS DISTINCT FROM 'chat' THEN RETURN NEW; END IF;
    -- The same lock chat_close_send takes for this person and key, held until this transaction ends.
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text || ':' || NEW.idempotency_key, 242));
    IF EXISTS (SELECT 1 FROM public.chat_closed_sends c
               WHERE c.user_id = NEW.user_id AND c.idempotency_key = NEW.idempotency_key) THEN
        RAISE EXCEPTION 'CHAT_SEND_CLOSED' USING ERRCODE = 'PT409';
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.refuse_closed_chat_send() FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                   WHERE tgname = 'jobs_refuse_closed_chat_send'
                     AND tgrelid = 'public.jobs'::regclass) THEN
        CREATE TRIGGER jobs_refuse_closed_chat_send
            BEFORE INSERT ON public.jobs
            FOR EACH ROW EXECUTE FUNCTION private.refuse_closed_chat_send();
    END IF;
END $$;

-- SECURITY DEFINER because the Worker's role is granted neither jobs nor chat_closed_sends: like get_user_job (0115),
-- it answers only for the caller's own rows, found from the verified auth id.
CREATE OR REPLACE FUNCTION public.chat_close_send(
    p_auth_id         TEXT,
    p_idempotency_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_rate    JSONB;
    v_job     public.jobs%ROWTYPE;
BEGIN
    -- Only a key in the shape the browser makes can be closed, so no key the server derives for its own jobs ever is.
    IF p_idempotency_key IS NULL
       OR p_idempotency_key !~ '^vx-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_KEY');
    END IF;

    -- After waiting for the lock below, this call must see a job the debit committed meanwhile. A snapshot taken
    -- before the wait would not, and "closed" would be said of a send that has a job.
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ISOLATION_LEVEL');
    END IF;

    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;

    -- The quota the job read uses (0115): this is a job read that can also write one small row.
    v_rate := public.consume_job_read_request(v_user_id);
    IF v_rate->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_rate; END IF;

    -- Wait for a debit that is making a job for this key right now, and keep one from starting until this call ends.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_idempotency_key, 242));

    -- The caller's own jobs only. Another person's key reads as one that made no job, whether it did or not.
    SELECT * INTO v_job FROM public.jobs
    WHERE user_id = v_user_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        RETURN jsonb_build_object(
            'ok', true, 'closed', false,
            'job_id', v_job.id,
            'state', v_job.state,
            'credits', v_job.credits,
            'model_id', v_job.model_id,
            'error_code', v_job.error_code
        );
    END IF;

    IF EXISTS (SELECT 1 FROM public.chat_closed_sends
               WHERE user_id = v_user_id AND idempotency_key = p_idempotency_key) THEN
        RETURN jsonb_build_object('ok', true, 'closed', true);
    END IF;

    DELETE FROM public.chat_closed_sends
    WHERE user_id = v_user_id AND closed_at < now() - interval '30 days';
    IF (SELECT count(*) FROM public.chat_closed_sends WHERE user_id = v_user_id) >= 200 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CLOSE_LIMIT');
    END IF;

    INSERT INTO public.chat_closed_sends (user_id, idempotency_key) VALUES (v_user_id, p_idempotency_key);
    RETURN jsonb_build_object('ok', true, 'closed', true);
END $$;

REVOKE ALL ON FUNCTION public.chat_close_send(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_close_send(TEXT, TEXT) TO service_role;
