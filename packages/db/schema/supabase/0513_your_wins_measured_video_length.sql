-- QA build 50 (F08): "Video made" counted only videos from 13 exact-length endpoints, so a
-- Veo 3.1 Lite clip and an MMAudio sound pass counted 0 s. Each stored MP4 now carries the
-- length read from its own headers (the reader behind /api/v1/jobs/:id/media-info), filled
-- in by GET /api/v1/wins, and read_your_wins sums that. Unmeasured videos keep the old rule.

ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS duration_unreadable_at TIMESTAMPTZ;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_duration_ms_check') THEN
        ALTER TABLE public.assets ADD CONSTRAINT assets_duration_ms_check
            CHECK (duration_ms IS NULL OR duration_ms BETWEEN 1 AND 86400000);
    END IF;
END $$;

-- The caller's stored MP4s that have no length yet and have not failed to read, newest first.
CREATE OR REPLACE FUNCTION public.list_unmeasured_videos(p_auth_id TEXT, p_limit INTEGER)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('job_id', v.job_id, 'r2_key', v.r2_key, 'size_bytes', v.size_bytes)
        ORDER BY v.created_at DESC), '[]'::jsonb)
    FROM (
        SELECT a.job_id, a.r2_key, a.size_bytes, j.created_at
        FROM public.users u
        JOIN public.jobs j ON j.user_id = u.id
        JOIN public.assets a ON a.job_id = j.id
        WHERE u.auth_id = p_auth_id AND u.deleted_at IS NULL
          AND j.state = 'STORED' AND j.deleted_at IS NULL
          AND a.mime_type = 'video/mp4' AND a.output_label IS NULL AND a.held_at IS NULL
          AND a.duration_ms IS NULL AND a.duration_unreadable_at IS NULL
          AND (a.expires_at IS NULL OR a.expires_at > pg_catalog.now())
        ORDER BY j.created_at DESC
        LIMIT GREATEST(0, LEAST(COALESCE(p_limit, 0), 20))
    ) v
