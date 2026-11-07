-- Speech analyses have their own settlement sweep and are never creations/push events.
CREATE OR REPLACE FUNCTION public.get_user_job(
    p_auth_id TEXT,
    p_job_id  UUID
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rate JSONB;
    v_user_id UUID;
    v_row     public.jobs%ROWTYPE;
BEGIN
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    END IF;

    v_rate := public.consume_job_read_request(v_user_id);
    IF v_rate->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_rate; END IF;

    SELECT * INTO v_row FROM public.jobs
    WHERE id = p_job_id AND user_id = v_user_id AND deleted_at IS NULL
      AND inputs->>'kind' IS DISTINCT FROM 'editor_ai_edit' AND inputs->>'kind' IS DISTINCT FROM 'speech_analysis';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'state', v_row.state,
        'credits', v_row.credits,
        'model_id', v_row.model_id,
        'provider', v_row.provider,
        'render_id', (SELECT e.id FROM public.editor_library_renders e WHERE e.source_job_id=v_row.id AND private.editor_render_available(e.asset_id,e.source_job_id,e.r2_key)),
        'provider_job_id', v_row.provider_job_id,
        'error_code', v_row.error_code,
        'created_at', v_row.created_at,
        'updated_at', v_row.updated_at
    );
END $$;
REVOKE ALL ON FUNCTION public.get_user_job(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_job(TEXT, UUID) TO service_role;

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


CREATE OR REPLACE FUNCTION public.get_user_job_cancel(p_auth_id TEXT, p_job_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user public.users%ROWTYPE;
    v_job public.jobs%ROWTYPE;
    v_rate JSONB;
BEGIN
    SELECT * INTO v_user FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    v_rate := public.consume_job_read_request(v_user.id);
    IF v_rate->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_rate; END IF;
    SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id AND user_id = v_user.id;
    IF NOT FOUND OR v_job.deleted_at IS NOT NULL OR v_job.inputs->>'kind' IN ('chat','editor_ai_edit','speech_analysis') THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    END IF;
    RETURN pg_catalog.jsonb_build_object('ok', true, 'credits', v_job.credits, 'cancellable',
        v_job.state = 'DEBITED' AND v_job.provider_job_id IS NULL AND v_user.frozen_at IS NULL
        AND EXISTS (SELECT 1 FROM public.fal_dispatch WHERE job_id = v_job.id AND state = 'READY'));
END $$;
REVOKE ALL ON FUNCTION public.get_user_job_cancel(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_job_cancel(TEXT, UUID) TO service_role;

-- 0348's function verbatim, with only the user_cancelled exclusion added.
CREATE OR REPLACE FUNCTION public.push_enqueue_job_events(p_limit INTEGER DEFAULT 200)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_n INTEGER;
BEGIN
    WITH people AS (
        SELECT DISTINCT t.user_id FROM public.push_tokens t
         WHERE t.disabled_at IS NULL AND t.notify_jobs
    ), due AS (
        SELECT j.user_id, j.id AS job_id,
               CASE WHEN j.state = 'STORED' THEN 'job_done' ELSE 'job_failed' END AS kind
          FROM people p
          JOIN public.jobs j ON j.user_id = p.user_id
         WHERE j.created_at > now() - interval '2 hours'
           AND j.updated_at > now() - interval '15 minutes'
           AND j.state IN ('STORED', 'FAILED', 'REFUNDED')
           AND j.error_code IS DISTINCT FROM 'user_cancelled'
           AND COALESCE(j.provider, '') <> 'openrouter-chat'
           AND j.inputs->>'kind' IS DISTINCT FROM 'speech_analysis'
         ORDER BY j.updated_at
         LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000))
    ), ins AS (
        INSERT INTO public.push_outbox (user_id, job_id, kind)
        SELECT user_id, job_id, kind FROM due
        ON CONFLICT (job_id, kind) DO NOTHING
        RETURNING 1
    )
    SELECT count(*) INTO v_n FROM ins;
    RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.push_enqueue_job_events(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_enqueue_job_events(INTEGER) TO service_role;

-- ADR-0305: read-only, Library-aligned achievements. No balances or ledger writes.
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

CREATE OR REPLACE FUNCTION public.sweep_stuck_jobs(
    p_debited_minutes INTEGER DEFAULT 15,
    p_submitted_minutes INTEGER DEFAULT 120,
    p_limit INTEGER DEFAULT 200,
    p_succeeded_minutes INTEGER DEFAULT 60
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_job RECORD; v_refunded INTEGER := 0; v_failed INTEGER := 0;
    v_unstored INTEGER := 0; v_unpaid INTEGER := 0; v_res JSONB;
BEGIN
    FOR v_job IN
        SELECT j.id, j.user_id, j.credits, j.state
        FROM public.jobs j
        WHERE j.inputs->>'kind' IS DISTINCT FROM 'speech_analysis' AND ((j.state = 'DEBITED'
               AND j.updated_at < now() - make_interval(mins => p_debited_minutes)
               -- Hold (do not refund) an explicitly-ambiguous submit that still
               -- has a supplier reservation: its own key or any failover
               -- suffix, for ANY supplier (F-13 null-safe predicate, F-14
               -- supplier-agnostic + suffixed keys). A reconciler resolves it.
               AND NOT (j.error_code IS NOT DISTINCT FROM 'provider_outcome_unknown' AND EXISTS (
                   SELECT 1 FROM public.provider_spend_reservations r
                    WHERE r.user_id = j.user_id
                      AND (r.effect_key = j.idempotency_key OR starts_with(r.effect_key, j.idempotency_key || ':a')))))
           OR (j.state IN ('SUBMITTED', 'FAILOVER') AND j.updated_at < now() - make_interval(mins => p_submitted_minutes))
           OR (j.state = 'SUCCEEDED' AND j.updated_at < now() - make_interval(mins => p_succeeded_minutes)
               AND NOT EXISTS (SELECT 1 FROM public.assets a WHERE a.job_id = j.id))
           OR (j.state = 'FAILED' AND j.credits > 0
               AND j.updated_at < now() - make_interval(mins => p_debited_minutes)
               AND NOT EXISTS (SELECT 1 FROM public.ledger_entries le WHERE le.job_id = j.id AND le.delta > 0))
        ) ORDER BY j.updated_at LIMIT p_limit FOR UPDATE OF j SKIP LOCKED
    LOOP
        IF v_job.state IN ('SUBMITTED', 'FAILOVER') THEN
            UPDATE public.jobs SET state = 'FAILED', error_code = 'stuck_timeout', updated_at = now() WHERE id = v_job.id;
            v_failed := v_failed + 1;
        ELSIF v_job.state = 'SUCCEEDED' THEN
            UPDATE public.jobs SET state = 'FAILED', error_code = 'asset_store_failed', updated_at = now() WHERE id = v_job.id;
            v_unstored := v_unstored + 1;
        ELSIF v_job.state = 'FAILED' THEN
            v_unpaid := v_unpaid + 1;
        END IF;
        v_res := public.ledger_refund(v_job.id, v_job.user_id, v_job.credits,
            CASE v_job.state WHEN 'DEBITED' THEN 'refund:stuck_debited'
                WHEN 'SUCCEEDED' THEN 'refund:asset_store_failed'
                WHEN 'FAILED' THEN 'refund:failed_unpaid' ELSE 'refund:stuck_submitted' END);
        IF (v_res->>'ok')::boolean AND NOT COALESCE((v_res->>'idempotent')::boolean, false) THEN
            v_refunded := v_refunded + 1;
        END IF;
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'failed', v_failed, 'unstored', v_unstored,
                              'unpaid_failures', v_unpaid, 'refunded', v_refunded);
END $$;

REVOKE ALL ON FUNCTION public.sweep_stuck_jobs(INTEGER,INTEGER,INTEGER,INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_stuck_jobs(INTEGER,INTEGER,INTEGER,INTEGER) TO service_role;

-- Keep telemetry normalization aligned with the new AI-edit and speech-analysis routes (ADR-0330, ADR-0331).
CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT p_path = ANY (ARRAY['/','/.well-known/apple-app-site-association','/.well-known/assetlinks.json','/.well-known/oauth-protected-resource/api/v1/developer','/.well-known/oauth-protected-resource/api/v1/mcp','/about','/api/admin/reap-assets','/api/admin/top-up-backfill','/api/auth/session','/api/catalog','/api/cinema-pass-plans','/api/cinema/comments','/api/cinema/discovery','/api/cinema/posters/:id','/api/cinema/story-polls','/api/cinema/titles','/api/cinema/titles/:id','/api/cinema/voting','/api/cinema/winners','/api/credit-packs','/api/credit-subscription-plans','/api/developer/openapi','/api/popular-templates','/api/presets','/api/publish/v1/accounts','/api/publish/v1/posts','/api/social/approvals/:id','/api/social/team/:id','/api/status','/api/templates','/api/templates/:id','/api/turnstile-failure','/api/v1/account','/api/v1/account/age-confirmation','/api/v1/account/deletion','/api/v1/account/export','/api/v1/account/export/:id','/api/v1/account/language','/api/v1/admin/affiliates','/api/v1/admin/appeals','/api/v1/admin/changes','/api/v1/admin/cinema/comments','/api/v1/admin/cinema/creators','/api/v1/admin/cinema/earnings','/api/v1/admin/cinema/pass/refund','/api/v1/admin/cinema/rankings','/api/v1/admin/cinema/story-polls','/api/v1/admin/cinema/submissions','/api/v1/admin/cinema/suspend','/api/v1/admin/cinema/unlocks/reverse','/api/v1/admin/cinema/voting','/api/v1/admin/endpoints','/api/v1/admin/metrics','/api/v1/admin/permissions','/api/v1/admin/plans','/api/v1/admin/reports','/api/v1/admin/reports/asset','/api/v1/admin/revenue','/api/v1/admin/roles','/api/v1/admin/security','/api/v1/admin/support','/api/v1/admin/switches','/api/v1/admin/traffic','/api/v1/admin/users/ai-control','/api/v1/admin/users/ledger','/api/v1/admin/users/lookup','/api/v1/admin/violations','/api/v1/admin/webhooks','/api/v1/appeals','/api/v1/balance','/api/v1/chat/folders','/api/v1/chat/folders/:id','/api/v1/chat/models','/api/v1/chat/personas','/api/v1/chat/personas/:id','/api/v1/chat/sends/close','/api/v1/chat/threads','/api/v1/chat/threads/:id','/api/v1/chat/threads/:id/messages','/api/v1/checkin','/api/v1/cinema/audience','/api/v1/cinema/blocks','/api/v1/cinema/blocks/:id','/api/v1/cinema/comments','/api/v1/cinema/content','/api/v1/cinema/content/submit','/api/v1/cinema/content/withdraw','/api/v1/cinema/creator-analytics','/api/v1/cinema/entitlement','/api/v1/cinema/pass','/api/v1/cinema/pass/cancel','/api/v1/cinema/pass/plans','/api/v1/cinema/pass/portal','/api/v1/cinema/pass/return','/api/v1/cinema/play','/api/v1/cinema/play/heartbeat','/api/v1/cinema/posters/:id','/api/v1/cinema/progress','/api/v1/cinema/retention','/api/v1/cinema/story-choices','/api/v1/cinema/story-polls','/api/v1/cinema/titles/:id','/api/v1/cinema/unlocks','/api/v1/cinema/uploads','/api/v1/cinema/uploads/:id/transfer','/api/v1/cinema/uploads/from-library','/api/v1/cinema/uploads/refresh','/api/v1/cinema/uploads/remove','/api/v1/cinema/votes','/api/v1/cinema/voting','/api/v1/creator-profile','/api/v1/creator-profile/skip','/api/v1/creators/apply','/api/v1/credit-packs','/api/v1/developer/:id*','/api/v1/devices','/api/v1/editor/ai-edit','/api/v1/editor/ai-edit/by-key/:id','/api/v1/editor/ai-edit/quote','/api/v1/editor/server-render','/api/v1/editor/server-render/quote','/api/v1/editor/speech-analyses','/api/v1/editor/speech-analyses/:id','/api/v1/editor/speech-analyses/by-key/:id','/api/v1/editor/speech-analyses/quote','/api/v1/film-studio','/api/v1/film-studio/:id','/api/v1/free-allowance','/api/v1/generations','/api/v1/health','/api/v1/help','/api/v1/jobs','/api/v1/jobs/:id','/api/v1/jobs/:id/asset','/api/v1/jobs/:id/cancel','/api/v1/jobs/:id/media-info','/api/v1/jobs/:id/provenance','/api/v1/ledger','/api/v1/ledger/usage','/api/v1/library/editor-renders','/api/v1/library/editor-renders/:id/asset','/api/v1/library/editor-renders/:id/inspect','/api/v1/library/masters','/api/v1/library/masters/:id/asset','/api/v1/library/masters/upload','/api/v1/mcp','/api/v1/mfa/recovery','/api/v1/mfa/recovery/codes','/api/v1/montage/plan','/api/v1/projects','/api/v1/projects/:id','/api/v1/projects/:id/assets','/api/v1/projects/:id/assets/:id/download','/api/v1/projects/:id/assets/:id/inspect','/api/v1/projects/:id/document','/api/v1/projects/:id/history','/api/v1/projects/:id/review','/api/v1/referrals','/api/v1/referrals/attach','/api/v1/reports','/api/v1/session/me','/api/v1/social-cinema/profile','/api/v1/social/access','/api/v1/social/accounts','/api/v1/social/accounts/:id','/api/v1/social/accounts/bluesky/connect','/api/v1/social/accounts/facebook/callback','/api/v1/social/accounts/facebook/connect','/api/v1/social/accounts/gmb/callback','/api/v1/social/accounts/gmb/connect','/api/v1/social/accounts/instagram/callback','/api/v1/social/accounts/instagram/connect','/api/v1/social/accounts/linkedin/callback','/api/v1/social/accounts/linkedin/connect','/api/v1/social/accounts/pinterest/callback','/api/v1/social/accounts/pinterest/connect','/api/v1/social/accounts/threads/callback','/api/v1/social/accounts/threads/connect','/api/v1/social/accounts/tiktok/callback','/api/v1/social/accounts/tiktok/connect','/api/v1/social/accounts/twitch/callback','/api/v1/social/accounts/twitch/connect','/api/v1/social/accounts/twitter/callback','/api/v1/social/accounts/twitter/connect','/api/v1/social/accounts/youtube/callback','/api/v1/social/accounts/youtube/connect','/api/v1/social/activity','/api/v1/social/ads','/api/v1/social/analytics','/api/v1/social/approvals','/api/v1/social/autolists','/api/v1/social/best-time','/api/v1/social/brand-kit','/api/v1/social/brands','/api/v1/social/calendar','/api/v1/social/commerce/products','/api/v1/social/contacts','/api/v1/social/developer/keys','/api/v1/social/developer/logs','/api/v1/social/developer/webhooks','/api/v1/social/drafts','/api/v1/social/inbox','/api/v1/social/inbox/:id','/api/v1/social/inbox/:id/reply','/api/v1/social/inbox/:id/suggestions','/api/v1/social/inbox/analytics','/api/v1/social/plan','/api/v1/social/plan/cancel','/api/v1/social/plan/portal','/api/v1/social/plan/return','/api/v1/social/posts','/api/v1/social/posts/:id','/api/v1/social/posts/:id/schedule','/api/v1/social/presets','/api/v1/social/queues','/api/v1/social/queues/reserve','/api/v1/social/reports','/api/v1/social/reports/:id/export','/api/v1/social/smartlink','/api/v1/social/team','/api/v1/social/team/accept','/api/v1/social/uploads','/api/v1/social/workflows','/api/v1/store-purchases/customer','/api/v1/subscriptions','/api/v1/subscriptions/cancel','/api/v1/subscriptions/checkout','/api/v1/subscriptions/plans','/api/v1/subscriptions/return','/api/v1/support/tickets','/api/v1/top-ups','/api/v1/top-ups/:id','/api/v1/top-ups/:id/return','/api/v1/uploads','/api/v1/voice-profiles','/api/v1/voice-profiles/:id','/api/v1/voice-profiles/:id/captcha','/api/v1/voice-profiles/:id/samples','/api/v1/voice-profiles/:id/speech','/api/v1/wins','/api/v1/workspaces','/api/v1/workspaces/:id/brand-assets','/api/v1/workspaces/:id/brand-kit','/api/webhook/cinema-stream','/api/webhook/editor-render','/api/webhook/fal','/api/webhook/kie','/api/webhook/montage','/api/webhook/openrouter','/api/webhook/revenuecat','/api/webhook/social/meta','/api/webhook/stripe','/app','/app/account','/app/account/appeals','/app/account/report','/app/account/wins','/app/admin','/app/admin/affiliates','/app/admin/appeals','/app/admin/changes','/app/admin/cinema','/app/admin/cinema/comments','/app/admin/cinema/rankings','/app/admin/cinema/story-polls','/app/admin/cinema/submissions','/app/admin/cinema/voting','/app/admin/endpoints','/app/admin/payments','/app/admin/plans','/app/admin/reports','/app/admin/roles','/app/admin/security','/app/admin/support','/app/admin/switches','/app/admin/traffic','/app/admin/users','/app/admin/violations','/app/admin/webhooks','/app/chat','/app/create','/app/credits','/app/editor','/app/editor/review','/app/enhance','/app/faceless-reel','/app/features','/app/features/:id','/app/film-studio','/app/library','/app/oddlings','/app/projects','/app/projects/:id','/app/publish','/app/publish/activity','/app/publish/ads','/app/publish/analytics','/app/publish/autolists','/app/publish/calendar','/app/publish/commerce','/app/publish/contacts','/app/publish/developer','/app/publish/inbox','/app/publish/plan','/app/publish/queues','/app/publish/reports','/app/publish/smartlink','/app/publish/team','/app/publish/workflows','/app/skills','/app/vibe','/app/video-agent','/auth/callback','/auth/mobile','/auth/mobile/start','/compare/:id','/design-system','/developers','/guides','/guides/:id','/legal/aup','/legal/cinema-content','/legal/gdpr','/legal/privacy','/legal/refund','/legal/terms','/m','/m/create','/m/credits','/m/explore','/m/job','/m/library','/mcp','/media/social/:id','/models','/models/:id','/oauth/consent','/oddlings','/oddlings/:id','/presets','/presets/:id','/pricing','/publish','/s/:id','/s/:id/go/:id','/social-cinema','/social-cinema/creator','/social-cinema/pass','/social-cinema/series/:id','/social-cinema/title/:id','/social-cinema/watch/:id','/social/connect/callback/:id','/social/connect/mobile/:id','/social/review/:id','/social/team/invite/:id','/tools','other']::text[])
$$;
REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT) FROM PUBLIC,anon,authenticated,service_role;
