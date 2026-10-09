-- Chat (ADR-0067). A reply is a job priced per reply from model_catalog (text rows use
-- credits_5s as "Credits per reply"). Behind CHAT_ENABLED; no text model is inserted here.
-- Tables are reachable only through the SECURITY DEFINER functions below, keyed by p_auth_id.

CREATE TABLE IF NOT EXISTS public.chat_threads (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    model_id      TEXT        NOT NULL,
    title         TEXT        NOT NULL DEFAULT 'New chat' CHECK (length(title) BETWEEN 1 AND 120),
    system_prompt TEXT        NOT NULL DEFAULT '' CHECK (length(system_prompt) <= 4000),
    pinned        BOOLEAN     NOT NULL DEFAULT false,
    deleted_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_threads_user_idx
    ON public.chat_threads(user_id, pinned DESC, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.chat_messages (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Message order. created_at cannot do this: a turn writes both its messages in one transaction,
    -- so they would share a timestamp and sort at random.
    seq        BIGINT      GENERATED ALWAYS AS IDENTITY,
    thread_id  UUID        NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
    role       TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
    content    TEXT        NOT NULL CHECK (length(content) BETWEEN 1 AND 32000),
    model_id   TEXT,
    job_id     UUID        REFERENCES public.jobs(id) ON DELETE SET NULL,
    credits    INTEGER     NOT NULL DEFAULT 0 CHECK (credits >= 0),
    status     TEXT        NOT NULL DEFAULT 'complete' CHECK (status IN ('complete', 'canceled', 'error')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_thread_idx ON public.chat_messages(thread_id, seq);
-- One user message and one reply per job: the replay guard for chat_complete_turn.
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_job_role_idx ON public.chat_messages(job_id, role) WHERE job_id IS NOT NULL;

ALTER TABLE public.chat_threads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_threads  FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_threads  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.chat_messages FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.chat_create_thread(p_auth_id TEXT, p_model_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_thread public.chat_threads%ROWTYPE;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    IF NOT EXISTS (SELECT 1 FROM public.model_catalog WHERE id = p_model_id AND active AND modality = 'text') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'MODEL_NOT_FOUND');
    END IF;
    IF (SELECT count(*) FROM public.chat_threads WHERE user_id = v_user AND deleted_at IS NULL) >= 500 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'THREAD_LIMIT');
    END IF;
    INSERT INTO public.chat_threads (user_id, model_id) VALUES (v_user, p_model_id) RETURNING * INTO v_thread;
    RETURN jsonb_build_object('ok', true, 'thread', jsonb_build_object('id', v_thread.id, 'model_id', v_thread.model_id,
        'title', v_thread.title, 'system_prompt', v_thread.system_prompt, 'pinned', v_thread.pinned, 'updated_at', v_thread.updated_at));
END $$;

CREATE OR REPLACE FUNCTION public.chat_list_threads(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_rows JSONB;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', true, 'threads', '[]'::jsonb); END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'model_id', t.model_id, 'title', t.title,
        'pinned', t.pinned, 'updated_at', t.updated_at) ORDER BY t.pinned DESC, t.updated_at DESC, t.id), '[]'::jsonb)
    INTO v_rows FROM (
        SELECT * FROM public.chat_threads WHERE user_id = v_user AND deleted_at IS NULL
        ORDER BY pinned DESC, updated_at DESC, id LIMIT 200
    ) t;
    RETURN jsonb_build_object('ok', true, 'threads', v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.chat_get_thread(p_auth_id TEXT, p_thread_id UUID, p_message_limit INTEGER DEFAULT 200)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_thread public.chat_threads%ROWTYPE; v_msgs JSONB;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    SELECT * INTO v_thread FROM public.chat_threads WHERE id = p_thread_id AND user_id = v_user AND deleted_at IS NULL;
    IF v_user IS NULL OR NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'THREAD_NOT_FOUND'); END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'role', m.role, 'content', m.content, 'credits', m.credits,
        'status', m.status, 'created_at', m.created_at) ORDER BY m.seq), '[]'::jsonb)
    INTO v_msgs FROM (
        SELECT * FROM public.chat_messages WHERE thread_id = p_thread_id
        ORDER BY seq DESC LIMIT LEAST(GREATEST(COALESCE(p_message_limit, 200), 1), 500)
    ) m;
    RETURN jsonb_build_object('ok', true,
        'thread', jsonb_build_object('id', v_thread.id, 'model_id', v_thread.model_id, 'title', v_thread.title,
            'system_prompt', v_thread.system_prompt, 'pinned', v_thread.pinned, 'updated_at', v_thread.updated_at),
        'messages', v_msgs);
