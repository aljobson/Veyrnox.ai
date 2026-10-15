-- 0309: team-operated unified inbox workflow.
-- Adds assignments, priority, tags and internal notes while preserving the
-- provider-specific reply boundary established by 0299.
BEGIN;

ALTER TABLE public.social_inbox_threads
  ADD COLUMN IF NOT EXISTS assigned_user_id UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high','urgent')),
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'::TEXT[] CHECK (cardinality(tags) <= 10);
CREATE INDEX IF NOT EXISTS social_inbox_threads_assignee_idx
  ON public.social_inbox_threads(brand_id,assigned_user_id,latest_message_at DESC);
CREATE INDEX IF NOT EXISTS social_inbox_threads_assigned_user_idx
  ON public.social_inbox_threads(assigned_user_id);
CREATE INDEX IF NOT EXISTS social_inbox_threads_priority_idx
  ON public.social_inbox_threads(brand_id,priority,latest_message_at DESC);
CREATE INDEX IF NOT EXISTS social_inbox_threads_tags_idx
  ON public.social_inbox_threads USING gin(tags);

CREATE TABLE IF NOT EXISTS public.social_inbox_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.social_brands(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES public.social_inbox_threads(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_inbox_notes_thread_created_idx
  ON public.social_inbox_notes(thread_id,created_at,id);
CREATE INDEX IF NOT EXISTS social_inbox_notes_brand_idx
  ON public.social_inbox_notes(brand_id);
CREATE INDEX IF NOT EXISTS social_inbox_notes_actor_idx
  ON public.social_inbox_notes(actor_id);
ALTER TABLE public.social_inbox_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_inbox_notes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_inbox_notes FROM PUBLIC,anon,authenticated,service_role;

DROP FUNCTION IF EXISTS public.list_social_inbox(TEXT,UUID,UUID,TEXT,TEXT,TEXT);
CREATE OR REPLACE FUNCTION public.list_social_inbox(
  p_auth_id TEXT,p_brand_id UUID,p_account_id UUID DEFAULT NULL,p_state TEXT DEFAULT 'unresolved',
  p_kind TEXT DEFAULT NULL,p_search TEXT DEFAULT NULL,p_assignee TEXT DEFAULT NULL,
  p_priority TEXT DEFAULT NULL,p_tag TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,
    ARRAY['owner','manager','editor','reviewer','analyst','viewer'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  IF p_account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.social_accounts a WHERE a.id=p_account_id AND a.brand_id=p_brand_id) THEN
    RETURN jsonb_build_object('ok',false,'code','ACCOUNT_NOT_FOUND'); END IF;
  IF p_state NOT IN ('all','unread','unresolved','resolved')
    OR p_kind IS NOT NULL AND p_kind NOT IN ('message','comment','review')
    OR p_search IS NOT NULL AND char_length(p_search)>100
    OR p_assignee IS NOT NULL AND p_assignee<>'unassigned' AND p_assignee !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR p_priority IS NOT NULL AND p_priority NOT IN ('normal','high','urgent')
    OR p_tag IS NOT NULL AND char_length(p_tag) NOT BETWEEN 1 AND 32
  THEN RETURN jsonb_build_object('ok',false,'code','INVALID_FILTER'); END IF;

  RETURN jsonb_build_object('ok',true,
    'counts',jsonb_build_object(
      'all',(SELECT count(*) FROM public.social_inbox_threads t WHERE t.brand_id=p_brand_id AND (p_account_id IS NULL OR t.account_id=p_account_id)),
      'unread',(SELECT count(*) FROM public.social_inbox_threads t WHERE t.brand_id=p_brand_id AND t.unread_count>0 AND (p_account_id IS NULL OR t.account_id=p_account_id)),
      'unresolved',(SELECT count(*) FROM public.social_inbox_threads t WHERE t.brand_id=p_brand_id AND t.status='open' AND (p_account_id IS NULL OR t.account_id=p_account_id)),
      'resolved',(SELECT count(*) FROM public.social_inbox_threads t WHERE t.brand_id=p_brand_id AND t.status='resolved' AND (p_account_id IS NULL OR t.account_id=p_account_id))),
    'members',coalesce((SELECT jsonb_agg(member ORDER BY CASE member->>'role' WHEN 'owner' THEN 0 ELSE 1 END,member->>'email') FROM (
      SELECT jsonb_build_object('user_id',u.id,'email',u.email,'role','owner') member
        FROM public.social_brands b JOIN public.users u ON u.id=b.owner_user_id WHERE b.id=p_brand_id
      UNION ALL
      SELECT jsonb_build_object('user_id',u.id,'email',u.email,'role',m.role) member
        FROM public.social_brand_members m JOIN public.users u ON u.id=m.user_id WHERE m.brand_id=p_brand_id
    ) q),'[]'::jsonb),
    'tags',coalesce((SELECT jsonb_agg(tag ORDER BY tag) FROM (
      SELECT DISTINCT unnest(t.tags) tag FROM public.social_inbox_threads t WHERE t.brand_id=p_brand_id
    ) q WHERE tag IS NOT NULL),'[]'::jsonb),
    'threads',coalesce((SELECT jsonb_agg(row ORDER BY (row->>'latest_message_at')::timestamptz DESC) FROM (
      SELECT jsonb_build_object('id',t.id,'account_id',t.account_id,'network',a.network,'account_name',a.display_name,
        'kind',t.kind,'participant_name',t.participant_name,'participant_avatar_url',t.participant_avatar_url,
        'subject',t.subject,'provider_url',t.provider_url,'status',t.status,'unread_count',t.unread_count,
        'can_reply',t.can_reply,'latest_message_at',t.latest_message_at,'assigned_user_id',t.assigned_user_id,
        'assigned_email',assignee.email,'priority',t.priority,'tags',to_jsonb(t.tags),'preview',(
          SELECT left(coalesce(m.body,''),240) FROM public.social_inbox_messages m WHERE m.thread_id=t.id ORDER BY m.sent_at DESC,m.id DESC LIMIT 1))
      FROM public.social_inbox_threads t JOIN public.social_accounts a ON a.id=t.account_id
      LEFT JOIN public.users assignee ON assignee.id=t.assigned_user_id
      WHERE t.brand_id=p_brand_id AND (p_account_id IS NULL OR t.account_id=p_account_id)
        AND (p_kind IS NULL OR t.kind=p_kind)
        AND (p_state='all' OR p_state='unread' AND t.unread_count>0 OR p_state='unresolved' AND t.status='open' OR p_state='resolved' AND t.status='resolved')
        AND (p_search IS NULL OR t.participant_name ILIKE '%'||p_search||'%' OR t.subject ILIKE '%'||p_search||'%'
          OR EXISTS(SELECT 1 FROM public.social_inbox_messages sm WHERE sm.thread_id=t.id AND sm.body ILIKE '%'||p_search||'%'))
        AND (p_assignee IS NULL OR p_assignee='unassigned' AND t.assigned_user_id IS NULL OR p_assignee<>'unassigned' AND t.assigned_user_id::TEXT=p_assignee)
        AND (p_priority IS NULL OR t.priority=p_priority)
        AND (p_tag IS NULL OR lower(p_tag)=ANY(t.tags))
      ORDER BY t.latest_message_at DESC,t.id DESC LIMIT 50
    ) q(row)),'[]'::jsonb));
END $$;

DROP FUNCTION IF EXISTS public.get_social_inbox_thread(TEXT,UUID);
CREATE OR REPLACE FUNCTION public.get_social_inbox_thread(p_auth_id TEXT,p_brand_id UUID,p_thread_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_thread public.social_inbox_threads%ROWTYPE;v_network TEXT;v_account_name TEXT;v_assigned_email TEXT;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,
    ARRAY['owner','manager','editor','reviewer','analyst','viewer'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  SELECT t.* INTO v_thread FROM public.social_inbox_threads t WHERE t.id=p_thread_id AND t.brand_id=p_brand_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','THREAD_NOT_FOUND'); END IF;
  SELECT a.network,a.display_name INTO v_network,v_account_name FROM public.social_accounts a WHERE a.id=v_thread.account_id;
  SELECT u.email INTO v_assigned_email FROM public.users u WHERE u.id=v_thread.assigned_user_id;
  RETURN jsonb_build_object('ok',true,'thread',jsonb_build_object('id',v_thread.id,'account_id',v_thread.account_id,
    'network',v_network,'account_name',v_account_name,'kind',v_thread.kind,'participant_name',v_thread.participant_name,
    'participant_avatar_url',v_thread.participant_avatar_url,'subject',v_thread.subject,'provider_url',v_thread.provider_url,
    'status',v_thread.status,'unread_count',v_thread.unread_count,'can_reply',v_thread.can_reply,'latest_message_at',v_thread.latest_message_at,
    'assigned_user_id',v_thread.assigned_user_id,'assigned_email',v_assigned_email,'priority',v_thread.priority,'tags',to_jsonb(v_thread.tags)),
    'messages',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'direction',m.direction,'body',m.body,'media',m.media,
      'delivery_status',m.delivery_status,'sent_at',m.sent_at) ORDER BY m.sent_at,m.id) FROM public.social_inbox_messages m WHERE m.thread_id=v_thread.id),'[]'::jsonb),
    'notes',coalesce((SELECT jsonb_agg(jsonb_build_object('id',n.id,'body',n.body,'actor_email',u.email,'created_at',n.created_at) ORDER BY n.created_at,n.id)
      FROM public.social_inbox_notes n JOIN public.users u ON u.id=n.actor_id WHERE n.thread_id=v_thread.id),'[]'::jsonb));
END $$;

DROP FUNCTION IF EXISTS public.update_social_inbox_thread(TEXT,UUID,TEXT);
CREATE OR REPLACE FUNCTION public.update_social_inbox_thread(p_auth_id TEXT,p_brand_id UUID,p_thread_id UUID,p_action TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_thread public.social_inbox_threads%ROWTYPE;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor','reviewer'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  SELECT * INTO v_thread FROM public.social_inbox_threads WHERE id=p_thread_id AND brand_id=p_brand_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','THREAD_NOT_FOUND'); END IF;
  IF p_action='read' THEN UPDATE public.social_inbox_threads SET unread_count=0,updated_at=now() WHERE id=p_thread_id;
  ELSIF p_action='unread' THEN UPDATE public.social_inbox_threads SET unread_count=greatest(unread_count,1),updated_at=now() WHERE id=p_thread_id;
  ELSIF p_action='resolve' THEN UPDATE public.social_inbox_threads SET status='resolved',unread_count=0,updated_at=now() WHERE id=p_thread_id;
  ELSIF p_action='reopen' THEN UPDATE public.social_inbox_threads SET status='open',updated_at=now() WHERE id=p_thread_id;
  ELSE RETURN jsonb_build_object('ok',false,'code','INVALID_ACTION'); END IF;
  INSERT INTO public.social_inbox_actions(brand_id,thread_id,actor_id,action) VALUES(v_thread.brand_id,v_thread.id,v_actor,p_action);
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.update_social_inbox_workflow(
  p_auth_id TEXT,p_brand_id UUID,p_thread_id UUID,p_action TEXT,p_value JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_thread public.social_inbox_threads%ROWTYPE;v_assignee UUID;v_tags TEXT[];
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor','reviewer'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  SELECT * INTO v_thread FROM public.social_inbox_threads WHERE id=p_thread_id AND brand_id=p_brand_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','THREAD_NOT_FOUND'); END IF;
  IF p_action='assign' THEN
    IF coalesce(p_value->>'user_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_ASSIGNEE'); END IF;
    v_assignee:=(p_value->>'user_id')::UUID;
    IF NOT EXISTS(SELECT 1 FROM public.social_brands b WHERE b.id=p_brand_id AND b.owner_user_id=v_assignee)
      AND NOT EXISTS(SELECT 1 FROM public.social_brand_members m WHERE m.brand_id=p_brand_id AND m.user_id=v_assignee)
      THEN RETURN jsonb_build_object('ok',false,'code','INVALID_ASSIGNEE'); END IF;
    UPDATE public.social_inbox_threads SET assigned_user_id=v_assignee,updated_at=now() WHERE id=p_thread_id;
  ELSIF p_action='unassign' THEN
    UPDATE public.social_inbox_threads SET assigned_user_id=NULL,updated_at=now() WHERE id=p_thread_id;
  ELSIF p_action='priority' THEN
    IF coalesce(p_value->>'priority','') NOT IN ('normal','high','urgent') THEN RETURN jsonb_build_object('ok',false,'code','INVALID_PRIORITY'); END IF;
    UPDATE public.social_inbox_threads SET priority=p_value->>'priority',updated_at=now() WHERE id=p_thread_id;
  ELSIF p_action='tags' THEN
    IF jsonb_typeof(p_value->'tags')<>'array' OR jsonb_array_length(p_value->'tags')>10
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_value->'tags') x WHERE jsonb_typeof(x)<>'string' OR char_length(btrim(x#>>'{}')) NOT BETWEEN 1 AND 32)
      THEN RETURN jsonb_build_object('ok',false,'code','INVALID_TAGS'); END IF;
    SELECT coalesce(array_agg(tag ORDER BY tag),'{}'::TEXT[]) INTO v_tags FROM (
      SELECT DISTINCT lower(btrim(x#>>'{}')) tag FROM jsonb_array_elements(p_value->'tags') x
    ) q;
    UPDATE public.social_inbox_threads SET tags=v_tags,updated_at=now() WHERE id=p_thread_id;
  ELSE RETURN jsonb_build_object('ok',false,'code','INVALID_ACTION'); END IF;
  INSERT INTO public.social_inbox_actions(brand_id,thread_id,actor_id,action,detail)
    VALUES(p_brand_id,p_thread_id,v_actor,p_action,coalesce(p_value,'{}'::jsonb));
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.add_social_inbox_note(p_auth_id TEXT,p_brand_id UUID,p_thread_id UUID,p_body TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_note public.social_inbox_notes%ROWTYPE;v_email TEXT;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor','reviewer'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  IF char_length(btrim(coalesce(p_body,''))) NOT BETWEEN 1 AND 2000 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_NOTE'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_inbox_threads t WHERE t.id=p_thread_id AND t.brand_id=p_brand_id) THEN
    RETURN jsonb_build_object('ok',false,'code','THREAD_NOT_FOUND'); END IF;
  INSERT INTO public.social_inbox_notes(brand_id,thread_id,actor_id,body)
    VALUES(p_brand_id,p_thread_id,v_actor,btrim(p_body)) RETURNING * INTO v_note;
  SELECT email INTO v_email FROM public.users WHERE id=v_actor;
  INSERT INTO public.social_inbox_actions(brand_id,thread_id,actor_id,action,detail)
    VALUES(p_brand_id,p_thread_id,v_actor,'internal_note',jsonb_build_object('note_id',v_note.id));
  RETURN jsonb_build_object('ok',true,'note',jsonb_build_object('id',v_note.id,'body',v_note.body,'actor_email',v_email,'created_at',v_note.created_at));
END $$;

DROP FUNCTION IF EXISTS public.create_social_inbox_reply(TEXT,UUID,TEXT,TEXT);
CREATE OR REPLACE FUNCTION public.create_social_inbox_reply(
  p_auth_id TEXT,p_brand_id UUID,p_thread_id UUID,p_body TEXT,p_idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_thread public.social_inbox_threads%ROWTYPE;v_account public.social_accounts%ROWTYPE;v_message UUID;v_existing public.social_inbox_messages%ROWTYPE;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  IF p_body IS NULL OR char_length(btrim(p_body)) NOT BETWEEN 1 AND 8000 OR p_idempotency_key IS NULL
    OR p_idempotency_key !~ '^[A-Za-z0-9:_-]{16,128}$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_REPLY'); END IF;
  SELECT * INTO v_thread FROM public.social_inbox_threads WHERE id=p_thread_id AND brand_id=p_brand_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','THREAD_NOT_FOUND'); END IF;
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
    VALUES(p_brand_id,p_thread_id,v_actor,'reply',jsonb_build_object('message_id',v_message));
  RETURN jsonb_build_object('ok',true,'idempotent',false,'message_id',v_message,'network',v_account.network,
    'provider_thread_id',v_thread.provider_thread_id,'access_token_enc',encode(v_account.access_token_enc,'hex'));
END $$;

DO $$ DECLARE fn TEXT;BEGIN FOREACH fn IN ARRAY ARRAY[
  'public.list_social_inbox(text,uuid,uuid,text,text,text,text,text,text)',
  'public.get_social_inbox_thread(text,uuid,uuid)',
  'public.update_social_inbox_thread(text,uuid,uuid,text)',
  'public.update_social_inbox_workflow(text,uuid,uuid,text,jsonb)',
  'public.add_social_inbox_note(text,uuid,uuid,text)',
  'public.create_social_inbox_reply(text,uuid,uuid,text,text)'
] LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||fn||' FROM PUBLIC,anon,authenticated';EXECUTE 'GRANT EXECUTE ON FUNCTION '||fn||' TO service_role';END LOOP;END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
