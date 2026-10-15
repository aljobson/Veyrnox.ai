-- 0307: actor-aware delegated Publish actions and a unified brand activity log.
-- Managers and editors may operate the inbox, queues and SmartLink. Every
-- mutation records the authenticated teammate, while the owner's live Publish
-- Plan remains the entitlement source for the shared brand.
BEGIN;

CREATE OR REPLACE FUNCTION public.social_brand_action_context(p_auth_id TEXT,p_brand_id UUID,p_roles TEXT[])
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor UUID;v_owner UUID;v_role TEXT;
BEGIN
  IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND');
  END IF;
  SELECT u.id INTO v_actor FROM public.users u JOIN auth.users a ON a.id=p_auth_id::UUID WHERE u.auth_id=p_auth_id;
  IF v_actor IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
  SELECT b.owner_user_id INTO v_owner FROM public.social_brands b WHERE b.id=p_brand_id;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND'); END IF;
  v_role:=public.social_brand_role(p_auth_id,p_brand_id);
  IF v_role IS NULL THEN RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND'); END IF;
  IF p_roles IS NULL OR NOT v_role=ANY(p_roles) THEN RETURN jsonb_build_object('ok',false,'code','FORBIDDEN'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_publish_subscriptions s WHERE s.user_id=v_owner
    AND s.status IN ('active','past_due') AND s.current_period_end>now()) THEN
    RETURN jsonb_build_object('ok',false,'code','PLAN_REQUIRED');
  END IF;
  RETURN jsonb_build_object('ok',true,'actor_id',v_actor,'owner_id',v_owner,'role',v_role);
END $$;

