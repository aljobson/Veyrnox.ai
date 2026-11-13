-- Private Music Library organization: one default workspace per owner,
-- idempotent personal workspace creation, and atomic revision-checked moves.

CREATE TABLE IF NOT EXISTS public.music_workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    is_default BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    idempotency_key TEXT CHECK (
        idempotency_key IS NULL OR idempotency_key ~ '^[A-Za-z0-9._-]{8,120}$'
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS music_workspaces_one_default_idx
    ON public.music_workspaces(user_id) WHERE is_default;
CREATE UNIQUE INDEX IF NOT EXISTS music_workspaces_active_name_idx
    ON public.music_workspaces(user_id, lower(name)) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS music_workspaces_user_created_idx
    ON public.music_workspaces(user_id, created_at, id);

ALTER TABLE public.music_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_workspaces FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS music_workspaces_owner_read ON public.music_workspaces;
CREATE POLICY music_workspaces_owner_read ON public.music_workspaces
    FOR SELECT TO authenticated USING (private.music_owns_user(user_id));
REVOKE ALL ON TABLE public.music_workspaces FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.music_workspaces TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.music_workspaces TO service_role;

-- Durable receipts make an ambiguous browser retry converge on the first
-- committed move instead of applying it again or surfacing a stale revision.
CREATE TABLE IF NOT EXISTS public.music_workspace_moves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._-]{8,120}$'),
    destination_workspace_id UUID NOT NULL REFERENCES public.music_workspaces(id) ON DELETE RESTRICT,
    items JSONB NOT NULL CHECK (jsonb_typeof(items) = 'array'),
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, idempotency_key)
);
ALTER TABLE public.music_workspace_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_workspace_moves FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.music_workspace_moves FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.music_workspace_moves TO service_role;

CREATE OR REPLACE FUNCTION private.music_ensure_default_workspace(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_workspace UUID;
BEGIN
    SELECT id INTO v_workspace FROM public.music_workspaces
    WHERE user_id = p_user_id AND is_default AND status = 'active';
    IF v_workspace IS NOT NULL THEN RETURN v_workspace; END IF;
    BEGIN
        INSERT INTO public.music_workspaces(user_id, name, is_default)
        VALUES (p_user_id, 'My Workspace', true) RETURNING id INTO v_workspace;
    EXCEPTION WHEN unique_violation THEN
        SELECT id INTO v_workspace FROM public.music_workspaces
        WHERE user_id = p_user_id AND is_default AND status = 'active';
    END;
    RETURN v_workspace;
END $$;
REVOKE ALL ON FUNCTION private.music_ensure_default_workspace(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.music_ensure_default_workspace(UUID) TO service_role;

ALTER TABLE public.music_songs ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE public.music_songs ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION private.music_assign_default_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NEW.workspace_id IS NULL THEN
        NEW.workspace_id := private.music_ensure_default_workspace(NEW.user_id);
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS music_song_default_workspace ON public.music_songs;
CREATE TRIGGER music_song_default_workspace
BEFORE INSERT ON public.music_songs
FOR EACH ROW EXECUTE FUNCTION private.music_assign_default_workspace();

DO $$
DECLARE v_user UUID;
BEGIN
    FOR v_user IN SELECT DISTINCT user_id FROM public.music_songs LOOP
        PERFORM private.music_ensure_default_workspace(v_user);
    END LOOP;
END $$;
UPDATE public.music_songs s SET workspace_id = private.music_ensure_default_workspace(s.user_id)
WHERE workspace_id IS NULL;
ALTER TABLE public.music_songs ALTER COLUMN workspace_id SET NOT NULL;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'music_songs_workspace_fk') THEN
        ALTER TABLE public.music_songs ADD CONSTRAINT music_songs_workspace_fk
            FOREIGN KEY (workspace_id) REFERENCES public.music_workspaces(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'music_songs_revision_nonnegative') THEN
        ALTER TABLE public.music_songs ADD CONSTRAINT music_songs_revision_nonnegative CHECK (revision >= 0);
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS music_songs_workspace_created_idx
    ON public.music_songs(user_id, workspace_id, status, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.music_list_workspaces(p_auth_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_rows JSONB;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', true, 'workspaces', '[]'::jsonb); END IF;
    PERFORM private.music_ensure_default_workspace(v_user);
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', w.id, 'name', w.name, 'is_default', w.is_default, 'revision', w.revision,
        'song_count', (SELECT count(*) FROM public.music_songs s
            WHERE s.user_id = v_user AND s.workspace_id = w.id AND s.status = 'active'),
        'created_at', w.created_at, 'updated_at', w.updated_at
    ) ORDER BY w.is_default DESC, lower(w.name), w.id), '[]'::jsonb)
    INTO v_rows FROM public.music_workspaces w
    WHERE w.user_id = v_user AND w.status = 'active';
    RETURN jsonb_build_object('ok', true, 'workspaces', v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.music_create_workspace(
    p_auth_id TEXT,
    p_name TEXT,
    p_idempotency_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_name TEXT := btrim(p_name); v_workspace public.music_workspaces%ROWTYPE;
BEGIN
    IF v_name IS NULL OR char_length(v_name) NOT BETWEEN 1 AND 80
       OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    PERFORM private.music_ensure_default_workspace(v_user);
    SELECT * INTO v_workspace FROM public.music_workspaces
    WHERE user_id = v_user AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_workspace.name IS DISTINCT FROM v_name THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
        END IF;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'workspace', jsonb_build_object(
            'id', v_workspace.id, 'name', v_workspace.name, 'is_default', v_workspace.is_default,
            'revision', v_workspace.revision, 'song_count', 0,
            'created_at', v_workspace.created_at, 'updated_at', v_workspace.updated_at
        ));
    END IF;
    IF (SELECT count(*) FROM public.music_workspaces WHERE user_id = v_user AND status = 'active') >= 50 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'LIMIT_REACHED');
    END IF;
    BEGIN
        INSERT INTO public.music_workspaces(user_id, name, idempotency_key)
        VALUES (v_user, v_name, p_idempotency_key) RETURNING * INTO v_workspace;
    EXCEPTION WHEN unique_violation THEN
        -- A concurrent retry can lose the insert race after the optimistic
        -- idempotency lookup above. Resolve that exact key before treating the
        -- violation as a distinct-name collision.
        SELECT * INTO v_workspace FROM public.music_workspaces
        WHERE user_id = v_user AND idempotency_key = p_idempotency_key;
        IF FOUND THEN
            IF v_workspace.name IS DISTINCT FROM v_name THEN
                RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
            END IF;
            RETURN jsonb_build_object('ok', true, 'idempotent', true, 'workspace', jsonb_build_object(
                'id', v_workspace.id, 'name', v_workspace.name, 'is_default', v_workspace.is_default,
                'revision', v_workspace.revision, 'song_count', 0,
                'created_at', v_workspace.created_at, 'updated_at', v_workspace.updated_at
            ));
        END IF;
        RETURN jsonb_build_object('ok', false, 'code', 'NAME_TAKEN');
    END;
    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'workspace', jsonb_build_object(
        'id', v_workspace.id, 'name', v_workspace.name, 'is_default', v_workspace.is_default,
        'revision', v_workspace.revision, 'song_count', 0,
        'created_at', v_workspace.created_at, 'updated_at', v_workspace.updated_at
    ));
