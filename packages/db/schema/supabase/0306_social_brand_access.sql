-- 0306: resolve every Publish brand the caller may access without exposing
-- another user's identity to the browser. Trusted routes use owner_auth_id
-- only when calling the legacy owner-scoped read RPCs; writes continue to use
-- the acting user's identity until their RPCs record delegated actors.
BEGIN;

CREATE OR REPLACE FUNCTION public.list_social_brand_access(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID;
BEGIN
  IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND');
  END IF;
  SELECT u.id INTO v_user FROM public.users u JOIN auth.users a ON a.id=p_auth_id::UUID WHERE u.auth_id=p_auth_id;
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;

  RETURN jsonb_build_object('ok',true,'brands',COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id',access.id,'label',access.label,'timezone',access.timezone,'role',access.role,
      'paid',EXISTS(SELECT 1 FROM public.social_publish_subscriptions s
        WHERE s.user_id=access.owner_user_id AND s.status IN ('active','past_due') AND s.current_period_end>now())
    ) ORDER BY CASE access.role WHEN 'owner' THEN 0 ELSE 1 END,access.label,access.id)
    FROM (
      SELECT b.id,b.label,b.timezone,b.owner_user_id,'owner'::TEXT role
      FROM public.social_brands b WHERE b.owner_user_id=v_user
      UNION ALL
      SELECT b.id,b.label,b.timezone,b.owner_user_id,m.role
      FROM public.social_brand_members m JOIN public.social_brands b ON b.id=m.brand_id
      WHERE m.user_id=v_user AND b.owner_user_id<>v_user
    ) access
  ),'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.get_social_brand_access(p_auth_id TEXT,p_brand_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID;v_brand public.social_brands%ROWTYPE;v_role TEXT;v_owner_auth TEXT;
BEGIN
  IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND');
  END IF;
  SELECT u.id INTO v_user FROM public.users u JOIN auth.users a ON a.id=p_auth_id::UUID WHERE u.auth_id=p_auth_id;
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
  SELECT * INTO v_brand FROM public.social_brands WHERE id=p_brand_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND'); END IF;
  IF v_brand.owner_user_id=v_user THEN v_role:='owner';
  ELSE SELECT m.role INTO v_role FROM public.social_brand_members m WHERE m.brand_id=p_brand_id AND m.user_id=v_user; END IF;
  IF v_role IS NULL THEN RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND'); END IF;
  SELECT auth_id INTO v_owner_auth FROM public.users WHERE id=v_brand.owner_user_id;
  RETURN jsonb_build_object('ok',true,'brand_id',v_brand.id,'label',v_brand.label,'timezone',v_brand.timezone,
    'role',v_role,'owner_auth_id',v_owner_auth,'paid',EXISTS(SELECT 1 FROM public.social_publish_subscriptions s
      WHERE s.user_id=v_brand.owner_user_id AND s.status IN ('active','past_due') AND s.current_period_end>now()));
END $$;

CREATE OR REPLACE FUNCTION public.social_brand_contains_post(p_auth_id TEXT,p_brand_id UUID,p_post_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_role TEXT;
BEGIN
  v_role:=public.social_brand_role(p_auth_id,p_brand_id);
  IF v_role IS NULL THEN RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND'); END IF;
  IF v_role<>'owner' THEN RETURN jsonb_build_object('ok',false,'code','FORBIDDEN'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_posts p WHERE p.id=p_post_id AND p.brand_id=p_brand_id) THEN
    RETURN jsonb_build_object('ok',false,'code','POST_NOT_FOUND');
  END IF;
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.social_brand_contains_queue_assignment(p_auth_id TEXT,p_brand_id UUID,p_assignment_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_role TEXT;
BEGIN
  v_role:=public.social_brand_role(p_auth_id,p_brand_id);
  IF v_role IS NULL THEN RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND'); END IF;
  IF v_role<>'owner' THEN RETURN jsonb_build_object('ok',false,'code','FORBIDDEN'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_publish_queue_assignments a WHERE a.id=p_assignment_id AND a.brand_id=p_brand_id) THEN
    RETURN jsonb_build_object('ok',false,'code','ASSIGNMENT_NOT_FOUND');
  END IF;
  RETURN jsonb_build_object('ok',true);
END $$;

REVOKE ALL ON FUNCTION public.list_social_brand_access(TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_social_brand_access(TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.social_brand_contains_post(TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.social_brand_contains_queue_assignment(TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_social_brand_access(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_social_brand_access(TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.social_brand_contains_post(TEXT,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.social_brand_contains_queue_assignment(TEXT,UUID,UUID) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
