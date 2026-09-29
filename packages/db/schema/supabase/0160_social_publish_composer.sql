-- 0160_social_publish_composer.sql — ADR-0061 Phase 4: the composer UI's
-- write and read paths, plus a correctness fix in 0156 that the composer
-- would otherwise expose for the first time.
--
-- Fix: social_post_media.source_url baked a URL into the row at schedule
-- time, but every asset URL in this codebase is a presigned R2 GET link
-- capped at 15 minutes (CLAUDE.md; packages/adapters/r2.js's
-- presignGetUrl/presignPutUrl both hard-clamp to [60, 900] seconds — no
-- exception anywhere, not even for Cloudflare Stream video). A post
-- scheduled more than 15 minutes ahead would have an already-expired image
-- URL by publish time. Nothing has written a real row to this table yet —
-- 0156 shipped with no composer on top of it — so this is a column swap,
-- not a backfill: store the owning job instead, the same reference
-- get_user_asset (0109) already resolves on demand, and mint the R2 URL
-- fresh at dispatch time (lib/socialPublishSweep.js) instead of at
-- schedule time.
--
-- Additive/idempotent except where Postgres requires DROP+CREATE (a
-- RETURNS TABLE column swap can't go through CREATE OR REPLACE).

-- ── social_post_media: source_url -> source_job_id ─────────────────────
ALTER TABLE public.social_post_media DROP COLUMN IF EXISTS source_url;
ALTER TABLE public.social_post_media
    ADD COLUMN IF NOT EXISTS source_job_id UUID REFERENCES public.jobs(id) ON DELETE RESTRICT;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'social_post_media'
          AND column_name = 'source_job_id' AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE public.social_post_media ALTER COLUMN source_job_id SET NOT NULL;
    END IF;
END $$;

-- ── create_social_post: p_media items are now {media_type, job_id} — the
-- job must be one of the caller's own jobs with a stored asset (mirrors
-- get_user_asset's ownership join). Parameter types are unchanged, so
-- CREATE OR REPLACE is enough; only the media-item shape changes.
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
        IF NOT (v_item ? 'media_type' AND v_item ? 'job_id')
            OR (v_item->>'media_type') NOT IN ('image', 'video')
            OR (v_item->>'job_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RETURN jsonb_build_object('ok', false, 'code', 'INVALID_MEDIA');
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM public.assets a
            JOIN public.jobs j ON j.id = a.job_id
            WHERE j.id = (v_item->>'job_id')::UUID AND j.user_id = v_user
        ) THEN
            RETURN jsonb_build_object('ok', false, 'code', 'MEDIA_NOT_FOUND');
        END IF;
    END LOOP;

    INSERT INTO public.social_posts (brand_id, created_by_user_id, status, scheduled_at, global_text, idempotency_key)
    VALUES (p_brand_id, v_user, 'scheduled', p_scheduled_at, p_global_text, p_idempotency_key)
    RETURNING id INTO v_post_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_media) LOOP
        INSERT INTO public.social_post_media (post_id, "position", media_type, source_job_id)
        VALUES (v_post_id, v_position, v_item->>'media_type', (v_item->>'job_id')::UUID);
        v_position := v_position + 1;
    END LOOP;

    INSERT INTO public.social_post_targets (post_id, account_id, network)
    SELECT v_post_id, a.id, a.network
    FROM public.social_accounts a
    WHERE a.id = ANY(p_account_ids) AND a.brand_id = p_brand_id AND a.status = 'active';

    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'post_id', v_post_id,
        'target_count', array_length(p_account_ids, 1));
END $$;

