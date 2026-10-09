-- Chat folders (ADR-0067 amendment 5). A folder groups a person's chats. It has a name and nothing else: no shared
-- instructions, no files. Deleting a folder keeps its chats and unfiles them. A person can have fifty, with names unique
-- ignoring case. Like the chat tables, the folder table is reachable only through the definer functions below, keyed by the
-- verified auth id, and it goes with the account (ON DELETE CASCADE).

CREATE TABLE IF NOT EXISTS public.chat_folders (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name       TEXT        NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_folders_user_name_idx ON public.chat_folders(user_id, lower(name));

ALTER TABLE public.chat_threads
    ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES public.chat_folders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS chat_threads_folder_idx ON public.chat_threads(folder_id) WHERE folder_id IS NOT NULL;

ALTER TABLE public.chat_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_folders FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_folders FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.chat_list_folders(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_rows JSONB;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', true, 'folders', '[]'::jsonb); END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name,
        'count', (SELECT count(*) FROM public.chat_threads t WHERE t.folder_id = f.id AND t.deleted_at IS NULL))
        ORDER BY lower(f.name), f.id), '[]'::jsonb)
    INTO v_rows FROM public.chat_folders f WHERE f.user_id = v_user;
    RETURN jsonb_build_object('ok', true, 'folders', v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.chat_create_folder(p_auth_id TEXT, p_name TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_name TEXT := btrim(p_name); v_folder public.chat_folders%ROWTYPE;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    IF v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 60 THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT'); END IF;
    IF (SELECT count(*) FROM public.chat_folders WHERE user_id = v_user) >= 50 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'FOLDER_LIMIT');
    END IF;
    BEGIN
        INSERT INTO public.chat_folders (user_id, name) VALUES (v_user, v_name) RETURNING * INTO v_folder;
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('ok', false, 'code', 'FOLDER_EXISTS');
    END;
    RETURN jsonb_build_object('ok', true, 'folder', jsonb_build_object('id', v_folder.id, 'name', v_folder.name, 'count', 0));
END $$;

CREATE OR REPLACE FUNCTION public.chat_rename_folder(p_auth_id TEXT, p_folder_id UUID, p_name TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_name TEXT := btrim(p_name); v_folder public.chat_folders%ROWTYPE;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL OR NOT EXISTS (SELECT 1 FROM public.chat_folders WHERE id = p_folder_id AND user_id = v_user) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'FOLDER_NOT_FOUND');
    END IF;
    IF v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 60 THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT'); END IF;
    BEGIN
        UPDATE public.chat_folders SET name = v_name, updated_at = now()
        WHERE id = p_folder_id AND user_id = v_user RETURNING * INTO v_folder;
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('ok', false, 'code', 'FOLDER_EXISTS');
    END;
    RETURN jsonb_build_object('ok', true, 'folder', jsonb_build_object('id', v_folder.id, 'name', v_folder.name,
        'count', (SELECT count(*) FROM public.chat_threads t WHERE t.folder_id = v_folder.id AND t.deleted_at IS NULL)));
END $$;

-- The chats stay: the foreign key on chat_threads.folder_id sets them to no folder.
CREATE OR REPLACE FUNCTION public.chat_delete_folder(p_auth_id TEXT, p_folder_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_n INTEGER;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    DELETE FROM public.chat_folders WHERE id = p_folder_id AND user_id = v_user;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_user IS NULL OR v_n = 0 THEN RETURN jsonb_build_object('ok', false, 'code', 'FOLDER_NOT_FOUND'); END IF;
    RETURN jsonb_build_object('ok', true);
END $$;

-- p_folder_id NULL takes the chat out of its folder. Moving a chat does not change its place in the recency order.
CREATE OR REPLACE FUNCTION public.chat_move_thread(p_auth_id TEXT, p_thread_id UUID, p_folder_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL OR NOT EXISTS (SELECT 1 FROM public.chat_threads WHERE id = p_thread_id AND user_id = v_user AND deleted_at IS NULL) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'THREAD_NOT_FOUND');
    END IF;
    IF p_folder_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.chat_folders WHERE id = p_folder_id AND user_id = v_user) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'FOLDER_NOT_FOUND');
    END IF;
    UPDATE public.chat_threads SET folder_id = p_folder_id WHERE id = p_thread_id AND user_id = v_user;
    RETURN jsonb_build_object('ok', true);
END $$;

-- The thread list now says which folder each chat is in.
CREATE OR REPLACE FUNCTION public.chat_list_threads(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_rows JSONB;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', true, 'threads', '[]'::jsonb); END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'model_id', t.model_id, 'title', t.title,
        'pinned', t.pinned, 'folder_id', t.folder_id, 'updated_at', t.updated_at)
        ORDER BY t.pinned DESC, t.updated_at DESC, t.id), '[]'::jsonb)
    INTO v_rows FROM (
        SELECT * FROM public.chat_threads WHERE user_id = v_user AND deleted_at IS NULL
        ORDER BY pinned DESC, updated_at DESC, id LIMIT 200
    ) t;
    RETURN jsonb_build_object('ok', true, 'threads', v_rows);
END $$;

REVOKE ALL ON FUNCTION public.chat_list_folders(TEXT)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_create_folder(TEXT, TEXT)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_rename_folder(TEXT, UUID, TEXT)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_delete_folder(TEXT, UUID)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_move_thread(TEXT, UUID, UUID)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_list_threads(TEXT)                  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_list_folders(TEXT)               TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_create_folder(TEXT, TEXT)        TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_rename_folder(TEXT, UUID, TEXT)  TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_delete_folder(TEXT, UUID)        TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_move_thread(TEXT, UUID, UUID)    TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_list_threads(TEXT)               TO service_role;
