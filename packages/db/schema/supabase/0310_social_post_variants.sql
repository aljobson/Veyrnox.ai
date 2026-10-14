BEGIN;

-- Validate per-network text against the exact active destinations selected for
-- the post. The Worker performs the user-facing validation; this is the
-- transactional boundary that prevents forged RPC calls from persisting it.
CREATE OR REPLACE FUNCTION private.social_post_variants_valid(
  p_brand_id UUID, p_account_ids UUID[], p_network_text JSONB
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_network_text IS NOT NULL
    AND jsonb_typeof(p_network_text) = 'object'
    AND (SELECT count(*) FROM jsonb_object_keys(p_network_text)) BETWEEN 1 AND 11
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_each(p_network_text) e(network, value)
      WHERE jsonb_typeof(e.value) <> 'string'
         OR char_length(btrim(e.value #>> '{}')) = 0
         OR char_length(e.value #>> '{}') > CASE e.network
           WHEN 'instagram' THEN 2200 WHEN 'linkedin' THEN 3000 WHEN 'twitter' THEN 280
           WHEN 'tiktok' THEN 2200 WHEN 'youtube' THEN 4000 WHEN 'facebook' THEN 4000
           WHEN 'threads' THEN 500 WHEN 'pinterest' THEN 800 WHEN 'bluesky' THEN 300
           WHEN 'gmb' THEN 1500 ELSE 0 END
         OR NOT EXISTS (
           SELECT 1 FROM public.social_accounts a
           WHERE a.brand_id = p_brand_id AND a.id = ANY(p_account_ids)
             AND a.status = 'active' AND a.network = e.network
         )
    )
$$;
REVOKE ALL ON FUNCTION private.social_post_variants_valid(UUID,UUID[],JSONB) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_social_post_with_options(
  p_auth_id TEXT, p_brand_id UUID, p_scheduled_at TIMESTAMPTZ,
  p_global_text TEXT, p_idempotency_key TEXT, p_account_ids UUID[],
  p_media JSONB, p_network_text JSONB, p_youtube_visibility TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result JSONB; v_post_id UUID;
BEGIN
  IF NOT private.social_post_variants_valid(p_brand_id,p_account_ids,p_network_text) THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_NETWORK_TEXT');
  END IF;
  IF p_youtube_visibility IS NOT NULL AND p_youtube_visibility NOT IN ('private','unlisted','public') THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_YOUTUBE_VISIBILITY');
  END IF;
  v_result := public.create_social_post(p_auth_id,p_brand_id,p_scheduled_at,p_global_text,
    p_idempotency_key,p_account_ids,p_media);
  IF coalesce((v_result->>'ok')::BOOLEAN,false) AND NOT coalesce((v_result->>'idempotent')::BOOLEAN,false) THEN
    v_post_id := (v_result->>'post_id')::UUID;
    UPDATE public.social_post_targets t SET text_override=p_network_text->>t.network
      WHERE t.post_id=v_post_id AND p_network_text ? t.network;
    IF p_youtube_visibility IS NOT NULL THEN
      UPDATE public.social_post_targets t
        SET provider_state=coalesce(t.provider_state,'{}'::jsonb)||jsonb_build_object('youtube_visibility',p_youtube_visibility)
        WHERE t.post_id=v_post_id AND t.network='youtube';
    END IF;
  END IF;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.create_social_post_with_options(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,UUID[],JSONB,JSONB,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_social_post_with_options(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,UUID[],JSONB,JSONB,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.create_social_post_approval_with_variants(
  p_auth_id TEXT,p_brand_id UUID,p_batch_id UUID,p_scheduled_at TIMESTAMPTZ,p_global_text TEXT,
  p_idempotency_key TEXT,p_account_ids UUID[],p_media JSONB,p_policy TEXT,p_reviewer_emails JSONB,
  p_youtube_visibility TEXT,p_network_text JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result JSONB; v_post_id UUID;
BEGIN
  IF NOT private.social_post_variants_valid(p_brand_id,p_account_ids,p_network_text) THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_NETWORK_TEXT');
  END IF;
  v_result := public.create_social_post_approval(p_auth_id,p_brand_id,p_batch_id,p_scheduled_at,p_global_text,
    p_idempotency_key,p_account_ids,p_media,p_policy,p_reviewer_emails,p_youtube_visibility);
  IF coalesce((v_result->>'ok')::BOOLEAN,false) AND NOT coalesce((v_result->>'idempotent')::BOOLEAN,false) THEN
    v_post_id := (v_result->>'post_id')::UUID;
    UPDATE public.social_post_targets t SET text_override=p_network_text->>t.network
      WHERE t.post_id=v_post_id AND p_network_text ? t.network;
  END IF;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.create_social_post_approval_with_variants(TEXT,UUID,UUID,TIMESTAMPTZ,TEXT,TEXT,UUID[],JSONB,TEXT,JSONB,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_social_post_approval_with_variants(TEXT,UUID,UUID,TIMESTAMPTZ,TEXT,TEXT,UUID[],JSONB,TEXT,JSONB,TEXT,JSONB) TO service_role;

-- Return overrides to the composer so "Use again" restores the actual copy.
CREATE OR REPLACE FUNCTION public.list_social_posts(
  p_auth_id TEXT,p_brand_id UUID,p_limit INTEGER DEFAULT 24,
  p_before_created_at TIMESTAMPTZ DEFAULT NULL,p_before_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID;v_limit INTEGER:=least(greatest(coalesce(p_limit,24),1),50);v_rows JSONB;
BEGIN
  IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND');END IF;
  SELECT u.id INTO v_user FROM public.users u JOIN auth.users a ON a.id=p_auth_id::UUID WHERE u.auth_id=p_auth_id;
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND');END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_brands b WHERE b.id=p_brand_id AND b.owner_user_id=v_user) THEN RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND');END IF;
  SELECT coalesce(jsonb_agg(row_json ORDER BY row_created_at DESC,row_id DESC),'[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object('id',p.id,'status',p.status,'scheduled_at',p.scheduled_at,'global_text',p.global_text,'created_at',p.created_at,
      'media',coalesce((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('media_type',m.media_type,'job_id',m.source_job_id,'upload_id',m.source_upload_id)) ORDER BY m.position) FROM public.social_post_media m WHERE m.post_id=p.id),'[]'::jsonb),
      'targets',coalesce((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',t.id,'account_id',t.account_id,'network',t.network,'text_override',t.text_override,'publish_status',t.publish_status,'platform_post_url',t.platform_post_url,'last_error',t.last_error)) ORDER BY t.network) FROM public.social_post_targets t WHERE t.post_id=p.id),'[]'::jsonb)) row_json,
      p.created_at row_created_at,p.id row_id FROM public.social_posts p WHERE p.brand_id=p_brand_id
      AND (p_before_created_at IS NULL OR (p.created_at,p.id)<(p_before_created_at,coalesce(p_before_id,'00000000-0000-0000-0000-000000000000'::UUID)))
      ORDER BY p.created_at DESC,p.id DESC LIMIT v_limit
  ) ranked;
  RETURN jsonb_build_object('ok',true,'posts',v_rows);
END $$;
REVOKE ALL ON FUNCTION public.list_social_posts(TEXT,UUID,INTEGER,TIMESTAMPTZ,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_social_posts(TEXT,UUID,INTEGER,TIMESTAMPTZ,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.get_social_approval_review(p_reviewer_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v JSONB;
BEGIN
  SELECT jsonb_build_object('ok',true,'reviewer_id',rv.id,'decision',rv.decision,
    'request_id',r.id,'request_status',r.status,'policy',r.policy,'scheduled_at',p.scheduled_at,
    'global_text',p.global_text,'brand_name',b.label,
    'networks',(SELECT coalesce(jsonb_agg(t.network ORDER BY t.network),'[]'::jsonb) FROM public.social_post_targets t WHERE t.post_id=p.id),
    'targets',(SELECT coalesce(jsonb_agg(jsonb_build_object('network',t.network,'text',coalesce(t.text_override,p.global_text)) ORDER BY t.network),'[]'::jsonb) FROM public.social_post_targets t WHERE t.post_id=p.id),
    'media',(SELECT jsonb_strip_nulls(jsonb_build_object('media_type',m.media_type,'r2_key',coalesce(a.r2_key,u.r2_key),'mime_type',coalesce(a.mime_type,u.mime_type)))
      FROM public.social_post_media m LEFT JOIN public.assets a ON a.job_id=m.source_job_id LEFT JOIN public.social_uploads u ON u.id=m.source_upload_id WHERE m.post_id=p.id ORDER BY m.position LIMIT 1)) INTO v
  FROM public.social_approval_reviewers rv JOIN public.social_approval_requests r ON r.id=rv.request_id
  JOIN public.social_posts p ON p.id=r.post_id JOIN public.social_brands b ON b.id=r.brand_id WHERE rv.id=p_reviewer_id;
  RETURN coalesce(v,jsonb_build_object('ok',false,'code','REVIEW_NOT_FOUND'));
END $$;
REVOKE ALL ON FUNCTION public.get_social_approval_review(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_social_approval_review(UUID) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
