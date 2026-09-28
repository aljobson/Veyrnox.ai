-- 0156_social_publish_scheduling.sql — ADR-0061 Phase 3: the publish-sweep
-- scheduling engine (technical spec §2.2, §2.6).
--
-- social_posts / social_post_media / social_post_targets hold what a user
-- scheduled and, per-network, whether it went out. create_social_post is the
-- only write path (RPC-only, per Phase 1's own precedent) — there is no
-- composer UI yet, so this is exercised directly until that slice lands.
-- claim_due_social_post_targets / complete_social_post_target are the
-- Worker-only claim/report pair the five-minute cron sweep uses; they take
-- no p_auth_id because only service_role ever calls them (same shape as
-- next_top_up_backfill_batch / record_worker_task_health).
--
-- Additive and idempotent.

-- ── Posts ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.social_posts (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id           UUID        NOT NULL REFERENCES public.social_brands(id) ON DELETE CASCADE,
    created_by_user_id UUID        NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    status             TEXT        NOT NULL DEFAULT 'scheduled'
                           CHECK (status IN ('scheduled', 'published', 'failed', 'canceled')),
    scheduled_at       TIMESTAMPTZ NOT NULL,
    global_text        TEXT        NULL CHECK (global_text IS NULL OR char_length(global_text) <= 4000),
    idempotency_key    TEXT        NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT social_posts_brand_idempotency UNIQUE (brand_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS social_posts_brand_idx ON public.social_posts (brand_id);
CREATE INDEX IF NOT EXISTS social_posts_due_idx ON public.social_posts (scheduled_at) WHERE status = 'scheduled';
ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_posts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_posts FROM PUBLIC, anon, authenticated, service_role;

-- ── Media (ordered attachments) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.social_post_media (
    id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id     UUID    NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
    "position"  INTEGER NOT NULL CHECK ("position" >= 0),
    media_type  TEXT    NOT NULL CHECK (media_type IN ('image', 'video')),
    source_url  TEXT    NOT NULL CHECK (source_url ~ '^https://' AND char_length(source_url) <= 2048),
    CONSTRAINT social_post_media_post_position UNIQUE (post_id, "position")
);
ALTER TABLE public.social_post_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_post_media FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_post_media FROM PUBLIC, anon, authenticated, service_role;

-- ── Per-network dispatch state ──────────────────────────────────────────
-- claimed_at backstops a Worker invocation that claimed a target (set it
-- 'publishing', incremented attempts) and then died before completing it —
-- the claim query below reclaims anything stuck past PUBLISHING_TIMEOUT,
-- the same backstop role TIMEOUT_MINUTES plays in lib/byteplusSweep.js.
CREATE TABLE IF NOT EXISTS public.social_post_targets (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id            UUID        NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
    account_id         UUID        NOT NULL REFERENCES public.social_accounts(id) ON DELETE RESTRICT,
    network            TEXT        NOT NULL CHECK (network IN (
                           'instagram', 'facebook', 'twitter', 'linkedin', 'tiktok',
                           'youtube', 'pinterest', 'threads', 'bluesky', 'twitch', 'gmb')),
    text_override      TEXT        NULL CHECK (text_override IS NULL OR char_length(text_override) <= 4000),
    publish_status     TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (publish_status IN ('pending', 'publishing', 'published', 'failed')),
    attempts           INTEGER     NOT NULL DEFAULT 0,
    claimed_at         TIMESTAMPTZ NULL,
    next_attempt_at    TIMESTAMPTZ NULL,
    last_error         TEXT        NULL,
    platform_post_id   TEXT        NULL,
    platform_post_url  TEXT        NULL,
    published_at       TIMESTAMPTZ NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT social_post_targets_post_account UNIQUE (post_id, account_id)
);
CREATE INDEX IF NOT EXISTS social_post_targets_claim_idx ON public.social_post_targets (publish_status, next_attempt_at);
ALTER TABLE public.social_post_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_post_targets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_post_targets FROM PUBLIC, anon, authenticated, service_role;

-- ── create_social_post: schedule a post to one or more of the caller's own
-- connected accounts. {ok:true, idempotent, post_id, target_count} or
-- {ok:false, code} with USER_NOT_FOUND, BRAND_NOT_FOUND,
-- INVALID_IDEMPOTENCY_KEY, INVALID_SCHEDULE, NO_TARGET_ACCOUNTS,
-- ACCOUNT_NOT_FOUND, INVALID_MEDIA. p_media is a JSON array of
-- {media_type, source_url}, 1-10 items. Idempotent on (brand_id,
-- idempotency_key): a retried submit never double-schedules.
CREATE OR REPLACE FUNCTION public.create_social_post(
    p_auth_id TEXT,
    p_brand_id UUID,
    p_scheduled_at TIMESTAMPTZ,
    p_global_text TEXT,
    p_idempotency_key TEXT,
    p_account_ids UUID[],
    p_media JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user          UUID;
    v_post_id       UUID;
    v_existing      UUID;
    v_item          JSONB;
    v_position      INTEGER := 0;
    v_account_count INTEGER;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    SELECT u.id INTO v_user FROM public.users u
    JOIN auth.users a ON a.id = p_auth_id::UUID
    WHERE u.auth_id = p_auth_id;
    IF v_user IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.social_brands b WHERE b.id = p_brand_id AND b.owner_user_id = v_user) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BRAND_NOT_FOUND');
    END IF;

    IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_IDEMPOTENCY_KEY');
    END IF;
    SELECT id INTO v_existing FROM public.social_posts
    WHERE brand_id = p_brand_id AND idempotency_key = p_idempotency_key;
    IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'post_id', v_existing);
    END IF;

    IF p_scheduled_at IS NULL OR p_scheduled_at < now() - interval '5 minutes' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SCHEDULE');
    END IF;

    IF p_account_ids IS NULL OR array_length(p_account_ids, 1) IS NULL OR array_length(p_account_ids, 1) > 20 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NO_TARGET_ACCOUNTS');
    END IF;
    SELECT count(*) INTO v_account_count FROM public.social_accounts a
    WHERE a.id = ANY(p_account_ids) AND a.brand_id = p_brand_id AND a.status = 'active';
    IF v_account_count IS DISTINCT FROM array_length(p_account_ids, 1)
        OR v_account_count IS DISTINCT FROM (SELECT count(*) FROM (SELECT DISTINCT unnest(p_account_ids)) d) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_NOT_FOUND');
    END IF;

    IF p_media IS NULL OR jsonb_typeof(p_media) != 'array'
        OR jsonb_array_length(p_media) < 1 OR jsonb_array_length(p_media) > 10 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_MEDIA');
    END IF;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_media) LOOP
        IF NOT (v_item ? 'media_type' AND v_item ? 'source_url')
            OR (v_item->>'media_type') NOT IN ('image', 'video')
            OR (v_item->>'source_url') !~ '^https://' THEN
            RETURN jsonb_build_object('ok', false, 'code', 'INVALID_MEDIA');
        END IF;
    END LOOP;

    INSERT INTO public.social_posts (brand_id, created_by_user_id, status, scheduled_at, global_text, idempotency_key)
    VALUES (p_brand_id, v_user, 'scheduled', p_scheduled_at, p_global_text, p_idempotency_key)
    RETURNING id INTO v_post_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_media) LOOP
        INSERT INTO public.social_post_media (post_id, "position", media_type, source_url)
        VALUES (v_post_id, v_position, v_item->>'media_type', v_item->>'source_url');
        v_position := v_position + 1;
    END LOOP;

    INSERT INTO public.social_post_targets (post_id, account_id, network)
    SELECT v_post_id, a.id, a.network
    FROM public.social_accounts a
    WHERE a.id = ANY(p_account_ids) AND a.brand_id = p_brand_id AND a.status = 'active';

    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'post_id', v_post_id,
        'target_count', array_length(p_account_ids, 1));
