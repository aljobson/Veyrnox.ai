-- 0320: reviewable keyword workflows for the paid social inbox.
-- Matching inbound activity creates a reply suggestion. It never sends a reply.
BEGIN;

CREATE TABLE IF NOT EXISTS public.social_inbox_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.social_brands(id) ON DELETE CASCADE,
  account_id UUID NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  kind TEXT NULL CHECK (kind IS NULL OR kind IN ('message','comment','review')),
  keyword TEXT NOT NULL CHECK (char_length(keyword) BETWEEN 1 AND 100),
  match_mode TEXT NOT NULL DEFAULT 'contains' CHECK (match_mode IN ('contains','exact')),
  reply_text TEXT NOT NULL CHECK (char_length(reply_text) BETWEEN 1 AND 8000),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_inbox_workflows_brand_idx
  ON public.social_inbox_workflows(brand_id,enabled,updated_at DESC);
CREATE INDEX IF NOT EXISTS social_inbox_workflows_account_idx
  ON public.social_inbox_workflows(account_id) WHERE account_id IS NOT NULL;
ALTER TABLE public.social_inbox_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_inbox_workflows FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_inbox_workflows FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.social_inbox_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.social_brands(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES public.social_inbox_threads(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES public.social_inbox_messages(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES public.social_inbox_workflows(id) ON DELETE CASCADE,
  suggested_reply TEXT NOT NULL CHECK (char_length(suggested_reply) BETWEEN 1 AND 8000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','used','dismissed')),
  decided_by_user_id UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  matched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ NULL,
  CONSTRAINT social_inbox_suggestions_message_workflow_unique UNIQUE(message_id,workflow_id)
);
CREATE INDEX IF NOT EXISTS social_inbox_suggestions_thread_idx
  ON public.social_inbox_suggestions(thread_id,status,matched_at DESC);
CREATE INDEX IF NOT EXISTS social_inbox_suggestions_brand_idx
  ON public.social_inbox_suggestions(brand_id,matched_at DESC);
ALTER TABLE public.social_inbox_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_inbox_suggestions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_inbox_suggestions FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.list_social_inbox_workflows(p_auth_id TEXT,p_brand_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,
    ARRAY['owner','manager','editor','reviewer','analyst','viewer'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  RETURN jsonb_build_object('ok',true,'workflows',coalesce((
    SELECT jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'account_id',w.account_id,
      'account_name',a.display_name,'network',a.network,'kind',w.kind,'keyword',w.keyword,
      'match_mode',w.match_mode,'reply_text',w.reply_text,'enabled',w.enabled,
      'suggestion_count',(SELECT count(*) FROM public.social_inbox_suggestions s WHERE s.workflow_id=w.id),
      'updated_at',w.updated_at) ORDER BY w.updated_at DESC,w.id DESC)
    FROM public.social_inbox_workflows w LEFT JOIN public.social_accounts a ON a.id=w.account_id
    WHERE w.brand_id=p_brand_id),'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.save_social_inbox_workflow(
  p_auth_id TEXT,p_brand_id UUID,p_workflow_id UUID,p_name TEXT,p_account_id UUID,p_kind TEXT,
  p_keyword TEXT,p_match_mode TEXT,p_reply_text TEXT,p_enabled BOOLEAN
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_id UUID;v_created BOOLEAN:=false;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  p_name:=btrim(coalesce(p_name,''));p_keyword:=btrim(coalesce(p_keyword,''));p_reply_text:=btrim(coalesce(p_reply_text,''));
  IF char_length(p_name) NOT BETWEEN 1 AND 80 OR char_length(p_keyword) NOT BETWEEN 1 AND 100
    OR char_length(p_reply_text) NOT BETWEEN 1 AND 8000 OR p_match_mode NOT IN ('contains','exact')
    OR p_kind IS NOT NULL AND p_kind NOT IN ('message','comment','review')
  THEN RETURN jsonb_build_object('ok',false,'code','INVALID_WORKFLOW'); END IF;
  IF p_account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.social_accounts a WHERE a.id=p_account_id AND a.brand_id=p_brand_id) THEN
    RETURN jsonb_build_object('ok',false,'code','ACCOUNT_NOT_FOUND'); END IF;
  IF p_workflow_id IS NULL THEN
    IF (SELECT count(*) FROM public.social_inbox_workflows w WHERE w.brand_id=p_brand_id)>=50 THEN
      RETURN jsonb_build_object('ok',false,'code','WORKFLOW_LIMIT'); END IF;
    INSERT INTO public.social_inbox_workflows(brand_id,account_id,name,kind,keyword,match_mode,reply_text,enabled,created_by_user_id)
      VALUES(p_brand_id,p_account_id,p_name,p_kind,lower(p_keyword),p_match_mode,p_reply_text,coalesce(p_enabled,true),v_actor)
      RETURNING id INTO v_id;v_created:=true;
  ELSE
    UPDATE public.social_inbox_workflows SET account_id=p_account_id,name=p_name,kind=p_kind,keyword=lower(p_keyword),
      match_mode=p_match_mode,reply_text=p_reply_text,enabled=coalesce(p_enabled,true),updated_at=now()
      WHERE id=p_workflow_id AND brand_id=p_brand_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','WORKFLOW_NOT_FOUND'); END IF;
  END IF;
  INSERT INTO public.social_inbox_actions(brand_id,actor_id,action,detail)
    VALUES(p_brand_id,v_actor,CASE WHEN v_created THEN 'create_workflow' ELSE 'update_workflow' END,
      jsonb_build_object('workflow_id',v_id));
  RETURN jsonb_build_object('ok',true,'workflow_id',v_id,'created',v_created);
END $$;

CREATE OR REPLACE FUNCTION public.delete_social_inbox_workflow(p_auth_id TEXT,p_brand_id UUID,p_workflow_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  DELETE FROM public.social_inbox_workflows WHERE id=p_workflow_id AND brand_id=p_brand_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','WORKFLOW_NOT_FOUND'); END IF;
  INSERT INTO public.social_inbox_actions(brand_id,actor_id,action,detail)
    VALUES(p_brand_id,v_actor,'delete_workflow',jsonb_build_object('workflow_id',p_workflow_id));
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.evaluate_social_inbox_workflows(p_thread_id UUID,p_message_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_thread public.social_inbox_threads%ROWTYPE;v_message public.social_inbox_messages%ROWTYPE;v_inserted INTEGER;
BEGIN
  SELECT * INTO v_thread FROM public.social_inbox_threads WHERE id=p_thread_id;
  SELECT * INTO v_message FROM public.social_inbox_messages WHERE id=p_message_id AND thread_id=p_thread_id;
  IF v_thread.id IS NULL OR v_message.id IS NULL OR v_message.direction<>'inbound' THEN
    RETURN jsonb_build_object('ok',false,'code','EVENT_NOT_FOUND'); END IF;
  INSERT INTO public.social_inbox_suggestions(brand_id,thread_id,message_id,workflow_id,suggested_reply)
    SELECT v_thread.brand_id,v_thread.id,v_message.id,w.id,w.reply_text
    FROM public.social_inbox_workflows w
    WHERE w.brand_id=v_thread.brand_id AND w.enabled
      AND (w.account_id IS NULL OR w.account_id=v_thread.account_id)
      AND (w.kind IS NULL OR w.kind=v_thread.kind)
      AND v_message.body IS NOT NULL
      AND (w.match_mode='exact' AND lower(btrim(v_message.body))=w.keyword
        OR w.match_mode='contains' AND position(w.keyword in lower(v_message.body))>0)
    ON CONFLICT(message_id,workflow_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted=ROW_COUNT;
  RETURN jsonb_build_object('ok',true,'matched',v_inserted);
END $$;

CREATE OR REPLACE FUNCTION public.list_social_inbox_suggestions(p_auth_id TEXT,p_brand_id UUID,p_thread_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,
    ARRAY['owner','manager','editor','reviewer','analyst','viewer'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_inbox_threads t WHERE t.id=p_thread_id AND t.brand_id=p_brand_id) THEN
    RETURN jsonb_build_object('ok',false,'code','THREAD_NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok',true,'suggestions',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',s.id,'workflow_id',s.workflow_id,'workflow_name',w.name,'keyword',w.keyword,
    'suggested_reply',s.suggested_reply,'status',s.status,'matched_at',s.matched_at)
    ORDER BY s.matched_at DESC,s.id DESC) FROM public.social_inbox_suggestions s
    JOIN public.social_inbox_workflows w ON w.id=s.workflow_id WHERE s.thread_id=p_thread_id),'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.decide_social_inbox_suggestion(
  p_auth_id TEXT,p_brand_id UUID,p_thread_id UUID,p_suggestion_id UUID,p_action TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_suggestion public.social_inbox_suggestions%ROWTYPE;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  IF p_action NOT IN ('use','dismiss') THEN RETURN jsonb_build_object('ok',false,'code','INVALID_ACTION'); END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  SELECT s.* INTO v_suggestion FROM public.social_inbox_suggestions s
    WHERE s.id=p_suggestion_id AND s.thread_id=p_thread_id AND s.brand_id=p_brand_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','SUGGESTION_NOT_FOUND'); END IF;
  UPDATE public.social_inbox_suggestions SET status=CASE WHEN p_action='use' THEN 'used' ELSE 'dismissed' END,
    decided_by_user_id=v_actor,decided_at=now() WHERE id=v_suggestion.id;
  INSERT INTO public.social_inbox_actions(brand_id,thread_id,actor_id,action,detail)
    VALUES(p_brand_id,p_thread_id,v_actor,CASE WHEN p_action='use' THEN 'use_suggestion' ELSE 'dismiss_suggestion' END,
      jsonb_build_object('suggestion_id',v_suggestion.id,'workflow_id',v_suggestion.workflow_id));
  RETURN jsonb_build_object('ok',true,'suggested_reply',v_suggestion.suggested_reply);
END $$;

DO $$ DECLARE fn TEXT;BEGIN FOREACH fn IN ARRAY ARRAY[
  'public.list_social_inbox_workflows(text,uuid)',
  'public.save_social_inbox_workflow(text,uuid,uuid,text,uuid,text,text,text,text,boolean)',
  'public.delete_social_inbox_workflow(text,uuid,uuid)',
  'public.evaluate_social_inbox_workflows(uuid,uuid)',
  'public.list_social_inbox_suggestions(text,uuid,uuid)',
  'public.decide_social_inbox_suggestion(text,uuid,uuid,uuid,text)'
] LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||fn||' FROM PUBLIC,anon,authenticated';EXECUTE 'GRANT EXECUTE ON FUNCTION '||fn||' TO service_role';END LOOP;END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
