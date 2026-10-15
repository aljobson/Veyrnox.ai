-- 0301: expose reusable post ingredients through the existing owner-scoped
-- post list. Raw storage keys and provider tokens remain private; the client
-- receives only owned job/upload references that the existing media endpoints
-- re-authorize before returning a short-lived preview URL.
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
                'media', COALESCE((
                    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                        'media_type', m.media_type,
                        'job_id', m.source_job_id,
                        'upload_id', m.source_upload_id
                    )) ORDER BY m."position")
                    FROM public.social_post_media m WHERE m.post_id = p.id
                ), '[]'::jsonb),
                'targets', COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                        'id', t.id, 'account_id', t.account_id, 'network', t.network,
                        'publish_status', t.publish_status,
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

REVOKE ALL ON FUNCTION public.list_social_posts(TEXT, UUID, INTEGER, TIMESTAMPTZ, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_social_posts(TEXT, UUID, INTEGER, TIMESTAMPTZ, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
