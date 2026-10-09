-- Additive RPC: previous releases continue calling create_social_post unchanged.
-- Visibility is written atomically with creation and retained on idempotent replay.
CREATE OR REPLACE FUNCTION public.create_social_post_with_youtube_visibility(
    p_auth_id TEXT, p_brand_id UUID, p_scheduled_at TIMESTAMPTZ,
    p_global_text TEXT, p_idempotency_key TEXT, p_account_ids UUID[],
    p_media JSONB, p_youtube_visibility TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF p_youtube_visibility IS NULL OR p_youtube_visibility NOT IN ('private', 'unlisted', 'public') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_YOUTUBE_VISIBILITY');
    END IF;
    v_result := public.create_social_post(p_auth_id, p_brand_id, p_scheduled_at,
        p_global_text, p_idempotency_key, p_account_ids, p_media);
    IF v_result->>'ok' = 'true' AND v_result->>'idempotent' = 'false' THEN
        UPDATE public.social_post_targets
        SET provider_state = coalesce(provider_state, '{}'::jsonb)
            || jsonb_build_object('youtube_visibility', p_youtube_visibility)
        WHERE post_id = (v_result->>'post_id')::uuid AND network = 'youtube';
    END IF;
    RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.create_social_post_with_youtube_visibility(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,UUID[],JSONB,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_social_post_with_youtube_visibility(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,UUID[],JSONB,TEXT) TO service_role;
