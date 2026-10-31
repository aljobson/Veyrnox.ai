-- ADR-0304: read-only, Library-aligned achievements. No balances or ledger writes.
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
        FROM owned_jobs j WHERE j.deleted_at IS NULL AND j.state = 'STORED'
            AND j.inputs->>'kind' IS DISTINCT FROM 'chat' AND j.created_at <= pg_catalog.now()
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
            'video_seconds', (SELECT COALESCE(pg_catalog.sum(CASE WHEN c.seconds ~ '^[0-9]+([.][0-9]+)?$'
                THEN pg_catalog.floor(c.seconds::numeric) ELSE 0 END),0) FROM creations c WHERE c.kind='video' AND c.created_at >= w.since),
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
