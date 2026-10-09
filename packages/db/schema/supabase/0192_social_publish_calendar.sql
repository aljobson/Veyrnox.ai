-- Publish calendar, behind PUBLISH_CALENDAR_ENABLED. No platform API calls.
CREATE INDEX IF NOT EXISTS social_posts_calendar_idx ON public.social_posts(brand_id, scheduled_at, id);

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
            'global_text',p.global_text,'created_at',p.created_at,
            'can_reschedule',p.status='scheduled' AND EXISTS (SELECT 1 FROM public.social_post_targets WHERE post_id=p.id)
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

-- Lock targets before the parent, matching the worker's completion order.
-- Move next_attempt_at too: a claim statement with an old parent snapshot
-- must recheck the changed target and see it is not due. Never move any
-- target that has been claimed, retried, submitted or partially published.
CREATE OR REPLACE FUNCTION public.reschedule_social_post(
    p_auth_id TEXT,p_post_id UUID,p_expected_at TIMESTAMPTZ,p_scheduled_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_post public.social_posts%ROWTYPE;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND');
    END IF;
    SELECT u.id INTO v_user FROM public.users u JOIN auth.users a ON a.id=p_auth_id::UUID WHERE u.auth_id=p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
    IF NOT EXISTS (SELECT 1 FROM public.social_posts p JOIN public.social_brands b ON b.id=p.brand_id WHERE p.id=p_post_id AND b.owner_user_id=v_user) THEN
        RETURN jsonb_build_object('ok',false,'code','POST_NOT_FOUND');
    END IF;
    IF p_scheduled_at IS NULL OR NOT isfinite(p_scheduled_at) OR p_scheduled_at<=clock_timestamp()+INTERVAL '1 minute'
        OR p_expected_at IS NULL OR NOT isfinite(p_expected_at) THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_SCHEDULE');
    END IF;
    PERFORM id FROM public.social_post_targets WHERE post_id=p_post_id ORDER BY id FOR UPDATE NOWAIT;
    SELECT p.* INTO v_post FROM public.social_posts p JOIN public.social_brands b ON b.id=p.brand_id
        WHERE p.id=p_post_id AND b.owner_user_id=v_user FOR UPDATE OF p NOWAIT;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','POST_NOT_FOUND'); END IF;
    IF v_post.status<>'scheduled' OR NOT EXISTS (SELECT 1 FROM public.social_post_targets WHERE post_id=p_post_id)
        OR EXISTS (SELECT 1 FROM public.social_post_targets WHERE post_id=p_post_id AND (publish_status<>'pending' OR attempts<>0 OR claimed_at IS NOT NULL)) THEN
        RETURN jsonb_build_object('ok',false,'code','POST_STARTED');
    END IF;
    IF p_scheduled_at<=clock_timestamp()+INTERVAL '1 minute' THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_SCHEDULE');
    END IF;
    IF v_post.scheduled_at=p_scheduled_at THEN
        RETURN jsonb_build_object('ok',true,'idempotent',true,'scheduled_at',v_post.scheduled_at);
    END IF;
    IF v_post.scheduled_at<>p_expected_at THEN RETURN jsonb_build_object('ok',false,'code','SCHEDULE_CHANGED'); END IF;
    UPDATE public.social_post_targets SET next_attempt_at=p_scheduled_at WHERE post_id=p_post_id;
    UPDATE public.social_posts SET scheduled_at=p_scheduled_at,updated_at=clock_timestamp() WHERE id=p_post_id;
    INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id,detail)
        VALUES (v_user,v_post.brand_id,'post_rescheduled',p_post_id,jsonb_build_object('from',v_post.scheduled_at,'to',p_scheduled_at));
    RETURN jsonb_build_object('ok',true,'idempotent',false,'scheduled_at',p_scheduled_at);
EXCEPTION WHEN lock_not_available THEN
    RETURN jsonb_build_object('ok',false,'code','POST_BUSY');
END $$;
REVOKE ALL ON FUNCTION public.list_social_calendar(TEXT,UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT,TIMESTAMPTZ,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reschedule_social_post(TEXT,UUID,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_social_calendar(TEXT,UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT,TIMESTAMPTZ,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reschedule_social_post(TEXT,UUID,TIMESTAMPTZ,TIMESTAMPTZ) TO service_role;