$$;
REVOKE ALL ON FUNCTION public.list_unmeasured_videos(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_unmeasured_videos(TEXT, INTEGER) TO service_role;

-- Records one measured length (NULL = unreadable). Write-once: a replay or a second reader is a no-op.
CREATE OR REPLACE FUNCTION public.record_video_duration(p_auth_id TEXT, p_job_id UUID, p_r2_key TEXT, p_duration_ms INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE affected INTEGER;
BEGIN
    IF p_duration_ms IS NOT NULL AND (p_duration_ms < 1 OR p_duration_ms > 86400000) THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'INVALID_DURATION');
    END IF;
    UPDATE public.assets a
       SET duration_ms = p_duration_ms,
           duration_unreadable_at = CASE WHEN p_duration_ms IS NULL THEN pg_catalog.now() END
      FROM public.jobs j JOIN public.users u ON u.id = j.user_id
     WHERE a.job_id = p_job_id AND a.r2_key = p_r2_key AND j.id = a.job_id
       AND u.auth_id = p_auth_id AND u.deleted_at IS NULL
       AND a.mime_type = 'video/mp4' AND a.output_label IS NULL
       AND a.duration_ms IS NULL AND a.duration_unreadable_at IS NULL;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN pg_catalog.jsonb_build_object('ok', true, 'recorded', affected > 0);
END $$;
REVOKE ALL ON FUNCTION public.record_video_duration(TEXT, UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_video_duration(TEXT, UUID, TEXT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.read_your_wins(p_auth_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    u public.users%ROWTYPE;
    today date := (pg_catalog.now() AT TIME ZONE 'UTC')::date;
    week_start timestamptz := pg_catalog.date_trunc('week', pg_catalog.now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    result jsonb;
BEGIN
    SELECT * INTO u FROM public.users WHERE auth_id = p_auth_id;
    IF NOT FOUND OR u.deleted_at IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'ACCOUNT_UNAVAILABLE');
    END IF;
    WITH completed_routes AS MATERIALIZED (
        SELECT DISTINCT ON (a.job_id) a.job_id, r.supplier, r.endpoint
        FROM public.job_attempts a JOIN public.jobs j ON j.id = a.job_id
        JOIN public.model_routes r ON r.id = a.route_id AND r.model_id = j.model_id
        WHERE j.user_id = u.id AND a.outcome = 'completed'
        ORDER BY a.job_id, a.attempt_no DESC
    ), owned_jobs AS MATERIALIZED (
        SELECT j.*, m.modality, COALESCE(r.endpoint, m.provider_endpoint) AS duration_endpoint,
            COALESCE(r.supplier, m.provider) AS duration_provider
        FROM public.jobs j LEFT JOIN public.model_catalog m ON m.id = j.model_id
        LEFT JOIN completed_routes r ON r.job_id = j.id WHERE j.user_id = u.id
    ), creations AS MATERIALIZED (
        SELECT j.id, j.created_at,
            CASE WHEN j.modality LIKE '%-image' THEN 'image' WHEN j.modality LIKE '%-video' THEN 'video'
                 WHEN j.modality IN ('audio','text-to-speech','text-to-audio','audio-to-audio') THEN 'audio' ELSE 'other' END AS kind,
            CASE
                -- Edits and renders reuse footage; only new generation contributes seconds.
                -- Only mappings whose duration is identical to the requested output length.
                -- Other flows (including 5-unit Veo/Hailuo) deliberately contribute zero.
                WHEN j.provider = j.duration_provider AND j.duration_endpoint IN (
                    'fal-ai/kling-video/v2.6/pro/text-to-video','fal-ai/wan-25-preview/text-to-video',
                    'fal-ai/kling-video/o1/video-to-video/reference','fal-ai/kling-video/v3/pro/image-to-video',
                    'market:kling-3.0/video','market:wan/2-5-text-to-video','market:kling-2.6/text-to-video',
                    'byteplus:seedance-2.0-fast','byteplus:seedance-2.0-mini','byteplus:seedance-2.0',
                    'byteplus:seedance-2.5','byteplus:seedance-1.0-pro-fast','bytedance/seedance-2.0-fast'
                ) THEN COALESCE(j.inputs->>'duration_seconds', '5')
            END AS seconds
            , (SELECT pg_catalog.max(a.duration_ms) FROM public.assets a
               WHERE a.job_id = j.id AND a.mime_type = 'video/mp4' AND a.output_label IS NULL) AS measured_ms
        FROM owned_jobs j WHERE j.deleted_at IS NULL AND j.state = 'STORED'
            AND j.inputs->>'kind' IS DISTINCT FROM 'chat' AND j.inputs->>'kind' IS DISTINCT FROM 'editor_ai_edit' AND j.inputs->>'kind' IS DISTINCT FROM 'speech_analysis' AND j.created_at <= pg_catalog.now()
    ), ranked AS (
        SELECT c.*, pg_catalog.row_number() OVER (ORDER BY c.created_at, c.id) AS ordinal FROM creations c
    ), entries AS MATERIALIZED (
        SELECT e.* FROM public.ledger_entries e WHERE e.user_id = u.id
    ), chat_jobs AS (
        SELECT e.job_id FROM entries e WHERE e.reason LIKE 'debit:chat%' AND e.job_id IS NOT NULL
        UNION SELECT j.id FROM owned_jobs j WHERE j.inputs->>'kind' = 'chat'
    ), spending AS (
        SELECT e.* FROM entries e WHERE e.job_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM chat_jobs c WHERE c.job_id = e.job_id)
    ), targets AS MATERIALIZED (
        SELECT t.* FROM public.social_posts p JOIN public.social_post_targets t ON t.post_id = p.id
        WHERE p.created_by_user_id = u.id AND t.publish_status = 'published' AND t.published_at <= pg_catalog.now()
    ), posts AS (
        SELECT t.post_id, pg_catalog.min(t.published_at) AS published_at FROM targets t GROUP BY t.post_id
    ), views AS (
        SELECT a.account_id, a.platform_post_id, a.metrics, pg_catalog.min(t.published_at) AS published_at,
            pg_catalog.min(t.network) AS network
        FROM targets t JOIN public.social_analytics_posts a ON a.account_id = t.account_id AND a.platform_post_id = t.platform_post_id
        WHERE pg_catalog.jsonb_typeof(a.metrics->'views') = 'number'
        GROUP BY a.account_id, a.platform_post_id, a.metrics
    ), days AS (
        SELECT DISTINCT pg_catalog.substr(e.reason, 15)::date AS d FROM entries e
        WHERE e.reason ~ '^grant:checkin#[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    ), runs AS (
        SELECT d, d - (pg_catalog.row_number() OVER (ORDER BY d))::integer AS run FROM days WHERE d <= today
    ), streak_runs AS (
        SELECT pg_catalog.min(d) AS start_date, pg_catalog.count(*)::integer AS n FROM runs GROUP BY run
    ), stats AS (
        SELECT w.name, pg_catalog.jsonb_build_object(
            'creations', (SELECT pg_catalog.jsonb_build_object('total', pg_catalog.count(*), 'by_type', pg_catalog.jsonb_build_object(
                'image', pg_catalog.count(*) FILTER (WHERE c.kind='image'), 'video', pg_catalog.count(*) FILTER (WHERE c.kind='video'),
                'audio', pg_catalog.count(*) FILTER (WHERE c.kind='audio'), 'other', pg_catalog.count(*) FILTER (WHERE c.kind='other')))
                FROM creations c WHERE c.created_at >= w.since),
            -- A measured length (0513) wins; otherwise the requested length of an exact-length endpoint.
            'video_seconds', (SELECT COALESCE(pg_catalog.floor(pg_catalog.sum(CASE WHEN c.measured_ms IS NOT NULL THEN c.measured_ms / 1000.0
                WHEN c.seconds ~ '^[0-9]+([.][0-9]+)?$' THEN pg_catalog.floor(c.seconds::numeric) ELSE 0 END)),0)::bigint
                FROM creations c WHERE c.kind='video' AND c.created_at >= w.since),
            'credits_used', (SELECT GREATEST(0, -COALESCE(pg_catalog.sum(e.delta),0)) FROM spending e
                WHERE e.created_at >= w.since AND e.created_at <= pg_catalog.now()),
            'posts', (SELECT pg_catalog.count(*) FROM posts p WHERE p.published_at >= w.since),
            'views', (SELECT CASE WHEN pg_catalog.count(*) > 0 THEN pg_catalog.jsonb_build_object(
                'total', pg_catalog.sum((v.metrics->>'views')::numeric), 'networks', pg_catalog.jsonb_agg(DISTINCT v.network ORDER BY v.network)) END
                FROM views v WHERE v.published_at >= w.since)
        ) AS data FROM (VALUES ('week',week_start), ('all','-infinity'::timestamptz)) w(name,since)
    ), achievements AS (
        SELECT 1 AS pos, 'first_image' AS key, pg_catalog.min(c.created_at) FILTER (WHERE c.kind='image') AS reached_at,
            LEAST(1,pg_catalog.count(*) FILTER (WHERE c.kind='image'))::integer AS progress, 1 AS target FROM creations c
        UNION ALL SELECT 2,'first_video',pg_catalog.min(c.created_at) FILTER (WHERE c.kind='video'),
            LEAST(1,pg_catalog.count(*) FILTER (WHERE c.kind='video'))::integer,1 FROM creations c
        UNION ALL SELECT 3,'creations_10',pg_catalog.min(c.created_at) FILTER (WHERE c.ordinal=10),LEAST(10,pg_catalog.count(*))::integer,10 FROM ranked c
        UNION ALL SELECT 4,'creations_50',pg_catalog.min(c.created_at) FILTER (WHERE c.ordinal=50),LEAST(50,pg_catalog.count(*))::integer,50 FROM ranked c
        UNION ALL SELECT 5,'first_post',pg_catalog.min(p.published_at),LEAST(1,pg_catalog.count(*))::integer,1 FROM posts p
        UNION ALL SELECT 6,'first_cinema_upload',pg_catalog.min(c.created_at),LEAST(1,pg_catalog.count(*))::integer,1
            FROM public.cinema_uploads c WHERE c.creator_id=u.id AND c.state='ready' AND c.created_at <= pg_catalog.now()
        UNION ALL SELECT 7,'streak_7',(pg_catalog.min(s.start_date+6) FILTER (WHERE s.n>=7))::timestamp AT TIME ZONE 'UTC',
            LEAST(7,COALESCE(pg_catalog.max(s.n),0)),7 FROM streak_runs s
    )
    SELECT pg_catalog.jsonb_build_object('ok',true,'week_start',week_start,
        'week',(SELECT data FROM stats WHERE name='week'),'all',(SELECT data FROM stats WHERE name='all'),
        'streak',pg_catalog.jsonb_build_object(
            'current',COALESCE((SELECT CASE WHEN s.last_checkin_date >= today-1 THEN s.streak ELSE 0 END FROM public.checkin_streaks s WHERE s.user_id=u.id),0),
            'best',(SELECT COALESCE(pg_catalog.max(n),0) FROM streak_runs),
            'last7',(SELECT pg_catalog.jsonb_agg(EXISTS(SELECT 1 FROM days d WHERE d.d=today-6+n) ORDER BY n) FROM pg_catalog.generate_series(0,6) n)),
        'milestones',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key',key,'reached_at',reached_at,'progress',progress,'target',target) ORDER BY pos) FROM achievements)
    ) INTO result;
    RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_your_wins(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_your_wins(text) TO service_role;