END $$;

CREATE OR REPLACE FUNCTION public.music_library_songs(
    p_auth_id TEXT,
    p_workspace_id UUID DEFAULT NULL,
    p_query TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 50
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID;
    v_rows JSONB;
    v_query TEXT := btrim(COALESCE(p_query, ''));
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 50);
BEGIN
    IF char_length(v_query) > 100 THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS'); END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', true, 'songs', '[]'::jsonb); END IF;
    PERFORM private.music_ensure_default_workspace(v_user);
    IF p_workspace_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.music_workspaces
        WHERE id = p_workspace_id AND user_id = v_user AND status = 'active'
    ) THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    SELECT COALESCE(jsonb_agg(x.song ORDER BY x.created_at DESC, x.id DESC), '[]'::jsonb) INTO v_rows
    FROM (
        SELECT s.id, s.created_at, jsonb_build_object(
            'id', s.id, 'title', s.title, 'visibility', s.visibility,
            'workspace_id', s.workspace_id, 'workspace_name', w.name,
            'revision', s.revision, 'created_at', s.created_at,
            'version_id', v.id, 'job_id', v.job_id,
            'audio_url', '/api/v1/jobs/' || v.job_id || '/asset', 'status', 'ready'
        ) AS song
        FROM public.music_songs s
        JOIN public.music_song_versions v ON v.id = s.current_version_id
        JOIN public.music_workspaces w ON w.id = s.workspace_id
        WHERE s.user_id = v_user AND s.status = 'active'
          AND (p_workspace_id IS NULL OR s.workspace_id = p_workspace_id)
          AND (v_query = '' OR position(lower(v_query) in lower(s.title)) > 0)
        ORDER BY s.created_at DESC, s.id DESC LIMIT v_limit
    ) x;
    RETURN jsonb_build_object('ok', true, 'songs', v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.music_move_songs(
    p_auth_id TEXT,
    p_destination_workspace_id UUID,
    p_items JSONB,
    p_idempotency_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID;
    v_count INTEGER;
    v_owned INTEGER;
    v_matching INTEGER;
    v_rows JSONB;
    v_result JSONB;
    v_move public.music_workspace_moves%ROWTYPE;
BEGIN
    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) item
        WHERE jsonb_typeof(item) <> 'object'
           OR NOT (item ? 'id' AND item ? 'revision')
           OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 2
           OR (item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           OR (item->>'revision') !~ '^[0-9]{1,10}$'
           OR (item->>'revision')::bigint > 2147483647
    ) THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS'); END IF;
    SELECT count(*), count(DISTINCT item->>'id') INTO v_count, v_owned
    FROM jsonb_array_elements(p_items) item;
    IF v_count <> v_owned THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS'); END IF;

    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.music_workspaces
        WHERE id = p_destination_workspace_id AND user_id = v_user AND status = 'active'
    ) THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;

    SELECT * INTO v_move FROM public.music_workspace_moves
    WHERE user_id = v_user AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_move.destination_workspace_id IS DISTINCT FROM p_destination_workspace_id
           OR v_move.items IS DISTINCT FROM p_items THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
        END IF;
        RETURN COALESCE(v_move.result, jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT'))
            || jsonb_build_object('idempotent', true);
    END IF;

    PERFORM s.id FROM public.music_songs s
    JOIN jsonb_array_elements(p_items) item ON s.id = (item->>'id')::uuid
    WHERE s.user_id = v_user AND s.status = 'active' ORDER BY s.id FOR UPDATE;
    SELECT count(*) INTO v_owned FROM public.music_songs s
    JOIN jsonb_array_elements(p_items) item ON s.id = (item->>'id')::uuid
    WHERE s.user_id = v_user AND s.status = 'active';
    IF v_owned <> v_count THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;

    -- The row locks above serialize retries for the same owned songs. Recheck
    -- after waiting, before stale revisions can disguise a completed retry.
    SELECT * INTO v_move FROM public.music_workspace_moves
    WHERE user_id = v_user AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_move.destination_workspace_id IS DISTINCT FROM p_destination_workspace_id
           OR v_move.items IS DISTINCT FROM p_items THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
        END IF;
        RETURN COALESCE(v_move.result, jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT'))
            || jsonb_build_object('idempotent', true);
    END IF;

    SELECT count(*) INTO v_matching FROM public.music_songs s
    JOIN jsonb_array_elements(p_items) item ON s.id = (item->>'id')::uuid
    WHERE s.user_id = v_user AND s.status = 'active'
      AND s.revision = (item->>'revision')::integer;
    IF v_matching <> v_count THEN RETURN jsonb_build_object('ok', false, 'code', 'REVISION_CONFLICT'); END IF;

    -- Reserve the key before changing any song. A same-key request over a
    -- disjoint set races here rather than at the data mutation.
    BEGIN
        INSERT INTO public.music_workspace_moves(
            user_id, idempotency_key, destination_workspace_id, items
        ) VALUES (
            v_user, p_idempotency_key, p_destination_workspace_id, p_items
        ) RETURNING * INTO v_move;
    EXCEPTION WHEN unique_violation THEN
        SELECT * INTO v_move FROM public.music_workspace_moves
        WHERE user_id = v_user AND idempotency_key = p_idempotency_key;
        IF v_move.destination_workspace_id IS DISTINCT FROM p_destination_workspace_id
           OR v_move.items IS DISTINCT FROM p_items THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
        END IF;
        RETURN COALESCE(v_move.result, jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT'))
            || jsonb_build_object('idempotent', true);
    END;

    UPDATE public.music_songs s
    SET workspace_id = p_destination_workspace_id, revision = s.revision + 1, updated_at = now()
    FROM jsonb_array_elements(p_items) item
    WHERE s.id = (item->>'id')::uuid AND s.user_id = v_user;
    SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'workspace_id', s.workspace_id, 'revision', s.revision
    ) ORDER BY s.id) INTO v_rows
    FROM public.music_songs s
    JOIN jsonb_array_elements(p_items) item ON s.id = (item->>'id')::uuid
    WHERE s.user_id = v_user;
    v_result := jsonb_build_object('ok', true, 'idempotent', false, 'moved', v_count, 'songs', v_rows);
    UPDATE public.music_workspace_moves SET result = v_result WHERE id = v_move.id;
    RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.music_list_workspaces(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.music_create_workspace(TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.music_library_songs(TEXT,UUID,TEXT,INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.music_move_songs(TEXT,UUID,JSONB,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_list_workspaces(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_create_workspace(TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_library_songs(TEXT,UUID,TEXT,INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_move_songs(TEXT,UUID,JSONB,TEXT) TO service_role;
