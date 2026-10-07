-- ADR-0061: immutable device uploads, owned independently of generation jobs.
CREATE TABLE IF NOT EXISTS public.social_uploads (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    r2_key TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL CHECK (length(filename) BETWEEN 1 AND 180),
    mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','video/mp4')),
    size_bytes BIGINT NOT NULL CHECK (size_bytes BETWEEN 1 AND 104857600),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','deleting','deleted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    put_expires_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() + interval '16 minutes'
);
ALTER TABLE public.social_uploads DROP CONSTRAINT IF EXISTS social_uploads_status_check;
ALTER TABLE public.social_uploads ADD CONSTRAINT social_uploads_status_check
    CHECK (status IN ('pending','ready','deleting','deleted'));
CREATE INDEX IF NOT EXISTS social_uploads_user_idx ON public.social_uploads(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS social_uploads_cleanup_idx ON public.social_uploads(status, created_at);
ALTER TABLE public.social_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_uploads FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_uploads FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.social_uploads TO service_role;
ALTER TABLE public.social_post_media ALTER COLUMN source_job_id DROP NOT NULL;
ALTER TABLE public.social_post_media ADD COLUMN IF NOT EXISTS source_upload_id UUID
    REFERENCES public.social_uploads(id) ON DELETE RESTRICT;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_media_one_source'
        AND conrelid = 'public.social_post_media'::regclass) THEN
        ALTER TABLE public.social_post_media ADD CONSTRAINT social_media_one_source
            CHECK ((source_job_id IS NOT NULL)::integer + (source_upload_id IS NOT NULL)::integer = 1);
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS social_media_upload_idx ON public.social_post_media(source_upload_id)
    WHERE source_upload_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reserve_social_upload(
    p_auth_id TEXT, p_id UUID, p_filename TEXT, p_mime_type TEXT, p_size BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_count BIGINT; v_bytes BIGINT; v_key TEXT; v_ext TEXT;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id FOR UPDATE;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
    IF p_id IS NULL OR p_filename IS NULL OR length(p_filename) NOT BETWEEN 1 AND 180
        OR p_size IS NULL OR p_size < 1 OR p_mime_type IS NULL
        OR p_mime_type NOT IN ('image/jpeg','image/png','image/webp','video/mp4')
        OR p_size > (CASE WHEN p_mime_type = 'video/mp4' THEN 104857600 ELSE 20971520 END) THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_UPLOAD');
    END IF;
    SELECT count(*), coalesce(sum(size_bytes),0) INTO v_count,v_bytes
        FROM public.social_uploads WHERE user_id = v_user AND status <> 'deleted';
    IF v_count >= 10 OR v_bytes + p_size > 209715200 THEN
        RETURN jsonb_build_object('ok',false,'code','UPLOAD_BUDGET_EXCEEDED');
    END IF;
    v_ext := CASE p_mime_type WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png'
        WHEN 'image/webp' THEN 'webp' ELSE 'mp4' END;
    v_key := 'social-uploads/' || lower(p_auth_id) || '/' || p_id::text || '.' || v_ext;
    INSERT INTO public.social_uploads(id,user_id,r2_key,filename,mime_type,size_bytes)
        VALUES(p_id,v_user,v_key,p_filename,p_mime_type,p_size);
    RETURN jsonb_build_object('ok',true,'id',p_id,'r2_key',v_key);
END $$;

CREATE OR REPLACE FUNCTION public.read_social_upload(p_auth_id TEXT, p_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT jsonb_build_object('ok',true,'uploads',coalesce(jsonb_agg(
        jsonb_build_object('id',s.id,'r2_key',s.r2_key,'filename',s.filename,
        'mime_type',s.mime_type,'size_bytes',s.size_bytes,'status',s.status) ORDER BY s.created_at DESC),'[]'::jsonb))
    FROM public.social_uploads s JOIN public.users u ON u.id = s.user_id
    WHERE u.auth_id = p_auth_id AND s.status IN ('pending','ready')
        AND ((p_id IS NULL AND s.status = 'ready') OR s.id = p_id);
$$;

-- Completion metadata is trusted only after the Worker checks R2 headers and magic bytes.
CREATE OR REPLACE FUNCTION public.complete_social_upload(p_auth_id TEXT, p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_upload public.social_uploads%ROWTYPE;
BEGIN
    SELECT s.* INTO v_upload FROM public.social_uploads s JOIN public.users u ON u.id = s.user_id
        WHERE u.auth_id = p_auth_id AND s.id = p_id FOR UPDATE OF s;
    IF NOT FOUND OR v_upload.status IN ('deleting','deleted') OR
        (v_upload.status = 'pending' AND v_upload.created_at < now() - interval '24 hours') THEN
        RETURN jsonb_build_object('ok',false,'code','UPLOAD_NOT_FOUND');
    END IF;
    UPDATE public.social_uploads SET status = 'ready' WHERE id = p_id;
    RETURN jsonb_build_object('ok',true,'id',p_id);
END $$;

CREATE OR REPLACE FUNCTION public.remove_social_upload(p_auth_id TEXT, p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.social_uploads WHERE id = p_id AND user_id = v_user) THEN
        RETURN jsonb_build_object('ok',false,'code','UPLOAD_NOT_FOUND');
    END IF;
    IF EXISTS (SELECT 1 FROM public.social_post_media m JOIN public.social_posts p ON p.id = m.post_id
        WHERE m.source_upload_id = p_id AND (p.status IN ('draft','scheduled') OR EXISTS (
            SELECT 1 FROM public.social_post_targets t WHERE t.post_id = p.id
                AND t.publish_status NOT IN ('published','delivered','failed')))) THEN
        RETURN jsonb_build_object('ok',false,'code','UPLOAD_IN_USE');
    END IF;
    UPDATE public.social_uploads SET status = 'deleting' WHERE id = p_id AND user_id = v_user AND status <> 'deleted';
    RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.claim_social_upload_cleanup()
RETURNS SETOF public.social_uploads LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    UPDATE public.social_uploads SET status = 'deleting' WHERE id IN (
        SELECT id FROM public.social_uploads WHERE
        (status = 'pending' AND created_at < now() - interval '24 hours')
        OR (status = 'deleting' AND put_expires_at < now())
        ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED
    ) RETURNING *;
$$;
CREATE OR REPLACE FUNCTION public.release_social_upload(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.social_post_media WHERE source_upload_id = p_id) THEN
        -- Retain the post's receipt, without holding bytes or upload capacity.
        UPDATE public.social_uploads SET status = 'deleted'
            WHERE id = p_id AND status = 'deleting' AND put_expires_at < now();
    ELSE
        DELETE FROM public.social_uploads WHERE id = p_id AND status = 'deleting' AND put_expires_at < now();
    END IF;
END $$;

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
    WHERE u.auth_id = p_auth_id FOR UPDATE OF u;
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
        IF jsonb_typeof(v_item) <> 'object' OR (v_item->>'media_type') IS NULL
            OR (v_item->>'media_type') NOT IN ('image','video')
            OR (v_item ? 'job_id') = (v_item ? 'upload_id') THEN
            RETURN jsonb_build_object('ok',false,'code','INVALID_MEDIA');
        END IF;
        IF v_item ? 'job_id' THEN
            IF (v_item->>'job_id') IS NULL OR (v_item->>'job_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
                RETURN jsonb_build_object('ok',false,'code','INVALID_MEDIA');
            END IF;
            IF NOT EXISTS (SELECT 1 FROM public.assets a JOIN public.jobs j ON j.id = a.job_id
                WHERE j.id = (v_item->>'job_id')::uuid AND j.user_id = v_user
                AND split_part(a.mime_type,'/',1) = v_item->>'media_type') THEN
                RETURN jsonb_build_object('ok',false,'code','MEDIA_NOT_FOUND');
            END IF;
        ELSE
            IF (v_item->>'upload_id') IS NULL OR (v_item->>'upload_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
                RETURN jsonb_build_object('ok',false,'code','INVALID_MEDIA');
            END IF;
            IF NOT EXISTS (SELECT 1 FROM public.social_uploads WHERE id = (v_item->>'upload_id')::uuid
                AND user_id = v_user AND status = 'ready'
                AND split_part(mime_type,'/',1) = v_item->>'media_type') THEN
                RETURN jsonb_build_object('ok',false,'code','MEDIA_NOT_FOUND');
            END IF;
        END IF;
    END LOOP;

    INSERT INTO public.social_posts (brand_id, created_by_user_id, status, scheduled_at, global_text, idempotency_key)
    VALUES (p_brand_id, v_user, 'scheduled', p_scheduled_at, p_global_text, p_idempotency_key)
    RETURNING id INTO v_post_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_media) LOOP
        INSERT INTO public.social_post_media (post_id, "position", media_type, source_job_id, source_upload_id)
        VALUES (v_post_id, v_position, v_item->>'media_type', (v_item->>'job_id')::UUID, (v_item->>'upload_id')::UUID);
        v_position := v_position + 1;
    END LOOP;

    INSERT INTO public.social_post_targets (post_id, account_id, network)
    SELECT v_post_id, a.id, a.network
    FROM public.social_accounts a
    WHERE a.id = ANY(p_account_ids) AND a.brand_id = p_brand_id AND a.status = 'active';

    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'post_id', v_post_id,
        'target_count', array_length(p_account_ids, 1));
END $$;


CREATE OR REPLACE FUNCTION public.claim_due_social_post_targets(p_limit INTEGER)
RETURNS TABLE (
    target_id UUID, post_id UUID, account_id UUID, network TEXT,
    text_override TEXT, global_text TEXT, brand_id UUID, attempts INTEGER,
    access_token_enc BYTEA, refresh_token_enc BYTEA, token_expires_at TIMESTAMPTZ,
    external_account_id TEXT, media_type TEXT, r2_key TEXT,
    mime_type TEXT, size_bytes BIGINT, provider_state JSONB, claim_key UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
    PERFORM public.social_fail_inactive_targets(NULL);

    RETURN QUERY
    WITH due AS (
        SELECT t.id, t.publish_status AS prior_status
        FROM public.social_post_targets t
        JOIN public.social_posts p ON p.id = t.post_id
        JOIN public.social_accounts a ON a.id = t.account_id
        WHERE p.status = 'scheduled'
          AND p.scheduled_at <= now()
          AND a.status = 'active'
          AND (
              (t.publish_status = 'pending' AND (t.next_attempt_at IS NULL OR t.next_attempt_at <= now()))
              OR (t.publish_status = 'submitted' AND t.next_attempt_at IS NOT NULL AND t.next_attempt_at <= now())
              OR (t.publish_status = 'publishing' AND t.claimed_at <= now() - interval '15 minutes')
          )
        ORDER BY p.scheduled_at
        LIMIT least(greatest(COALESCE(p_limit, 1), 1), 50)
        FOR UPDATE OF t SKIP LOCKED
    ),
    claimed AS (
        UPDATE public.social_post_targets t
        SET publish_status = 'publishing',
            claimed_at = now(),
            claim_key = gen_random_uuid(),
            attempts = CASE WHEN due.prior_status = 'submitted' THEN t.attempts ELSE t.attempts + 1 END
        FROM due
        WHERE t.id = due.id
        RETURNING t.id, t.post_id, t.account_id, t.network, t.text_override, t.attempts, t.provider_state, t.claim_key
    )
    SELECT c.id, c.post_id, c.account_id, c.network, c.text_override, p.global_text, p.brand_id, c.attempts,
        a.access_token_enc, a.refresh_token_enc, a.token_expires_at, a.external_account_id,
        m.media_type, coalesce(ast.r2_key,up.r2_key), coalesce(ast.mime_type,up.mime_type), coalesce(ast.size_bytes,up.size_bytes), c.provider_state, c.claim_key
    FROM claimed c
    JOIN public.social_posts p ON p.id = c.post_id
    JOIN public.social_accounts a ON a.id = c.account_id
    LEFT JOIN LATERAL (
        SELECT pm.media_type, pm.source_job_id, pm.source_upload_id FROM public.social_post_media pm
        WHERE pm.post_id = c.post_id ORDER BY pm."position" LIMIT 1
    ) m ON true
    LEFT JOIN LATERAL (
        SELECT x.r2_key, x.mime_type, x.size_bytes FROM public.assets x
        WHERE x.job_id = m.source_job_id ORDER BY x.created_at LIMIT 1
    ) ast ON true
    LEFT JOIN public.social_uploads up ON up.id = m.source_upload_id AND up.status = 'ready';
END $$;


DO $$ DECLARE fn TEXT; BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.reserve_social_upload(TEXT,UUID,TEXT,TEXT,BIGINT)',
        'public.read_social_upload(TEXT,UUID)', 'public.complete_social_upload(TEXT,UUID)',
        'public.remove_social_upload(TEXT,UUID)', 'public.claim_social_upload_cleanup()',
        'public.release_social_upload(UUID)',
        'public.create_social_post(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,UUID[],JSONB)',
        'public.claim_due_social_post_targets(INTEGER)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn);
    END LOOP;
END $$;
