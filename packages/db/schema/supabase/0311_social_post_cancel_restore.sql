-- 0311: safely cancel untouched scheduled posts and restore them later.
-- Provider-side posts are never deleted. Both operations are limited to
-- targets that the publishing worker has not claimed or attempted.
BEGIN;

CREATE OR REPLACE FUNCTION public.list_social_calendar(
    p_auth_id TEXT, p_brand_id UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ,
    p_status TEXT DEFAULT NULL, p_network TEXT DEFAULT NULL,
    p_after_at TIMESTAMPTZ DEFAULT NULL, p_after_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_rows JSONB; v_more BOOLEAN;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    SELECT u.id INTO v_user FROM public.users u JOIN auth.users a ON a.id=p_auth_id::UUID WHERE u.auth_id=p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    IF NOT EXISTS (SELECT 1 FROM public.social_brands WHERE id=p_brand_id AND owner_user_id=v_user) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BRAND_NOT_FOUND');
    END IF;
    IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to)
        OR p_to <= p_from OR p_to-p_from > INTERVAL '43 days'
        OR (p_status IS NOT NULL AND p_status NOT IN ('scheduled','published','failed','canceled'))
        OR (p_network IS NOT NULL AND p_network NOT IN ('instagram','facebook','twitter','linkedin','tiktok','youtube','pinterest','threads','bluesky','twitch','gmb'))
        OR ((p_after_at IS NULL) <> (p_after_id IS NULL)) OR (p_after_at IS NOT NULL AND NOT isfinite(p_after_at)) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_RANGE');
    END IF;
    SELECT COALESCE(jsonb_agg(x.row ORDER BY x.scheduled_at,x.id), '[]'::JSONB), count(*) > 100
    INTO v_rows,v_more FROM (
        SELECT p.id,p.scheduled_at,jsonb_build_object('id',p.id,'status',p.status,'scheduled_at',p.scheduled_at,
            'global_text',p.global_text,'created_at',p.created_at,'updated_at',p.updated_at,
            'can_reschedule',p.status='scheduled' AND EXISTS (SELECT 1 FROM public.social_post_targets WHERE post_id=p.id)
                AND NOT EXISTS (SELECT 1 FROM public.social_post_targets WHERE post_id=p.id AND (publish_status<>'pending' OR attempts<>0 OR claimed_at IS NOT NULL)),
            'can_cancel',p.status='scheduled' AND EXISTS (SELECT 1 FROM public.social_post_targets WHERE post_id=p.id)
                AND NOT EXISTS (SELECT 1 FROM public.social_post_targets WHERE post_id=p.id AND (publish_status<>'pending' OR attempts<>0 OR claimed_at IS NOT NULL)),
            'can_restore',p.status='canceled' AND EXISTS (SELECT 1 FROM public.social_post_targets WHERE post_id=p.id)
                AND NOT EXISTS (SELECT 1 FROM public.social_post_targets WHERE post_id=p.id AND (publish_status<>'pending' OR attempts<>0 OR claimed_at IS NOT NULL)),
            'targets',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'network',t.network,'publish_status',t.publish_status,
                'platform_post_url',t.platform_post_url) ORDER BY t.network) FROM public.social_post_targets t WHERE t.post_id=p.id),'[]'::JSONB)) row
        FROM public.social_posts p WHERE p.brand_id=p_brand_id AND p.status<>'draft'
            AND p.scheduled_at>=p_from AND p.scheduled_at<p_to
            AND (p_status IS NULL OR p.status=p_status)
            AND (p_network IS NULL OR EXISTS (SELECT 1 FROM public.social_post_targets WHERE post_id=p.id AND network=p_network))
            AND (p_after_at IS NULL OR (p.scheduled_at,p.id)>(p_after_at,p_after_id))
        ORDER BY p.scheduled_at,p.id LIMIT 101
    ) x;
    RETURN jsonb_build_object('ok',true,'posts',v_rows - CASE WHEN v_more THEN 100 ELSE 101 END,
        'next',CASE WHEN v_more THEN jsonb_build_object('at',v_rows->99->>'scheduled_at','id',v_rows->99->>'id') ELSE NULL END);
END $$;