END $$;

-- What the route needs to run one turn: who, which model, the instructions, and as much recent history
-- as fits the character budget (newest messages first into the budget, returned oldest first).
-- Replies that were refunded (status 'error') are not sent back to the model.
CREATE OR REPLACE FUNCTION public.chat_turn_context(p_auth_id TEXT, p_thread_id UUID, p_history_chars INTEGER)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_thread public.chat_threads%ROWTYPE; v_hist JSONB;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    SELECT * INTO v_thread FROM public.chat_threads WHERE id = p_thread_id AND user_id = v_user AND deleted_at IS NULL;
    IF v_user IS NULL OR NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'THREAD_NOT_FOUND'); END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('role', m.role, 'content', m.content) ORDER BY m.seq), '[]'::jsonb)
    INTO v_hist FROM (
        SELECT role, content, seq,
               sum(length(content)) OVER (ORDER BY seq DESC) AS running
        FROM public.chat_messages WHERE thread_id = p_thread_id AND status IN ('complete', 'canceled')
    ) m WHERE m.running <= GREATEST(COALESCE(p_history_chars, 0), 0);
    RETURN jsonb_build_object('ok', true, 'user_id', v_user, 'model_id', v_thread.model_id,
        'system_prompt', v_thread.system_prompt, 'history', v_hist);
END $$;

CREATE OR REPLACE FUNCTION public.chat_update_thread(p_auth_id TEXT, p_thread_id UUID, p_title TEXT DEFAULT NULL,
    p_pinned BOOLEAN DEFAULT NULL, p_system_prompt TEXT DEFAULT NULL, p_model_id TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_title TEXT := btrim(p_title); v_thread public.chat_threads%ROWTYPE;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL OR NOT EXISTS (SELECT 1 FROM public.chat_threads WHERE id = p_thread_id AND user_id = v_user AND deleted_at IS NULL) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'THREAD_NOT_FOUND');
    END IF;
    IF (p_title IS NOT NULL AND (length(v_title) NOT BETWEEN 1 AND 120))
       OR (p_system_prompt IS NOT NULL AND length(p_system_prompt) > 4000) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    END IF;
    IF p_model_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.model_catalog WHERE id = p_model_id AND active AND modality = 'text') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'MODEL_NOT_FOUND');
    END IF;
    UPDATE public.chat_threads SET
        title = COALESCE(v_title, title), pinned = COALESCE(p_pinned, pinned),
        system_prompt = COALESCE(p_system_prompt, system_prompt), model_id = COALESCE(p_model_id, model_id),
        updated_at = now()
    WHERE id = p_thread_id AND user_id = v_user RETURNING * INTO v_thread;
    RETURN jsonb_build_object('ok', true, 'thread', jsonb_build_object('id', v_thread.id, 'model_id', v_thread.model_id,
        'title', v_thread.title, 'system_prompt', v_thread.system_prompt, 'pinned', v_thread.pinned, 'updated_at', v_thread.updated_at));
END $$;

