-- ADR-0373. Additive, lazy file-header measurements; no settlement or ledger writes.
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS video_width INTEGER;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS video_height INTEGER;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS shape_unreadable_at TIMESTAMPTZ;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'assets_video_shape_check' AND conrelid = 'public.assets'::regclass) THEN
        ALTER TABLE public.assets ADD CONSTRAINT assets_video_shape_check CHECK (
            (video_width IS NULL AND video_height IS NULL) OR
            (video_width IS NOT NULL AND video_height IS NOT NULL AND video_width BETWEEN 1 AND 16384 AND video_height BETWEEN 1 AND 16384));
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.list_unmeasured_video_shapes(p_auth_id TEXT, p_job_ids UUID[])
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('job_id', v.job_id, 'r2_key', v.r2_key, 'size_bytes', v.size_bytes)), '[]'::jsonb)
    FROM (
        SELECT a.job_id, a.r2_key, a.size_bytes
        FROM public.users u JOIN public.jobs j ON j.user_id = u.id JOIN public.assets a ON a.job_id = j.id
        WHERE u.auth_id = p_auth_id AND u.deleted_at IS NULL AND j.id = ANY(p_job_ids[1:12])
          AND j.state = 'STORED' AND j.deleted_at IS NULL
          AND (SELECT pg_catalog.count(*) FROM public.assets all_assets WHERE all_assets.job_id = j.id) = 1
          AND a.mime_type = 'video/mp4' AND a.output_label IS NULL AND a.held_at IS NULL
          AND (a.expires_at IS NULL OR a.expires_at > pg_catalog.now())
          AND a.video_width IS NULL AND a.video_height IS NULL AND a.shape_unreadable_at IS NULL
        LIMIT 12
    ) v
$$;
REVOKE ALL ON FUNCTION public.list_unmeasured_video_shapes(TEXT, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_unmeasured_video_shapes(TEXT, UUID[]) TO service_role;

CREATE OR REPLACE FUNCTION public.record_video_shape(p_auth_id TEXT, p_job_id UUID, p_r2_key TEXT, p_width INTEGER, p_height INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE affected INTEGER;
BEGIN
    IF (p_width IS NULL) <> (p_height IS NULL) OR p_width NOT BETWEEN 1 AND 16384 OR p_height NOT BETWEEN 1 AND 16384 THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'INVALID_SHAPE');
    END IF;
    UPDATE public.assets a
       SET video_width = p_width, video_height = p_height,
           shape_unreadable_at = CASE WHEN p_width IS NULL THEN pg_catalog.now() END
      FROM public.jobs j JOIN public.users u ON u.id = j.user_id
     WHERE a.job_id = p_job_id AND a.r2_key = p_r2_key AND j.id = a.job_id
       AND u.auth_id = p_auth_id AND u.deleted_at IS NULL AND j.state = 'STORED' AND j.deleted_at IS NULL
       AND (SELECT pg_catalog.count(*) FROM public.assets all_assets WHERE all_assets.job_id = j.id) = 1
       AND a.mime_type = 'video/mp4' AND a.output_label IS NULL AND a.held_at IS NULL
       AND (a.expires_at IS NULL OR a.expires_at > pg_catalog.now())
       AND a.video_width IS NULL AND a.video_height IS NULL AND a.shape_unreadable_at IS NULL;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN pg_catalog.jsonb_build_object('ok', true, 'recorded', affected > 0);
END $$;
REVOKE ALL ON FUNCTION public.record_video_shape(TEXT, UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_video_shape(TEXT, UUID, TEXT, INTEGER, INTEGER) TO service_role;

-- Previous definition: 0452; only the three shape fields below are added.
CREATE OR REPLACE FUNCTION public.list_user_jobs(p_auth_id TEXT, p_limit INTEGER DEFAULT 24, p_before_created_at TIMESTAMPTZ DEFAULT NULL, p_before_id UUID DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_rate JSONB; v_user_id UUID;
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 24), 1), 50); v_rows JSONB;
BEGIN
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id;
    IF v_user_id IS NULL THEN RETURN jsonb_build_object('ok', true, 'jobs', '[]'::jsonb); END IF;
    v_rate := public.consume_job_read_request(v_user_id);
    IF v_rate->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_rate; END IF;
    SELECT COALESCE(jsonb_agg(j ORDER BY j.created_at DESC, j.id DESC), '[]'::jsonb) INTO v_rows FROM (
        SELECT jsonb_build_object(
                   'output_type', CASE WHEN b.provider='concat-render' THEN 'editor-render' ELSE NULL END,
                   'render_id', (SELECT e.id FROM public.editor_library_renders e WHERE e.source_job_id=b.id AND private.editor_render_available(e.asset_id,e.source_job_id,e.r2_key)),
                   'job_id', b.id, 'state', b.state, 'credits', b.credits, 'model_id', b.model_id, 'error_code', b.error_code, 'created_at', b.created_at,
                   'label', left(COALESCE(b.inputs->>'prompt', b.inputs->>'topic', ''), 60),
                   'asset_expires_at', (SELECT min(a.expires_at) FROM public.assets a WHERE a.job_id = b.id),
                   'has_asset', EXISTS (SELECT 1 FROM public.assets a WHERE a.job_id = b.id AND a.held_at IS NULL),
                   'shape_ambiguous', (SELECT count(*) > 1 FROM public.assets a WHERE a.job_id = b.id),
                   'video_width', (SELECT max(a.video_width) FROM public.assets a WHERE a.job_id = b.id AND b.state = 'STORED' AND a.mime_type = 'video/mp4' AND a.output_label IS NULL AND a.held_at IS NULL AND (a.expires_at IS NULL OR a.expires_at > pg_catalog.now()) AND (SELECT count(*) FROM public.assets all_assets WHERE all_assets.job_id = b.id) = 1),
                   'video_height', (SELECT max(a.video_height) FROM public.assets a WHERE a.job_id = b.id AND b.state = 'STORED' AND a.mime_type = 'video/mp4' AND a.output_label IS NULL AND a.held_at IS NULL AND (a.expires_at IS NULL OR a.expires_at > pg_catalog.now()) AND (SELECT count(*) FROM public.assets all_assets WHERE all_assets.job_id = b.id) = 1),
                   'held', EXISTS (SELECT 1 FROM public.assets a WHERE a.job_id = b.id AND a.held_at IS NOT NULL)
               ) AS j,
               b.created_at,
               b.id FROM public.jobs b WHERE b.user_id = v_user_id
          AND b.deleted_at IS NULL
          AND b.inputs->>'kind' IS DISTINCT FROM 'chat'
          AND b.inputs->>'kind' IS DISTINCT FROM 'editor_ai_edit' AND b.inputs->>'kind' IS DISTINCT FROM 'speech_analysis'
          AND (p_before_created_at IS NULL
               OR (b.created_at, b.id) < (p_before_created_at, COALESCE(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid))) ORDER BY b.created_at DESC, b.id DESC LIMIT v_limit
    ) j;
    RETURN jsonb_build_object('ok', true, 'jobs', v_rows);
END $$;
REVOKE ALL ON FUNCTION public.list_user_jobs(TEXT, INTEGER, TIMESTAMPTZ, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_user_jobs(TEXT, INTEGER, TIMESTAMPTZ, UUID) TO service_role;
