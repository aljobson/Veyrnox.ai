-- One Publish post by id, in the same row shape list_social_posts returns (0310).
-- Read-only; scoped to the brand so a post of any other brand is POST_NOT_FOUND,
-- the same answer as a post that does not exist. Used by GET /api/v1/social/posts/:id.
CREATE OR REPLACE FUNCTION public.get_social_post(p_auth_id TEXT,p_brand_id UUID,p_post_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID;v_row JSONB;
BEGIN
  IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND');END IF;
  SELECT u.id INTO v_user FROM public.users u JOIN auth.users a ON a.id=p_auth_id::UUID WHERE u.auth_id=p_auth_id;
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND');END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_brands b WHERE b.id=p_brand_id AND b.owner_user_id=v_user) THEN RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND');END IF;
  SELECT jsonb_build_object('id',p.id,'status',p.status,'scheduled_at',p.scheduled_at,'global_text',p.global_text,'created_at',p.created_at,'updated_at',p.updated_at,
      'media',coalesce((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('media_type',m.media_type,'job_id',m.source_job_id,'upload_id',m.source_upload_id)) ORDER BY m.position) FROM public.social_post_media m WHERE m.post_id=p.id),'[]'::jsonb),
      'targets',coalesce((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',t.id,'account_id',t.account_id,'network',t.network,'text_override',t.text_override,'publish_status',t.publish_status,'platform_post_url',t.platform_post_url,'last_error',t.last_error)) ORDER BY t.network) FROM public.social_post_targets t WHERE t.post_id=p.id),'[]'::jsonb))
    INTO v_row FROM public.social_posts p WHERE p.id=p_post_id AND p.brand_id=p_brand_id;
  IF v_row IS NULL THEN RETURN jsonb_build_object('ok',false,'code','POST_NOT_FOUND');END IF;
  RETURN jsonb_build_object('ok',true,'post',v_row);
END $$;
REVOKE ALL ON FUNCTION public.get_social_post(TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_social_post(TEXT,UUID,UUID) TO service_role;