CREATE OR REPLACE FUNCTION public.chat_delete_thread(p_auth_id TEXT, p_thread_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_n INTEGER;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    UPDATE public.chat_threads SET deleted_at = now(), updated_at = now()
    WHERE id = p_thread_id AND user_id = v_user AND deleted_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_user IS NULL OR v_n = 0 THEN RETURN jsonb_build_object('ok', false, 'code', 'THREAD_NOT_FOUND'); END IF;
    RETURN jsonb_build_object('ok', true);
END $$;

-- Finish a turn: both messages and the job's end state in one transaction (ADR-0067 points 4 and 5).
--   complete | canceled -> job SUBMITTED -> STORED. The user keeps the text and was charged.
--   error               -> job SUBMITTED -> FAILED, text kept, and the caller must now ledger_refund
--                          (the reply came back as {refund: true, credits}).
-- A reply with no text at all is not handled here: the caller uses job_failed and ledger_refund.
-- Replaying the same job returns the first result and writes nothing.
CREATE OR REPLACE FUNCTION public.chat_complete_turn(p_job_id UUID, p_thread_id UUID, p_user_text TEXT, p_reply TEXT, p_status TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job public.jobs%ROWTYPE; v_thread public.chat_threads%ROWTYPE; v_reply UUID;
BEGIN
    IF p_status IS NULL OR p_status NOT IN ('complete', 'canceled', 'error') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
    END IF;
    IF p_user_text IS NULL OR length(btrim(p_user_text)) = 0 OR length(p_user_text) > 8000 THEN
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

-- The Library lists media. A chat reply is a job without an asset, so it is kept out of the list.
CREATE OR REPLACE FUNCTION public.list_user_jobs(
    p_auth_id TEXT, p_limit INTEGER DEFAULT 24, p_before_created_at TIMESTAMPTZ DEFAULT NULL, p_before_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_rate JSONB;
    v_user_id UUID;
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 24), 1), 50);
    v_rows JSONB;
BEGIN
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', true, 'jobs', '[]'::jsonb);
    END IF;

    v_rate := public.consume_job_read_request(v_user_id);
    IF v_rate->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_rate; END IF;

    SELECT COALESCE(jsonb_agg(j ORDER BY j.created_at DESC, j.id DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
        SELECT jsonb_build_object(
                   'job_id', b.id,
                   'state', b.state,
                   'credits', b.credits,
                   'model_id', b.model_id,
                   'error_code', b.error_code,
                   'created_at', b.created_at,
                   'label', left(COALESCE(b.inputs->>'prompt', b.inputs->>'topic', ''), 60),
                   'asset_expires_at', (SELECT min(a.expires_at) FROM public.assets a WHERE a.job_id = b.id),
                   'has_asset', EXISTS (SELECT 1 FROM public.assets a WHERE a.job_id = b.id)
               ) AS j,
               b.created_at,
               b.id
        FROM public.jobs b
        WHERE b.user_id = v_user_id
          AND b.inputs->>'kind' IS DISTINCT FROM 'chat'
          AND (p_before_created_at IS NULL
               OR (b.created_at, b.id) < (p_before_created_at, COALESCE(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid)))
        ORDER BY b.created_at DESC, b.id DESC
        LIMIT v_limit
    ) j;

    RETURN jsonb_build_object('ok', true, 'jobs', v_rows);
END $$;

DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.chat_create_thread(TEXT, TEXT)',
        'public.chat_list_threads(TEXT)',
        'public.chat_get_thread(TEXT, UUID, INTEGER)',
        'public.chat_turn_context(TEXT, UUID, INTEGER)',
        'public.chat_update_thread(TEXT, UUID, TEXT, BOOLEAN, TEXT, TEXT)',
        'public.chat_delete_thread(TEXT, UUID)',
        'public.chat_complete_turn(UUID, UUID, TEXT, TEXT, TEXT)',
        'public.list_user_jobs(TEXT, INTEGER, TIMESTAMPTZ, UUID)'
    ]
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END $$;
