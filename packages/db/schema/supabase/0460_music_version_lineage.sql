-- Immutable Music version history and owner-scoped source lineage.
-- No transformation is enabled here; this migration only makes existing and
-- future version relationships explicit and readable by the private detail UI.

ALTER TABLE public.music_song_versions
    ADD COLUMN IF NOT EXISTS operation TEXT NOT NULL DEFAULT 'generation';
ALTER TABLE public.music_song_versions
    ADD COLUMN IF NOT EXISTS parent_version_id UUID;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'music_song_versions_operation_check') THEN
        ALTER TABLE public.music_song_versions ADD CONSTRAINT music_song_versions_operation_check
            CHECK (operation IN (
                'generation','cover','extend','speed','reuse','crop','replace_section',
                'add_section','remaster','lyric_edit'
            ));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'music_song_versions_parent_not_self') THEN
        ALTER TABLE public.music_song_versions ADD CONSTRAINT music_song_versions_parent_not_self
            CHECK (parent_version_id IS NULL OR parent_version_id <> id);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS music_songs_id_user_unique_idx
    ON public.music_songs(id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS music_song_versions_id_user_unique_idx
    ON public.music_song_versions(id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS music_song_versions_id_user_song_unique_idx
    ON public.music_song_versions(id, user_id, song_id);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'music_song_versions_song_owner_fk') THEN
        ALTER TABLE public.music_song_versions ADD CONSTRAINT music_song_versions_song_owner_fk
            FOREIGN KEY (song_id, user_id) REFERENCES public.music_songs(id, user_id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'music_song_versions_parent_song_fk') THEN
        ALTER TABLE public.music_song_versions ADD CONSTRAINT music_song_versions_parent_song_fk
            FOREIGN KEY (parent_version_id, user_id, song_id)
            REFERENCES public.music_song_versions(id, user_id, song_id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'music_songs_current_version_owner_fk') THEN
        ALTER TABLE public.music_songs ADD CONSTRAINT music_songs_current_version_owner_fk
            FOREIGN KEY (current_version_id, user_id, id)
            REFERENCES public.music_song_versions(id, user_id, song_id) ON DELETE RESTRICT;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.music_version_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    output_version_id UUID NOT NULL,
    source_version_id UUID NOT NULL,
    relation TEXT NOT NULL CHECK (relation IN (
        'cover_source','extend_source','speed_source','reuse_source','edit_source',
        'sample_source','mashup_source','inspiration_source'
    )),
    ordinal SMALLINT NOT NULL DEFAULT 1 CHECK (ordinal BETWEEN 1 AND 16),
    source_start_seconds NUMERIC(10,3) CHECK (source_start_seconds IS NULL OR source_start_seconds >= 0),
    source_end_seconds NUMERIC(10,3) CHECK (
        source_end_seconds IS NULL OR source_end_seconds > COALESCE(source_start_seconds, -1)
    ),
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(output_version_id, ordinal),
    CHECK (output_version_id <> source_version_id),
    CONSTRAINT music_version_sources_output_owner_fk
        FOREIGN KEY (output_version_id, user_id)
        REFERENCES public.music_song_versions(id, user_id) ON DELETE CASCADE,
    CONSTRAINT music_version_sources_source_owner_fk
        FOREIGN KEY (source_version_id, user_id)
        REFERENCES public.music_song_versions(id, user_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS music_version_sources_user_output_idx
    ON public.music_version_sources(user_id, output_version_id, ordinal);
CREATE INDEX IF NOT EXISTS music_version_sources_source_idx
    ON public.music_version_sources(source_version_id);

ALTER TABLE public.music_version_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_version_sources FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS music_version_sources_owner_read ON public.music_version_sources;
CREATE POLICY music_version_sources_owner_read ON public.music_version_sources
    FOR SELECT TO authenticated USING (private.music_owns_user(user_id));
REVOKE ALL ON TABLE public.music_version_sources FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.music_version_sources TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.music_version_sources TO service_role;

CREATE OR REPLACE FUNCTION private.music_reject_lineage_update()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    RAISE EXCEPTION 'music lineage rows are immutable'
        USING ERRCODE = 'integrity_constraint_violation';
END $$;
REVOKE ALL ON FUNCTION private.music_reject_lineage_update() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.music_reject_lineage_update() TO service_role;

DROP TRIGGER IF EXISTS music_song_versions_immutable ON public.music_song_versions;
CREATE TRIGGER music_song_versions_immutable
BEFORE UPDATE ON public.music_song_versions
FOR EACH ROW EXECUTE FUNCTION private.music_reject_lineage_update();

DROP TRIGGER IF EXISTS music_version_sources_immutable ON public.music_version_sources;
CREATE TRIGGER music_version_sources_immutable
BEFORE UPDATE ON public.music_version_sources
FOR EACH ROW EXECUTE FUNCTION private.music_reject_lineage_update();

CREATE OR REPLACE FUNCTION public.music_get_song(p_auth_id TEXT, p_song_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_row JSONB;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;

    SELECT jsonb_build_object(
        'id', s.id,
        'title', s.title,
        'visibility', s.visibility,
        'created_at', s.created_at,
        'version_id', current_version.id,
        'job_id', current_version.job_id,
        'generation_id', current_version.generation_request_id,
        'audio_url', '/api/v1/jobs/' || current_version.job_id || '/asset',
        'provenance', current_version.provenance,
        'current_version', jsonb_build_object(
            'id', current_version.id,
            'version_number', current_version.version_number,
            'operation', current_version.operation,
            'parent_version_id', current_version.parent_version_id,
            'created_at', current_version.created_at
        ),
        'versions', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', version.id,
                'version_number', version.version_number,
                'operation', version.operation,
                'parent_version_id', version.parent_version_id,
                'is_current', version.id = s.current_version_id,
                'created_at', version.created_at
            ) ORDER BY version.version_number DESC, version.id), '[]'::jsonb)
            FROM public.music_song_versions version
            WHERE version.song_id = s.id AND version.user_id = v_user
        ),
        'lineage', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', edge.id,
                'output_version_id', edge.output_version_id,
                'source_version_id', edge.source_version_id,
                'source_song_id', source_version.song_id,
                'source_title', source_song.title,
                'source_version_number', source_version.version_number,
                'relation', edge.relation,
                'ordinal', edge.ordinal,
                'source_start_seconds', edge.source_start_seconds,
                'source_end_seconds', edge.source_end_seconds
            ) ORDER BY output_version.version_number DESC, edge.ordinal), '[]'::jsonb)
            FROM public.music_version_sources edge
            JOIN public.music_song_versions output_version ON output_version.id = edge.output_version_id
            JOIN public.music_song_versions source_version ON source_version.id = edge.source_version_id
            JOIN public.music_songs source_song ON source_song.id = source_version.song_id
            WHERE output_version.song_id = s.id AND edge.user_id = v_user
        ),
        'actions', jsonb_build_array('view_lineage', 'organize')
    ) INTO v_row
    FROM public.music_songs s
    JOIN public.music_song_versions current_version ON current_version.id = s.current_version_id
    WHERE s.id = p_song_id AND s.user_id = v_user AND s.status = 'active';

    IF v_row IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    RETURN jsonb_build_object('ok', true, 'song', v_row);
END $$;

REVOKE ALL ON FUNCTION public.music_get_song(TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_song(TEXT,UUID) TO service_role;
