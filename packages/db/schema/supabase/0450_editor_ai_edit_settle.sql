-- Frozen AI Edit work order, amendments A1/A6/A9/A10/A11. No price/catalog changes.
-- Digest is bound atomically by ledger_debit (debit:chat, distinct inputs.kind).
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS editor_ai_edit_result JSONB;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS editor_ai_edit_expires_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.editor_ai_edit_settle(p_job_id UUID, p_result JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job public.jobs%ROWTYPE;
BEGIN
    SELECT * INTO v_job FROM public.jobs WHERE id=p_job_id FOR UPDATE;
    IF NOT FOUND OR v_job.inputs->>'kind' IS DISTINCT FROM 'editor_ai_edit' THEN
        RETURN jsonb_build_object('ok',false,'code','JOB_NOT_FOUND');
    END IF;
    IF v_job.state='STORED' THEN RETURN jsonb_build_object('ok',true,'idempotent',true); END IF;
    IF v_job.state<>'SUBMITTED' THEN RETURN jsonb_build_object('ok',false,'code','BAD_STATE'); END IF;
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id=v_job.user_id AND deleted_at IS NULL) THEN
        RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND');
    END IF;
    IF jsonb_typeof(p_result) IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_result->'plan'->'commands') IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_result->'skipped') IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_result->'summary') IS DISTINCT FROM 'string'
       OR p_result->'credits' IS DISTINCT FROM to_jsonb(v_job.credits)
       OR pg_catalog.octet_length(p_result::text)>32768 THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_RESULT');
    END IF;
    IF jsonb_array_length(p_result->'plan'->'commands') NOT BETWEEN 1 AND 20 THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_RESULT');
    END IF;
    UPDATE public.jobs SET state='STORED', error_code=NULL, updated_at=now(),
        editor_ai_edit_result=p_result, editor_ai_edit_expires_at=now()+interval '24 hours' WHERE id=p_job_id;
    RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.editor_ai_edit_settle(UUID,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.editor_ai_edit_settle(UUID,JSONB) TO service_role;

-- Only the Worker receives the digest/model fields; it projects a safe read response.
-- A different feature's key is a conflict, never an invitation to reveal that job.
CREATE OR REPLACE FUNCTION public.editor_ai_edit_lookup(p_auth_id TEXT,p_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job public.jobs%ROWTYPE; v_user UUID; v_status TEXT;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',true,'found',false); END IF;
    SELECT * INTO v_job FROM public.jobs WHERE user_id=v_user AND idempotency_key=p_key;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'found',false); END IF;
    IF v_job.inputs->>'kind' IS DISTINCT FROM 'editor_ai_edit' THEN
        RETURN jsonb_build_object('ok',true,'found',true,'conflict',true);
    END IF;
    v_status := CASE WHEN v_job.state='STORED' THEN
        CASE WHEN v_job.editor_ai_edit_result IS NOT NULL AND v_job.editor_ai_edit_expires_at>now() AND v_job.deleted_at IS NULL THEN 'completed' ELSE 'expired' END
        WHEN v_job.state='REFUNDED' THEN 'failed' ELSE 'pending' END;
    RETURN jsonb_build_object('ok',true,'found',true,'status',v_status,
        'credits',v_job.credits,'model_id',v_job.model_id,'digest',v_job.inputs->>'request_hash',
        'refunded',v_job.state='REFUNDED',
        'result',CASE WHEN v_status='completed' THEN v_job.editor_ai_edit_result ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.editor_ai_edit_lookup(TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.editor_ai_edit_lookup(TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.purge_editor_ai_edit_results()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    UPDATE public.jobs SET editor_ai_edit_result=NULL
    WHERE editor_ai_edit_result IS NOT NULL AND editor_ai_edit_expires_at<=now();
$$;
REVOKE ALL ON FUNCTION public.purge_editor_ai_edit_results() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_editor_ai_edit_results() TO service_role;
SELECT cron.schedule('veyrnox-purge-editor-ai-edit','* * * * *',$$ SELECT public.purge_editor_ai_edit_results(); $$);

CREATE OR REPLACE FUNCTION private.editor_ai_edit_forget_erased_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        UPDATE public.jobs SET editor_ai_edit_result=NULL,editor_ai_edit_expires_at=NULL
        WHERE user_id=NEW.id AND editor_ai_edit_result IS NOT NULL;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.editor_ai_edit_forget_erased_user() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS users_editor_ai_edit_forget_erased ON public.users;
CREATE TRIGGER users_editor_ai_edit_forget_erased AFTER UPDATE OF deleted_at ON public.users
    FOR EACH ROW EXECUTE FUNCTION private.editor_ai_edit_forget_erased_user();

-- Current Library readers copied from 0397; no new media rows for text-only edits.
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
      AND inputs->>'kind' IS DISTINCT FROM 'editor_ai_edit';
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
          AND b.inputs->>'kind' IS DISTINCT FROM 'editor_ai_edit'
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
    IF NOT FOUND OR v_job.deleted_at IS NOT NULL OR v_job.inputs->>'kind' IN ('chat','editor_ai_edit') THEN
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
            AND j.inputs->>'kind' IS DISTINCT FROM 'chat' AND j.inputs->>'kind' IS DISTINCT FROM 'editor_ai_edit' AND j.created_at <= pg_catalog.now()
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
