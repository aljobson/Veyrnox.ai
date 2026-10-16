-- Complete brand activity history using a stable cursor across all audit sources.
BEGIN;

CREATE OR REPLACE FUNCTION public.list_social_publish_activity_page(
  p_auth_id TEXT,p_brand_id UUID,p_limit INTEGER DEFAULT 50,
  p_before_created_at TIMESTAMPTZ DEFAULT NULL,p_before_id UUID DEFAULT NULL,p_before_source TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_limit INTEGER;v_rows JSONB;v_cursor JSONB;
BEGIN
  v_context:=public.social_brand_action_context(p_auth_id,p_brand_id,ARRAY['owner','manager']);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  IF (p_before_created_at IS NOT NULL OR p_before_id IS NOT NULL OR p_before_source IS NOT NULL)
    AND (p_before_created_at IS NULL OR p_before_id IS NULL OR p_before_source IS NULL
      OR p_before_source NOT IN ('publish','team','inbox','approval')) THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_CURSOR');
  END IF;
  v_limit:=LEAST(GREATEST(COALESCE(p_limit,50),1),100);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',e.id,'source',e.source,'action',e.action,'target_id',e.target_id,
    'actor_email',COALESCE(e.actor_email,'System'),'detail',e.detail,'created_at',e.created_at)
    ORDER BY e.created_at DESC,e.id DESC,e.source DESC),'[]'::JSONB) INTO v_rows
  FROM (SELECT * FROM (
    SELECT a.id,'publish'::TEXT source,a.action,a.target_id,u.email actor_email,a.detail,a.created_at
      FROM public.social_account_actions a LEFT JOIN public.users u ON u.id=a.actor_id WHERE a.brand_id=p_brand_id
    UNION ALL
    SELECT t.id,'team',t.action,COALESCE(t.member_user_id,t.invitation_id),u.email,t.detail,t.created_at
      FROM public.social_team_events t LEFT JOIN public.users u ON u.id=t.actor_user_id WHERE t.brand_id=p_brand_id
    UNION ALL
    SELECT i.id,'inbox',i.action,i.thread_id,u.email,i.detail,i.created_at
      FROM public.social_inbox_actions i LEFT JOIN public.users u ON u.id=i.actor_id WHERE i.brand_id=p_brand_id
    UNION ALL
    SELECT a.id,'approval',a.action,a.request_id,COALESCE(u.email,r.email),a.detail,a.created_at
      FROM public.social_approval_events a JOIN public.social_approval_requests q ON q.id=a.request_id
      LEFT JOIN public.users u ON u.id=a.actor_user_id LEFT JOIN public.social_approval_reviewers r ON r.id=a.reviewer_id
      WHERE q.brand_id=p_brand_id
    ) unioned
    WHERE p_before_created_at IS NULL OR (created_at,id,source)<(p_before_created_at,p_before_id,p_before_source)
    ORDER BY created_at DESC,id DESC,source DESC LIMIT v_limit+1
  ) e;
  IF jsonb_array_length(v_rows)>v_limit THEN
    v_cursor:=jsonb_build_object('created_at',v_rows->(v_limit-1)->>'created_at',
      'id',v_rows->(v_limit-1)->>'id','source',v_rows->(v_limit-1)->>'source');
    v_rows:=v_rows-(v_limit);
  END IF;
  RETURN jsonb_build_object('ok',true,'actor_role',v_context->>'role','events',v_rows,'next_cursor',v_cursor);
END $$;

REVOKE ALL ON FUNCTION public.list_social_publish_activity_page(TEXT,UUID,INTEGER,TIMESTAMPTZ,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_social_publish_activity_page(TEXT,UUID,INTEGER,TIMESTAMPTZ,UUID,TEXT) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