CREATE OR REPLACE FUNCTION public.cancel_social_post(
  p_auth_id TEXT,p_post_id UUID,p_expected_updated_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_brand UUID;v_post public.social_posts%ROWTYPE;v_updated TIMESTAMPTZ;
BEGIN
  SELECT p.brand_id INTO v_brand FROM public.social_posts p WHERE p.id=p_post_id;
  IF v_brand IS NULL THEN RETURN jsonb_build_object('ok',false,'code','POST_NOT_FOUND'); END IF;
  v_context:=public.social_brand_role_context(p_auth_id,v_brand,ARRAY['owner','manager','editor'],false);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  IF p_expected_updated_at IS NULL OR NOT isfinite(p_expected_updated_at) THEN RETURN jsonb_build_object('ok',false,'code','INVALID_POST_VERSION'); END IF;
  PERFORM id FROM public.social_post_targets WHERE post_id=p_post_id ORDER BY id FOR UPDATE NOWAIT;
  SELECT * INTO v_post FROM public.social_posts WHERE id=p_post_id AND brand_id=v_brand FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','POST_NOT_FOUND'); END IF;
  IF v_post.status='canceled' THEN RETURN jsonb_build_object('ok',true,'idempotent',true,'updated_at',v_post.updated_at); END IF;
  IF v_post.status<>'scheduled' OR NOT EXISTS(SELECT 1 FROM public.social_post_targets WHERE post_id=p_post_id)
    OR EXISTS(SELECT 1 FROM public.social_post_targets WHERE post_id=p_post_id AND (publish_status<>'pending' OR attempts<>0 OR claimed_at IS NOT NULL)) THEN
    RETURN jsonb_build_object('ok',false,'code','POST_STARTED'); END IF;
  IF v_post.updated_at<>p_expected_updated_at THEN RETURN jsonb_build_object('ok',false,'code','POST_CHANGED'); END IF;
  UPDATE public.social_posts SET status='canceled',updated_at=clock_timestamp() WHERE id=p_post_id RETURNING updated_at INTO v_updated;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id)
    VALUES(v_actor,v_brand,'canceled_post',p_post_id);
  RETURN jsonb_build_object('ok',true,'idempotent',false,'updated_at',v_updated);
EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('ok',false,'code','POST_BUSY');
END $$;

CREATE OR REPLACE FUNCTION public.restore_social_post(
  p_auth_id TEXT,p_post_id UUID,p_expected_updated_at TIMESTAMPTZ,p_scheduled_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_brand UUID;v_post public.social_posts%ROWTYPE;v_updated TIMESTAMPTZ;
BEGIN
  SELECT p.brand_id INTO v_brand FROM public.social_posts p WHERE p.id=p_post_id;
  IF v_brand IS NULL THEN RETURN jsonb_build_object('ok',false,'code','POST_NOT_FOUND'); END IF;
  v_context:=public.social_brand_role_context(p_auth_id,v_brand,ARRAY['owner','manager','editor'],false);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  IF p_expected_updated_at IS NULL OR NOT isfinite(p_expected_updated_at) THEN RETURN jsonb_build_object('ok',false,'code','INVALID_POST_VERSION'); END IF;
  IF p_scheduled_at IS NULL OR NOT isfinite(p_scheduled_at) OR p_scheduled_at<=clock_timestamp()+interval '1 minute' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_SCHEDULE'); END IF;
  PERFORM id FROM public.social_post_targets WHERE post_id=p_post_id ORDER BY id FOR UPDATE NOWAIT;
  SELECT * INTO v_post FROM public.social_posts WHERE id=p_post_id AND brand_id=v_brand FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','POST_NOT_FOUND'); END IF;
  IF v_post.status='scheduled' AND v_post.scheduled_at=p_scheduled_at THEN
    RETURN jsonb_build_object('ok',true,'idempotent',true,'scheduled_at',v_post.scheduled_at,'updated_at',v_post.updated_at); END IF;
  IF v_post.status<>'canceled' OR NOT EXISTS(SELECT 1 FROM public.social_post_targets WHERE post_id=p_post_id)
    OR EXISTS(SELECT 1 FROM public.social_post_targets WHERE post_id=p_post_id AND (publish_status<>'pending' OR attempts<>0 OR claimed_at IS NOT NULL)) THEN
    RETURN jsonb_build_object('ok',false,'code','RESTORE_UNAVAILABLE'); END IF;
  IF v_post.updated_at<>p_expected_updated_at THEN RETURN jsonb_build_object('ok',false,'code','POST_CHANGED'); END IF;
  IF p_scheduled_at<=clock_timestamp()+interval '1 minute' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_SCHEDULE'); END IF;
  UPDATE public.social_post_targets SET next_attempt_at=p_scheduled_at WHERE post_id=p_post_id;
  UPDATE public.social_posts SET status='scheduled',scheduled_at=p_scheduled_at,updated_at=clock_timestamp()
    WHERE id=p_post_id RETURNING updated_at INTO v_updated;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id,detail)
    VALUES(v_actor,v_brand,'restored_post',p_post_id,jsonb_build_object('to',p_scheduled_at));
  RETURN jsonb_build_object('ok',true,'idempotent',false,'scheduled_at',p_scheduled_at,'updated_at',v_updated);
EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('ok',false,'code','POST_BUSY');
END $$;

REVOKE ALL ON FUNCTION public.list_social_calendar(TEXT,UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT,TIMESTAMPTZ,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_social_post(TEXT,UUID,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.restore_social_post(TEXT,UUID,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_social_calendar(TEXT,UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT,TIMESTAMPTZ,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_social_post(TEXT,UUID,TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_social_post(TEXT,UUID,TIMESTAMPTZ,TIMESTAMPTZ) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
