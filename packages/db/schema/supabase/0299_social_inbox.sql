-- 0299: paid Publish inbox foundation. Provider webhooks write normalized
-- conversations/messages through service-role RPCs; owners read and manage only
-- their own brand through narrow SECURITY DEFINER functions.
BEGIN;

CREATE TABLE IF NOT EXISTS public.social_inbox_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES public.social_brands(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
    provider_thread_id TEXT NOT NULL CHECK (char_length(provider_thread_id) BETWEEN 1 AND 256),
    kind TEXT NOT NULL CHECK (kind IN ('message', 'comment', 'review')),
    participant_external_id TEXT NULL CHECK (participant_external_id IS NULL OR char_length(participant_external_id) BETWEEN 1 AND 256),
    participant_name TEXT NULL CHECK (participant_name IS NULL OR char_length(participant_name) BETWEEN 1 AND 200),
    participant_avatar_url TEXT NULL CHECK (participant_avatar_url IS NULL OR char_length(participant_avatar_url) <= 2048),
    subject TEXT NULL CHECK (subject IS NULL OR char_length(subject) <= 500),
    provider_url TEXT NULL CHECK (provider_url IS NULL OR char_length(provider_url) <= 2048),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    unread_count INTEGER NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
    can_reply BOOLEAN NOT NULL DEFAULT false,
    latest_message_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT social_inbox_threads_provider_unique UNIQUE (account_id, kind, provider_thread_id)
);
CREATE INDEX IF NOT EXISTS social_inbox_threads_brand_latest_idx
    ON public.social_inbox_threads (brand_id, latest_message_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS social_inbox_threads_account_latest_idx
    ON public.social_inbox_threads (account_id, latest_message_at DESC, id DESC);
ALTER TABLE public.social_inbox_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_inbox_threads FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_inbox_threads FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.social_inbox_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES public.social_inbox_threads(id) ON DELETE CASCADE,
    provider_message_id TEXT NULL CHECK (provider_message_id IS NULL OR char_length(provider_message_id) BETWEEN 1 AND 256),
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    body TEXT NULL CHECK (body IS NULL OR char_length(body) <= 8000),
    media JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(media) = 'array'),
    delivery_status TEXT NOT NULL DEFAULT 'received' CHECK (delivery_status IN ('received', 'pending', 'sending', 'sent', 'failed')),
    failure_code TEXT NULL CHECK (failure_code IS NULL OR failure_code ~ '^[a-z0-9_]{1,64}$'),
    idempotency_key TEXT NULL CHECK (idempotency_key IS NULL OR idempotency_key ~ '^[A-Za-z0-9:_-]{16,128}$'),
    sent_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS social_inbox_messages_provider_unique
    ON public.social_inbox_messages (thread_id, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS social_inbox_messages_idempotency_unique
    ON public.social_inbox_messages (thread_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS social_inbox_messages_thread_sent_idx
    ON public.social_inbox_messages (thread_id, sent_at, id);
ALTER TABLE public.social_inbox_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_inbox_messages FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_inbox_messages FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.social_inbox_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES public.social_brands(id) ON DELETE RESTRICT,
    thread_id UUID NULL REFERENCES public.social_inbox_threads(id) ON DELETE SET NULL,
    actor_id UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL CHECK (action ~ '^[a-z_]{1,40}$'),
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_inbox_actions_brand_created_idx
    ON public.social_inbox_actions (brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS social_inbox_actions_thread_idx
    ON public.social_inbox_actions (thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS social_inbox_actions_actor_idx
    ON public.social_inbox_actions (actor_id) WHERE actor_id IS NOT NULL;
ALTER TABLE public.social_inbox_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_inbox_actions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_inbox_actions FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.social_inbox_actions_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'social_inbox_actions is append-only'; END $$;
DROP TRIGGER IF EXISTS social_inbox_actions_append_only ON public.social_inbox_actions;
CREATE TRIGGER social_inbox_actions_append_only BEFORE UPDATE OR DELETE ON public.social_inbox_actions
FOR EACH ROW EXECUTE FUNCTION public.social_inbox_actions_append_only();

CREATE OR REPLACE FUNCTION public.social_inbox_paid_user(p_auth_id TEXT)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID;
BEGIN
  IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NULL; END IF;
  SELECT u.id INTO v_user FROM public.users u JOIN auth.users a ON a.id=p_auth_id::UUID WHERE u.auth_id=p_auth_id;
  IF v_user IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.social_publish_subscriptions s WHERE s.user_id=v_user
      AND s.status IN ('active','past_due') AND s.current_period_end > now()
  ) THEN RETURN NULL; END IF;
  RETURN v_user;
END $$;

-- Service-only webhook ingestion. Duplicate provider messages are idempotent and
-- do not increase the unread count twice.
CREATE OR REPLACE FUNCTION public.ingest_social_inbox_event(
  p_network TEXT, p_external_account_id TEXT, p_provider_thread_id TEXT, p_kind TEXT,
  p_provider_message_id TEXT, p_direction TEXT, p_body TEXT, p_media JSONB,
  p_participant_external_id TEXT, p_participant_name TEXT, p_participant_avatar_url TEXT,
  p_subject TEXT, p_provider_url TEXT, p_can_reply BOOLEAN, p_sent_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_account public.social_accounts%ROWTYPE; v_thread UUID; v_message UUID; v_inserted INTEGER;
BEGIN
  IF p_network NOT IN ('instagram','facebook','twitter','linkedin','tiktok','youtube','threads','bluesky','twitch','gmb')
    OR p_external_account_id IS NULL OR char_length(p_external_account_id) NOT BETWEEN 1 AND 128
    OR p_provider_thread_id IS NULL OR char_length(p_provider_thread_id) NOT BETWEEN 1 AND 256
    OR p_provider_message_id IS NULL OR char_length(p_provider_message_id) NOT BETWEEN 1 AND 256
    OR p_kind NOT IN ('message','comment','review') OR p_direction NOT IN ('inbound','outbound')
    OR p_sent_at IS NULL OR p_sent_at > now() + interval '10 minutes'
    OR p_body IS NOT NULL AND char_length(p_body) > 8000
    OR p_participant_external_id IS NOT NULL AND char_length(p_participant_external_id) > 256
    OR p_participant_avatar_url IS NOT NULL AND char_length(p_participant_avatar_url) > 2048
    OR p_provider_url IS NOT NULL AND char_length(p_provider_url) > 2048
    OR COALESCE(jsonb_typeof(p_media),'array') <> 'array'
  THEN RETURN jsonb_build_object('ok',false,'code','INVALID_EVENT'); END IF;
  SELECT * INTO v_account FROM public.social_accounts a WHERE a.network=p_network
    AND a.external_account_id=p_external_account_id AND a.status='active' ORDER BY a.connected_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','ACCOUNT_NOT_FOUND'); END IF;

  INSERT INTO public.social_inbox_threads(brand_id,account_id,provider_thread_id,kind,participant_external_id,
    participant_name,participant_avatar_url,subject,provider_url,can_reply,latest_message_at)
  VALUES(v_account.brand_id,v_account.id,p_provider_thread_id,p_kind,NULLIF(p_participant_external_id,''),
    NULLIF(left(p_participant_name,200),''),NULLIF(left(p_participant_avatar_url,2048),''),NULLIF(left(p_subject,500),''),
    NULLIF(left(p_provider_url,2048),''),COALESCE(p_can_reply,false) AND (
      (v_account.network='instagram' AND 'instagram_business_manage_comments'=ANY(v_account.scopes_granted)) OR
      (v_account.network='facebook' AND 'pages_manage_engagement'=ANY(v_account.scopes_granted))
    ),p_sent_at)
  ON CONFLICT(account_id,kind,provider_thread_id) DO UPDATE SET
    participant_external_id=COALESCE(EXCLUDED.participant_external_id,public.social_inbox_threads.participant_external_id),
    participant_name=COALESCE(EXCLUDED.participant_name,public.social_inbox_threads.participant_name),
    participant_avatar_url=COALESCE(EXCLUDED.participant_avatar_url,public.social_inbox_threads.participant_avatar_url),
    subject=COALESCE(EXCLUDED.subject,public.social_inbox_threads.subject),
    provider_url=COALESCE(EXCLUDED.provider_url,public.social_inbox_threads.provider_url),
    can_reply=public.social_inbox_threads.can_reply OR EXCLUDED.can_reply,
    latest_message_at=GREATEST(public.social_inbox_threads.latest_message_at,EXCLUDED.latest_message_at),updated_at=now()
  RETURNING id INTO v_thread;

  INSERT INTO public.social_inbox_messages(thread_id,provider_message_id,direction,body,media,delivery_status,sent_at)
  VALUES(v_thread,p_provider_message_id,p_direction,NULLIF(p_body,''),COALESCE(p_media,'[]'::jsonb),
    CASE WHEN p_direction='inbound' THEN 'received' ELSE 'sent' END,p_sent_at)
  ON CONFLICT(thread_id,provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING RETURNING id INTO v_message;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted=1 AND p_direction='inbound' THEN
    UPDATE public.social_inbox_threads SET unread_count=unread_count+1,status='open',updated_at=now() WHERE id=v_thread;
  END IF;
  RETURN jsonb_build_object('ok',true,'thread_id',v_thread,'message_id',v_message,'idempotent',v_inserted=0);
END $$;

CREATE OR REPLACE FUNCTION public.list_social_inbox(
  p_auth_id TEXT, p_brand_id UUID, p_account_id UUID DEFAULT NULL,
  p_state TEXT DEFAULT 'unresolved', p_kind TEXT DEFAULT NULL, p_search TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID;
BEGIN
  IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
  v_user:=public.social_inbox_paid_user(p_auth_id);
  IF v_user IS NULL THEN
    IF EXISTS(SELECT 1 FROM public.users u JOIN auth.users a ON a.id=p_auth_id::UUID WHERE u.auth_id=p_auth_id) THEN
      RETURN jsonb_build_object('ok',false,'code','PLAN_REQUIRED');
    END IF;
    RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_brands b WHERE b.id=p_brand_id AND b.owner_user_id=v_user) THEN
    RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND'); END IF;
  IF p_account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.social_accounts a WHERE a.id=p_account_id AND a.brand_id=p_brand_id) THEN
    RETURN jsonb_build_object('ok',false,'code','ACCOUNT_NOT_FOUND'); END IF;
  IF p_state NOT IN ('all','unread','unresolved','resolved') OR (p_kind IS NOT NULL AND p_kind NOT IN ('message','comment','review'))
    OR p_search IS NOT NULL AND char_length(p_search)>100 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_FILTER'); END IF;

  RETURN jsonb_build_object('ok',true,
    'counts',jsonb_build_object(
      'all',(SELECT count(*) FROM public.social_inbox_threads t WHERE t.brand_id=p_brand_id AND (p_account_id IS NULL OR t.account_id=p_account_id)),
      'unread',(SELECT count(*) FROM public.social_inbox_threads t WHERE t.brand_id=p_brand_id AND t.unread_count>0 AND (p_account_id IS NULL OR t.account_id=p_account_id)),
      'unresolved',(SELECT count(*) FROM public.social_inbox_threads t WHERE t.brand_id=p_brand_id AND t.status='open' AND (p_account_id IS NULL OR t.account_id=p_account_id)),
      'resolved',(SELECT count(*) FROM public.social_inbox_threads t WHERE t.brand_id=p_brand_id AND t.status='resolved' AND (p_account_id IS NULL OR t.account_id=p_account_id))),
    'threads',COALESCE((SELECT jsonb_agg(row ORDER BY (row->>'latest_message_at')::timestamptz DESC) FROM (
      SELECT jsonb_build_object('id',t.id,'account_id',t.account_id,'network',a.network,'account_name',a.display_name,
        'kind',t.kind,'participant_name',t.participant_name,'participant_avatar_url',t.participant_avatar_url,
        'subject',t.subject,'provider_url',t.provider_url,'status',t.status,'unread_count',t.unread_count,
        'can_reply',t.can_reply,'latest_message_at',t.latest_message_at,'preview',(
          SELECT left(COALESCE(m.body,''),240) FROM public.social_inbox_messages m WHERE m.thread_id=t.id ORDER BY m.sent_at DESC,m.id DESC LIMIT 1))
      FROM public.social_inbox_threads t JOIN public.social_accounts a ON a.id=t.account_id
      WHERE t.brand_id=p_brand_id AND (p_account_id IS NULL OR t.account_id=p_account_id)
        AND (p_kind IS NULL OR t.kind=p_kind)
        AND (p_state='all' OR p_state='unread' AND t.unread_count>0 OR p_state='unresolved' AND t.status='open' OR p_state='resolved' AND t.status='resolved')
        AND (p_search IS NULL OR t.participant_name ILIKE '%'||p_search||'%' OR t.subject ILIKE '%'||p_search||'%'
          OR EXISTS(SELECT 1 FROM public.social_inbox_messages sm WHERE sm.thread_id=t.id AND sm.body ILIKE '%'||p_search||'%'))
      ORDER BY t.latest_message_at DESC,t.id DESC LIMIT 50
    ) q(row)),'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.get_social_inbox_thread(p_auth_id TEXT,p_thread_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_thread public.social_inbox_threads%ROWTYPE; v_network TEXT; v_account_name TEXT;
BEGIN
  IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
  v_user:=public.social_inbox_paid_user(p_auth_id);
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','PLAN_REQUIRED'); END IF;
  SELECT t.* INTO v_thread FROM public.social_inbox_threads t
    JOIN public.social_accounts a ON a.id=t.account_id JOIN public.social_brands b ON b.id=t.brand_id
    WHERE t.id=p_thread_id AND b.owner_user_id=v_user;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','THREAD_NOT_FOUND'); END IF;
  SELECT a.network,a.display_name INTO v_network,v_account_name FROM public.social_accounts a WHERE a.id=v_thread.account_id;
  RETURN jsonb_build_object('ok',true,'thread',jsonb_build_object('id',v_thread.id,'account_id',v_thread.account_id,
    'network',v_network,'account_name',v_account_name,'kind',v_thread.kind,'participant_name',v_thread.participant_name,
    'participant_avatar_url',v_thread.participant_avatar_url,'subject',v_thread.subject,'provider_url',v_thread.provider_url,
    'status',v_thread.status,'unread_count',v_thread.unread_count,'can_reply',v_thread.can_reply,'latest_message_at',v_thread.latest_message_at),
    'messages',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'direction',m.direction,'body',m.body,'media',m.media,
      'delivery_status',m.delivery_status,'sent_at',m.sent_at) ORDER BY m.sent_at,m.id) FROM public.social_inbox_messages m WHERE m.thread_id=v_thread.id),'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.update_social_inbox_thread(p_auth_id TEXT,p_thread_id UUID,p_action TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_thread public.social_inbox_threads%ROWTYPE;
BEGIN
  IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
  v_user:=public.social_inbox_paid_user(p_auth_id); IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','PLAN_REQUIRED'); END IF;
  SELECT t.* INTO v_thread FROM public.social_inbox_threads t JOIN public.social_brands b ON b.id=t.brand_id
    WHERE t.id=p_thread_id AND b.owner_user_id=v_user FOR UPDATE OF t;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','THREAD_NOT_FOUND'); END IF;
  IF p_action='read' THEN UPDATE public.social_inbox_threads SET unread_count=0,updated_at=now() WHERE id=p_thread_id;
  ELSIF p_action='unread' THEN UPDATE public.social_inbox_threads SET unread_count=GREATEST(unread_count,1),updated_at=now() WHERE id=p_thread_id;
  ELSIF p_action='resolve' THEN UPDATE public.social_inbox_threads SET status='resolved',unread_count=0,updated_at=now() WHERE id=p_thread_id;
  ELSIF p_action='reopen' THEN UPDATE public.social_inbox_threads SET status='open',updated_at=now() WHERE id=p_thread_id;
  ELSE RETURN jsonb_build_object('ok',false,'code','INVALID_ACTION'); END IF;
  INSERT INTO public.social_inbox_actions(brand_id,thread_id,actor_id,action) VALUES(v_thread.brand_id,v_thread.id,v_user,p_action);
  RETURN jsonb_build_object('ok',true);
END $$;

-- Creates a delivery attempt and returns provider material only to the trusted
-- server route. The browser receives a separately shaped response.
CREATE OR REPLACE FUNCTION public.create_social_inbox_reply(p_auth_id TEXT,p_thread_id UUID,p_body TEXT,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_thread public.social_inbox_threads%ROWTYPE; v_account public.social_accounts%ROWTYPE; v_message UUID; v_existing public.social_inbox_messages%ROWTYPE;
BEGIN
  IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
  v_user:=public.social_inbox_paid_user(p_auth_id); IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','PLAN_REQUIRED'); END IF;
  IF p_body IS NULL OR char_length(btrim(p_body)) NOT BETWEEN 1 AND 8000 OR p_idempotency_key IS NULL
    OR p_idempotency_key !~ '^[A-Za-z0-9:_-]{16,128}$' THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_REPLY'); END IF;
  SELECT t.* INTO v_thread FROM public.social_inbox_threads t JOIN public.social_brands b ON b.id=t.brand_id
    WHERE t.id=p_thread_id AND b.owner_user_id=v_user FOR UPDATE OF t;
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
    SELECT * INTO v_existing FROM public.social_inbox_messages m
      WHERE m.thread_id=v_thread.id AND m.idempotency_key=p_idempotency_key;
    RETURN jsonb_build_object('ok',true,'idempotent',true,'message_id',v_existing.id,'delivery_status',v_existing.delivery_status);
  END IF;
  RETURN jsonb_build_object('ok',true,'idempotent',false,'message_id',v_message,'network',v_account.network,
    'provider_thread_id',v_thread.provider_thread_id,'access_token_enc',encode(v_account.access_token_enc,'hex'));
END $$;

CREATE OR REPLACE FUNCTION public.finish_social_inbox_reply(p_message_id UUID,p_success BOOLEAN,p_provider_message_id TEXT,p_failure_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_thread UUID;
BEGIN
  UPDATE public.social_inbox_messages SET delivery_status=CASE WHEN p_success THEN 'sent' ELSE 'failed' END,
    provider_message_id=CASE WHEN p_success THEN NULLIF(p_provider_message_id,'') ELSE provider_message_id END,
    failure_code=CASE WHEN p_success THEN NULL ELSE COALESCE(NULLIF(p_failure_code,''),'provider_failed') END
    WHERE id=p_message_id AND direction='outbound' AND delivery_status='sending' RETURNING thread_id INTO v_thread;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','MESSAGE_NOT_FOUND'); END IF;
  UPDATE public.social_inbox_threads SET latest_message_at=now(),updated_at=now() WHERE id=v_thread;
  RETURN jsonb_build_object('ok',true);
END $$;

DO $$ DECLARE fn TEXT; BEGIN FOREACH fn IN ARRAY ARRAY[
  'public.ingest_social_inbox_event(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN,TIMESTAMPTZ)',
  'public.list_social_inbox(TEXT,UUID,UUID,TEXT,TEXT,TEXT)',
  'public.get_social_inbox_thread(TEXT,UUID)',
  'public.update_social_inbox_thread(TEXT,UUID,TEXT)',
  'public.create_social_inbox_reply(TEXT,UUID,TEXT,TEXT)',
  'public.finish_social_inbox_reply(UUID,BOOLEAN,TEXT,TEXT)',
  'public.social_inbox_paid_user(TEXT)'
] LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',fn); EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn); END LOOP;
REVOKE ALL ON FUNCTION public.social_inbox_actions_append_only() FROM PUBLIC,anon,authenticated; END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