END $$;

-- ── claim_due_social_post_targets: up to p_limit due targets, atomically
-- marked 'publishing' (SKIP LOCKED keeps concurrent sweep runs apart, same
-- idiom as next_top_up_backfill_batch). Reclaims anything left 'publishing'
-- past PUBLISHING_TIMEOUT — a Worker invocation that died mid-publish must
-- not orphan its targets forever. media_type/source_url are the post's
-- first attachment (position 0) — v1 dispatch is single-image only, so a
-- carousel's later items are not surfaced here.
CREATE OR REPLACE FUNCTION public.claim_due_social_post_targets(p_limit INTEGER)
RETURNS TABLE (
    target_id UUID, post_id UUID, account_id UUID, network TEXT,
    text_override TEXT, global_text TEXT, brand_id UUID, attempts INTEGER,
    access_token_enc BYTEA, external_account_id TEXT,
    media_type TEXT, source_url TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH due AS (
        SELECT t.id
        FROM public.social_post_targets t
        JOIN public.social_posts p ON p.id = t.post_id
        WHERE p.status = 'scheduled'
          AND p.scheduled_at <= now()
          AND (
              (t.publish_status = 'pending' AND (t.next_attempt_at IS NULL OR t.next_attempt_at <= now()))
              OR (t.publish_status = 'publishing' AND t.claimed_at <= now() - interval '15 minutes')
          )
        ORDER BY p.scheduled_at
        LIMIT least(greatest(COALESCE(p_limit, 1), 1), 50)
        FOR UPDATE OF t SKIP LOCKED
    ),
    claimed AS (
        UPDATE public.social_post_targets t
        SET publish_status = 'publishing', attempts = t.attempts + 1, claimed_at = now()
        FROM due
        WHERE t.id = due.id
        RETURNING t.id, t.post_id, t.account_id, t.network, t.text_override, t.attempts
    )
    SELECT c.id, c.post_id, c.account_id, c.network, c.text_override, p.global_text, p.brand_id, c.attempts,
        a.access_token_enc, a.external_account_id, m.media_type, m.source_url
    FROM claimed c
    JOIN public.social_posts p ON p.id = c.post_id
    JOIN public.social_accounts a ON a.id = c.account_id
    LEFT JOIN LATERAL (
        SELECT media_type, source_url FROM public.social_post_media pm
        WHERE pm.post_id = c.post_id ORDER BY pm."position" LIMIT 1
    ) m ON true;
$$;

-- ── complete_social_post_target: the sweep's report-back. A failure below
-- 3 total attempts is requeued with exponential backoff (5, 10, 20 minutes);
-- at 3 it is terminal. Once no target for the post is still pending or
-- publishing, the parent post's own status settles to 'published' (at
-- least one target succeeded) or 'failed' (none did).
CREATE OR REPLACE FUNCTION public.complete_social_post_target(
    p_target_id UUID,
    p_ok BOOLEAN,
    p_platform_post_id TEXT,
    p_platform_post_url TEXT,
    p_error TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_target    public.social_post_targets%ROWTYPE;
    v_pending   INTEGER;
    v_published INTEGER;
BEGIN
    SELECT * INTO v_target FROM public.social_post_targets WHERE id = p_target_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'TARGET_NOT_FOUND');
    END IF;

    IF p_ok THEN
        UPDATE public.social_post_targets
        SET publish_status = 'published', published_at = now(),
            platform_post_id = p_platform_post_id, platform_post_url = p_platform_post_url, last_error = NULL
        WHERE id = p_target_id;
    ELSIF v_target.attempts >= 3 THEN
        UPDATE public.social_post_targets
        SET publish_status = 'failed', last_error = left(COALESCE(p_error, 'unknown_error'), 500)
        WHERE id = p_target_id;
    ELSE
        UPDATE public.social_post_targets
        SET publish_status = 'pending', last_error = left(COALESCE(p_error, 'unknown_error'), 500),
            next_attempt_at = now() + make_interval(mins => least(5 * (1 << (v_target.attempts - 1)), 60))
        WHERE id = p_target_id;
    END IF;

    SELECT count(*) FILTER (WHERE publish_status IN ('pending', 'publishing')),
           count(*) FILTER (WHERE publish_status = 'published')
    INTO v_pending, v_published
    FROM public.social_post_targets WHERE post_id = v_target.post_id;
    IF v_pending = 0 THEN
        UPDATE public.social_posts
        SET status = CASE WHEN v_published > 0 THEN 'published' ELSE 'failed' END, updated_at = now()
        WHERE id = v_target.post_id AND status = 'scheduled';
    END IF;

    RETURN jsonb_build_object('ok', true);