-- ── claim_due_social_post_targets: surfaces r2_key instead of source_url
-- so the sweep can mint a fresh presigned URL right before dispatch. The
-- RETURNS TABLE column list changes, so this needs DROP+CREATE.
DROP FUNCTION IF EXISTS public.claim_due_social_post_targets(INTEGER);
CREATE FUNCTION public.claim_due_social_post_targets(p_limit INTEGER)
RETURNS TABLE (
    target_id UUID, post_id UUID, account_id UUID, network TEXT,
    text_override TEXT, global_text TEXT, brand_id UUID, attempts INTEGER,
    access_token_enc BYTEA, external_account_id TEXT,
    media_type TEXT, r2_key TEXT
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
        a.access_token_enc, a.external_account_id, m.media_type, ast.r2_key
    FROM claimed c
    JOIN public.social_posts p ON p.id = c.post_id
    JOIN public.social_accounts a ON a.id = c.account_id
    LEFT JOIN LATERAL (
        SELECT media_type, source_job_id FROM public.social_post_media pm
        WHERE pm.post_id = c.post_id ORDER BY pm."position" LIMIT 1
    ) m ON true
    LEFT JOIN LATERAL (
        SELECT r2_key FROM public.assets WHERE job_id = m.source_job_id ORDER BY created_at LIMIT 1
    ) ast ON true;
$$;

-- ── list_social_posts: cursor-paginated listing for the composer's
-- scheduled/published posts view (mirrors list_user_jobs's shape, 0109).
CREATE OR REPLACE FUNCTION public.list_social_posts(
    p_auth_id TEXT,
    p_brand_id UUID,
    p_limit INTEGER DEFAULT 24,
    p_before_created_at TIMESTAMPTZ DEFAULT NULL,
    p_before_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user  UUID;
    v_limit INTEGER := least(greatest(COALESCE(p_limit, 24), 1), 50);
    v_rows  JSONB;
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

    SELECT COALESCE(jsonb_agg(row_json ORDER BY row_created_at DESC, row_id DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
        SELECT
            jsonb_build_object(
                'id', p.id,
                'status', p.status,
                'scheduled_at', p.scheduled_at,
                'global_text', p.global_text,
                'created_at', p.created_at,
                'targets', COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                        'id', t.id, 'network', t.network, 'publish_status', t.publish_status,
                        'platform_post_url', t.platform_post_url, 'last_error', t.last_error
                    ) ORDER BY t.network)
                    FROM public.social_post_targets t WHERE t.post_id = p.id
                ), '[]'::jsonb)
            ) AS row_json,
            p.created_at AS row_created_at,
            p.id AS row_id
        FROM public.social_posts p
        WHERE p.brand_id = p_brand_id
          AND (
              p_before_created_at IS NULL
              OR (p.created_at, p.id) < (p_before_created_at, COALESCE(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid))
          )
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT v_limit
    ) ranked;

    RETURN jsonb_build_object('ok', true, 'posts', v_rows);
END $$;

-- ── Per-user write rate limit for the composer's POST endpoint (CLAUDE.md:
-- "Rate limit at the entry point... on all endpoints"). Same fixed-window
-- shape as 0117's account_read_rate_limits, scoped to a stricter write
-- bucket rather than reused directly.
CREATE TABLE IF NOT EXISTS public.social_post_write_rate_limits (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    window_started_at TIMESTAMPTZ NOT NULL,
    request_count INTEGER NOT NULL CHECK (request_count BETWEEN 1 AND 21)
);
ALTER TABLE public.social_post_write_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_post_write_rate_limits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.social_post_write_rate_limits FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consume_social_post_write_request(p_auth_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_now     TIMESTAMPTZ := clock_timestamp();
    v_start   TIMESTAMPTZ;
    v_count   INTEGER;
BEGIN
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    END IF;

    INSERT INTO public.social_post_write_rate_limits AS r (user_id, window_started_at, request_count)
    VALUES (v_user_id, v_now, 1)
    ON CONFLICT (user_id) DO UPDATE SET
        window_started_at = CASE WHEN r.window_started_at <= v_now - interval '60 seconds'
            THEN v_now ELSE r.window_started_at END,
        request_count = CASE WHEN r.window_started_at <= v_now - interval '60 seconds'
            THEN 1 ELSE LEAST(r.request_count + 1, 21) END
    RETURNING window_started_at, request_count INTO v_start, v_count;

    IF v_count > 20 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED', 'limit', 20,
            'retry_after_seconds', LEAST(60, GREATEST(1,
                ceil(extract(epoch FROM (v_start + interval '60 seconds' - v_now)))::INTEGER)));
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
        'public.list_social_posts(TEXT, UUID, INTEGER, TIMESTAMPTZ, UUID)',
        'public.consume_social_post_write_request(TEXT)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END $$;