CREATE OR REPLACE FUNCTION public.update_social_inbox_thread(p_auth_id TEXT,p_thread_id UUID,p_action TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_thread public.social_inbox_threads%ROWTYPE;v_context JSONB;v_actor UUID;
BEGIN
  SELECT * INTO v_thread FROM public.social_inbox_threads WHERE id=p_thread_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','THREAD_NOT_FOUND'); END IF;
  v_context:=public.social_brand_action_context(p_auth_id,v_thread.brand_id,ARRAY['owner','manager','editor']);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  IF p_action='read' THEN UPDATE public.social_inbox_threads SET unread_count=0,updated_at=now() WHERE id=p_thread_id;
  ELSIF p_action='unread' THEN UPDATE public.social_inbox_threads SET unread_count=GREATEST(unread_count,1),updated_at=now() WHERE id=p_thread_id;
  ELSIF p_action='resolve' THEN UPDATE public.social_inbox_threads SET status='resolved',unread_count=0,updated_at=now() WHERE id=p_thread_id;
  ELSIF p_action='reopen' THEN UPDATE public.social_inbox_threads SET status='open',updated_at=now() WHERE id=p_thread_id;
  ELSE RETURN jsonb_build_object('ok',false,'code','INVALID_ACTION'); END IF;
  INSERT INTO public.social_inbox_actions(brand_id,thread_id,actor_id,action) VALUES(v_thread.brand_id,v_thread.id,v_actor,p_action);
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.create_social_inbox_reply(p_auth_id TEXT,p_thread_id UUID,p_body TEXT,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_thread public.social_inbox_threads%ROWTYPE;v_account public.social_accounts%ROWTYPE;
  v_message UUID;v_existing public.social_inbox_messages%ROWTYPE;
BEGIN
  IF p_body IS NULL OR char_length(btrim(p_body)) NOT BETWEEN 1 AND 8000 OR p_idempotency_key IS NULL
    OR p_idempotency_key !~ '^[A-Za-z0-9:_-]{16,128}$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_REPLY'); END IF;
  SELECT * INTO v_thread FROM public.social_inbox_threads WHERE id=p_thread_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','THREAD_NOT_FOUND'); END IF;
  v_context:=public.social_brand_action_context(p_auth_id,v_thread.brand_id,ARRAY['owner','manager','editor']);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  IF NOT v_thread.can_reply OR v_thread.kind<>'comment' THEN RETURN jsonb_build_object('ok',false,'code','REPLY_UNAVAILABLE'); END IF;
  SELECT * INTO v_existing FROM public.social_inbox_messages m WHERE m.thread_id=v_thread.id AND m.idempotency_key=p_idempotency_key;
  IF FOUND THEN RETURN jsonb_build_object('ok',true,'idempotent',true,'message_id',v_existing.id,'delivery_status',v_existing.delivery_status); END IF;
  SELECT * INTO v_account FROM public.social_accounts a WHERE a.id=v_thread.account_id AND a.status='active';
  IF NOT FOUND OR v_account.access_token_enc IS NULL THEN RETURN jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE'); END IF;
  INSERT INTO public.social_inbox_messages(thread_id,direction,body,delivery_status,idempotency_key,sent_at)
    VALUES(v_thread.id,'outbound',btrim(p_body),'sending',p_idempotency_key,now())
    ON CONFLICT(thread_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id INTO v_message;
  IF v_message IS NULL THEN
    SELECT * INTO v_existing FROM public.social_inbox_messages m WHERE m.thread_id=v_thread.id AND m.idempotency_key=p_idempotency_key;
    RETURN jsonb_build_object('ok',true,'idempotent',true,'message_id',v_existing.id,'delivery_status',v_existing.delivery_status);
  END IF;
  INSERT INTO public.social_inbox_actions(brand_id,thread_id,actor_id,action,detail)
    VALUES(v_thread.brand_id,v_thread.id,v_actor,'reply_created',jsonb_build_object('message_id',v_message));
  RETURN jsonb_build_object('ok',true,'idempotent',false,'message_id',v_message,'network',v_account.network,
    'provider_thread_id',v_thread.provider_thread_id,'access_token_enc',encode(v_account.access_token_enc,'hex'));
END $$;

CREATE OR REPLACE FUNCTION public.save_social_publish_queue(p_auth_id TEXT,p_brand_id UUID,p_id UUID,p_name TEXT,p_timezone TEXT,p_account_ids UUID[],p_slots JSONB,p_enabled BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_id UUID;v_count INTEGER;v_slot JSONB;
BEGIN
  v_context:=public.social_brand_action_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor']);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  p_name:=btrim(COALESCE(p_name,''));p_timezone:=btrim(COALESCE(p_timezone,''));p_account_ids:=COALESCE(p_account_ids,'{}'::UUID[]);
  IF char_length(p_name) NOT BETWEEN 1 AND 80 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_timezone)
    OR cardinality(p_account_ids) NOT BETWEEN 1 AND 20 OR cardinality(p_account_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_account_ids) x)
    OR EXISTS(SELECT 1 FROM unnest(p_account_ids) x LEFT JOIN public.social_accounts a ON a.id=x AND a.brand_id=p_brand_id AND a.status='active' WHERE a.id IS NULL)
    OR jsonb_typeof(p_slots)<>'array' OR jsonb_array_length(p_slots) NOT BETWEEN 1 AND 35 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUT'); END IF;
  FOR v_slot IN SELECT value FROM jsonb_array_elements(p_slots) LOOP
    IF jsonb_typeof(v_slot)<>'object' OR (v_slot->>'weekday') !~ '^[1-7]$' OR (v_slot->>'minute') !~ '^(0|[1-9][0-9]{0,3})$'
      OR (v_slot->>'minute')::INTEGER>1439 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_SLOT'); END IF;
  END LOOP;
  IF (SELECT count(*) FROM (SELECT DISTINCT (v->>'weekday')::INTEGER,(v->>'minute')::INTEGER FROM jsonb_array_elements(p_slots) v) d)<>jsonb_array_length(p_slots)
    THEN RETURN jsonb_build_object('ok',false,'code','INVALID_SLOT'); END IF;
  IF p_id IS NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('social-publish-queue:'||p_brand_id::TEXT,0));
    SELECT count(*) INTO v_count FROM public.social_publish_queues WHERE brand_id=p_brand_id;
    IF v_count>=20 THEN RETURN jsonb_build_object('ok',false,'code','QUEUE_LIMIT'); END IF;
    INSERT INTO public.social_publish_queues(brand_id,name,timezone,account_ids,enabled) VALUES(p_brand_id,p_name,p_timezone,p_account_ids,COALESCE(p_enabled,true)) RETURNING id INTO v_id;
  ELSE
    UPDATE public.social_publish_queues SET name=p_name,timezone=p_timezone,account_ids=p_account_ids,enabled=COALESCE(p_enabled,true),updated_at=now()
      WHERE id=p_id AND brand_id=p_brand_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','QUEUE_NOT_FOUND'); END IF;
    DELETE FROM public.social_publish_queue_slots WHERE queue_id=v_id;
  END IF;
  INSERT INTO public.social_publish_queue_slots(queue_id,iso_weekday,minute_of_day)
    SELECT v_id,(v->>'weekday')::SMALLINT,(v->>'minute')::SMALLINT FROM jsonb_array_elements(p_slots) v;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id,detail)
    VALUES(v_actor,p_brand_id,'save_publish_queue',v_id,jsonb_build_object('slots',jsonb_array_length(p_slots)));
  RETURN jsonb_build_object('ok',true,'queue_id',v_id);
EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'code','QUEUE_NAME_TAKEN');
END $$;

CREATE OR REPLACE FUNCTION public.delete_social_publish_queue(p_auth_id TEXT,p_brand_id UUID,p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_id UUID;
BEGIN
  v_context:=public.social_brand_action_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor']);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  DELETE FROM public.social_publish_queues WHERE id=p_id AND brand_id=p_brand_id RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','QUEUE_NOT_FOUND'); END IF;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id) VALUES(v_actor,p_brand_id,'delete_publish_queue',v_id);
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.save_social_smartlink(
  p_auth_id TEXT,p_brand_id UUID,p_slug TEXT,p_title TEXT,p_bio TEXT,p_avatar_url TEXT,p_theme TEXT,p_published BOOLEAN,p_items JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_link UUID;v_item JSONB;v_position INTEGER:=0;
BEGIN
  v_context:=public.social_brand_action_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor']);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  p_slug:=lower(btrim(COALESCE(p_slug,'')));p_title:=btrim(COALESCE(p_title,''));
  IF p_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$' OR char_length(p_title) NOT BETWEEN 1 AND 80
    OR p_theme NOT IN ('midnight','light','sunset') OR (p_bio IS NOT NULL AND char_length(p_bio)>280)
    OR (p_avatar_url IS NOT NULL AND (p_avatar_url !~ '^https://' OR char_length(p_avatar_url)>1000))
    OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)>20 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUT'); END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(v_item)<>'object' OR char_length(btrim(COALESCE(v_item->>'label',''))) NOT BETWEEN 1 AND 60
      OR COALESCE(v_item->>'url','') !~ '^https://' OR char_length(COALESCE(v_item->>'url',''))>1000 THEN
      RETURN jsonb_build_object('ok',false,'code','INVALID_ITEM'); END IF;
  END LOOP;
  INSERT INTO public.social_smartlinks(brand_id,slug,title,bio,avatar_url,theme,published)
  VALUES(p_brand_id,p_slug,p_title,NULLIF(btrim(p_bio),''),NULLIF(btrim(p_avatar_url),''),p_theme,COALESCE(p_published,false))
  ON CONFLICT(brand_id) DO UPDATE SET slug=EXCLUDED.slug,title=EXCLUDED.title,bio=EXCLUDED.bio,avatar_url=EXCLUDED.avatar_url,
    theme=EXCLUDED.theme,published=EXCLUDED.published,updated_at=now() RETURNING id INTO v_link;
  DELETE FROM public.social_smartlink_items WHERE smartlink_id=v_link;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.social_smartlink_items(smartlink_id,position,label,url,enabled)
    VALUES(v_link,v_position,btrim(v_item->>'label'),v_item->>'url',COALESCE((v_item->>'enabled')::BOOLEAN,true));v_position:=v_position+1;
  END LOOP;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id,detail)
    VALUES(v_actor,p_brand_id,'save_smartlink',v_link,jsonb_build_object('published',COALESCE(p_published,false),'items',v_position));
  RETURN jsonb_build_object('ok',true,'smartlink_id',v_link);
EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'code','SLUG_TAKEN');
END $$;

CREATE OR REPLACE FUNCTION public.list_social_publish_activity(p_auth_id TEXT,p_brand_id UUID,p_limit INTEGER DEFAULT 50)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_limit INTEGER;
BEGIN
  v_context:=public.social_brand_action_context(p_auth_id,p_brand_id,ARRAY['owner','manager']);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_limit:=LEAST(GREATEST(COALESCE(p_limit,50),1),100);
  RETURN jsonb_build_object('ok',true,'actor_role',v_context->>'role','events',COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id',e.id,'source',e.source,'action',e.action,'target_id',e.target_id,
      'actor_email',COALESCE(e.actor_email,'System'),'detail',e.detail,'created_at',e.created_at) ORDER BY e.created_at DESC,e.id DESC)
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
      ) unioned ORDER BY created_at DESC,id DESC LIMIT v_limit) e
  ),'[]'::JSONB));
END $$;

REVOKE ALL ON FUNCTION public.social_brand_action_context(TEXT,UUID,TEXT[]) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.list_social_publish_activity(TEXT,UUID,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_social_publish_activity(TEXT,UUID,INTEGER) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