END $$;

-- ── Grants ────────────────────────────────────────────────────────────────
DO $$
DECLARE fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.create_social_post(TEXT, UUID, TIMESTAMPTZ, TEXT, TEXT, UUID[], JSONB)',
        'public.claim_due_social_post_targets(INTEGER)',
        'public.complete_social_post_target(UUID, BOOLEAN, TEXT, TEXT, TEXT)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END $$;

-- worker_task_health (0131, widened by 0145) bounds task names with an
-- inline CHECK. Widen it for the publish sweep; dropping by the generated
-- name and re-adding keeps the migration replayable.
ALTER TABLE public.worker_task_health DROP CONSTRAINT IF EXISTS worker_task_health_task_check;
ALTER TABLE public.worker_task_health
    ADD CONSTRAINT worker_task_health_task_check
    CHECK (task IN ('top_up_backfill', 'upload_sweep', 'auto_short', 'asset_reap', 'grsai', 'byteplus', 'publish_sweep'));

-- The snapshot only expects a heartbeat once a brand has a due-able post, so
-- an idle Publish feature never reads as unhealthy. Body is the 0145
-- definition (byteplus line included) plus the publish_sweep line; a later
-- redefinition must carry this line forward.
CREATE OR REPLACE FUNCTION public.refresh_recovery_health()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    INSERT INTO public.recovery_health_snapshot(singleton, observed_at, summary)
    SELECT true, statement_timestamp(), jsonb_build_object(
        'unhealthy_tasks', (SELECT COALESCE(jsonb_agg(t.task ORDER BY t.task), '[]'::jsonb)
            FROM (SELECT unnest(ARRAY['top_up_backfill','upload_sweep','asset_reap']) AS task
                UNION ALL SELECT 'grsai' WHERE EXISTS (SELECT 1 FROM public.model_catalog WHERE active AND provider = 'grsai')
                UNION ALL SELECT 'byteplus' WHERE EXISTS (SELECT 1 FROM public.model_catalog WHERE active AND provider = 'byteplus')
                UNION ALL SELECT 'auto_short' WHERE EXISTS (SELECT 1 FROM public.model_catalog WHERE active AND id = 'auto-short-32s')
                UNION ALL SELECT 'publish_sweep' WHERE EXISTS (SELECT 1 FROM public.social_posts WHERE status = 'scheduled' AND scheduled_at <= statement_timestamp() - interval '20 minutes')) t
            LEFT JOIN public.worker_task_health h ON h.task = t.task
            WHERE h.last_success IS NULL OR NOT h.last_ok OR h.last_success < statement_timestamp() - INTERVAL '20 minutes'),
        'cinema_poll_overdue', (SELECT count(*) FROM public.cinema_uploads WHERE state IN ('uploading','processing') AND stream_uid IS NOT NULL
            AND COALESCE(recovery_checked_at,created_at) < statement_timestamp()-interval '40 minutes'),
        'cinema_poll_failed', (SELECT count(*) FROM public.cinema_uploads WHERE state IN ('uploading','processing') AND recovery_failed),
        'cinema_provisioning_stuck', (SELECT count(*) FROM public.cinema_uploads WHERE state='provisioning' AND created_at < statement_timestamp()-interval '5 minutes'),
        'cinema_processing_stuck', (SELECT count(*) FROM public.cinema_uploads WHERE state='processing' AND created_at < statement_timestamp()-interval '3 hours'),
        'cinema_cleanup_required', (SELECT count(*) FROM public.cinema_uploads WHERE state='error'
            OR (state='deleting' AND delete_requested_at < statement_timestamp()-interval '30 minutes')
            OR (state='uploading' AND expires_at < statement_timestamp()-interval '15 minutes')),
        'reap_exhausted', (SELECT count(*) FROM public.asset_reap_queue WHERE attempts >= 8),
        'reap_overdue', (SELECT count(*) FROM public.asset_reap_queue WHERE queued_at < statement_timestamp() - INTERVAL '1 hour'),
        'stale_jobs', (SELECT count(*) FROM public.jobs WHERE state IN ('DEBITED','SUBMITTED','SUCCEEDED','FAILOVER','FAILED')
            AND updated_at < statement_timestamp() - INTERVAL '3 hours'),
        'stale_top_up_returns', (SELECT count(*) FROM public.top_ups WHERE status = 'pending' AND return_order_id IS NOT NULL AND return_closed_at IS NULL
            AND COALESCE(backfill_checked_at, returned_at + INTERVAL '10 minutes') < statement_timestamp() - INTERVAL '8 hours'),
        'unreviewed_flagged_orders', (SELECT count(*) FROM public.top_up_flagged_orders f WHERE NOT EXISTS
            (SELECT 1 FROM public.recovery_alert_reviews r WHERE r.kind = 'flagged_order' AND r.incident_key = f.order_id)),
        'unreviewed_order_collisions', (SELECT count(*) FROM public.top_up_order_collisions c WHERE NOT EXISTS
            (SELECT 1 FROM public.recovery_alert_reviews r WHERE r.kind = 'order_collision' AND r.incident_key = c.id::TEXT))
    ) ON CONFLICT(singleton) DO UPDATE SET observed_at = EXCLUDED.observed_at, summary = EXCLUDED.summary;
$$;
REVOKE ALL ON FUNCTION public.refresh_recovery_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_recovery_health() TO service_role;
