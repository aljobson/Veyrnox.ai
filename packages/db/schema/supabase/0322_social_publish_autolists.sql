-- 0322: RSS/Atom Autolists feed reviewed content into existing posting queues.
BEGIN;

CREATE TABLE IF NOT EXISTS public.social_publish_autolists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.social_brands(id) ON DELETE CASCADE,
  queue_id UUID NOT NULL REFERENCES public.social_publish_queues(id) ON DELETE RESTRICT,
  created_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  feed_url TEXT NOT NULL CHECK (feed_url ~ '^https://' AND char_length(feed_url)<=2048),
  caption_template TEXT NOT NULL DEFAULT '{{title}}\n{{link}}' CHECK (char_length(caption_template) BETWEEN 1 AND 4000),
  refresh_interval_minutes INTEGER NOT NULL DEFAULT 360 CHECK (refresh_interval_minutes IN (30,60,180,360,720,1440)),
  enabled BOOLEAN NOT NULL DEFAULT true,
  auto_schedule BOOLEAN NOT NULL DEFAULT false,
  next_refresh_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_refreshed_at TIMESTAMPTZ NULL,
  last_error TEXT NULL CHECK (last_error IS NULL OR char_length(last_error)<=200),
  etag TEXT NULL CHECK (etag IS NULL OR char_length(etag)<=500),
  last_modified TEXT NULL CHECK (last_modified IS NULL OR char_length(last_modified)<=200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS social_publish_autolists_brand_name_idx ON public.social_publish_autolists(brand_id,lower(name));
CREATE INDEX IF NOT EXISTS social_publish_autolists_due_idx ON public.social_publish_autolists(next_refresh_at) WHERE enabled;
CREATE INDEX IF NOT EXISTS social_publish_autolists_queue_idx ON public.social_publish_autolists(queue_id);
CREATE INDEX IF NOT EXISTS social_publish_autolists_creator_idx ON public.social_publish_autolists(created_by_user_id);
ALTER TABLE public.social_publish_autolists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_publish_autolists FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_publish_autolists FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.social_publish_autolist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  autolist_id UUID NOT NULL REFERENCES public.social_publish_autolists(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL CHECK (char_length(external_id) BETWEEN 1 AND 512),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  link TEXT NOT NULL CHECK (link ~ '^https://' AND char_length(link)<=2048),
  summary TEXT NULL CHECK (summary IS NULL OR char_length(summary)<=4000),
  published_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','scheduled','skipped')),
  post_id UUID NULL REFERENCES public.social_posts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(autolist_id,external_id),
  CHECK ((status='scheduled')=(post_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS social_publish_autolist_items_status_idx ON public.social_publish_autolist_items(autolist_id,status,coalesce(published_at,created_at),id);
CREATE INDEX IF NOT EXISTS social_publish_autolist_items_post_idx ON public.social_publish_autolist_items(post_id) WHERE post_id IS NOT NULL;

-- The preceding 0320/0321 slices introduced single-column references too.
-- Keep the fresh-replay FK index invariant intact at the end of this stack.
CREATE INDEX IF NOT EXISTS social_inbox_workflows_creator_idx ON public.social_inbox_workflows(created_by_user_id);
CREATE INDEX IF NOT EXISTS social_inbox_suggestions_workflow_idx ON public.social_inbox_suggestions(workflow_id) WHERE workflow_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS social_inbox_suggestions_decider_idx ON public.social_inbox_suggestions(decided_by_user_id) WHERE decided_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS social_ad_campaigns_creator_idx ON public.social_ad_campaigns(created_by_user_id);
CREATE INDEX IF NOT EXISTS social_commerce_products_creator_idx ON public.social_commerce_products(created_by_user_id);
ALTER TABLE public.social_publish_autolist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_publish_autolist_items FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_publish_autolist_items FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.list_social_publish_autolists(p_auth_id TEXT,p_brand_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor','reviewer','analyst','viewer'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  RETURN jsonb_build_object('ok',true,'autolists',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',a.id,'queue_id',a.queue_id,'queue_name',q.name,'name',a.name,'feed_url',a.feed_url,'caption_template',a.caption_template,
    'refresh_interval_minutes',a.refresh_interval_minutes,'enabled',a.enabled,'auto_schedule',a.auto_schedule,
    'next_refresh_at',a.next_refresh_at,'last_refreshed_at',a.last_refreshed_at,'last_error',a.last_error,
    'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'title',i.title,'link',i.link,'summary',i.summary,
      'published_at',i.published_at,'status',i.status,'post_id',i.post_id) ORDER BY coalesce(i.published_at,i.created_at) DESC,i.id DESC)
      FROM (SELECT * FROM public.social_publish_autolist_items x WHERE x.autolist_id=a.id ORDER BY coalesce(x.published_at,x.created_at) DESC,x.id DESC LIMIT 20) i),'[]'::jsonb)
    ) ORDER BY a.updated_at DESC,a.id DESC) FROM public.social_publish_autolists a JOIN public.social_publish_queues q ON q.id=a.queue_id WHERE a.brand_id=p_brand_id),'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.save_social_publish_autolist(p_auth_id TEXT,p_brand_id UUID,p_id UUID,p_queue_id UUID,p_name TEXT,p_feed_url TEXT,p_caption_template TEXT,p_refresh_interval_minutes INTEGER,p_enabled BOOLEAN,p_auto_schedule BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_id UUID;v_created BOOLEAN:=false;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;v_actor:=(v_context->>'actor_id')::UUID;
  p_name:=btrim(coalesce(p_name,''));p_feed_url:=btrim(coalesce(p_feed_url,''));p_caption_template:=btrim(coalesce(p_caption_template,''));
  IF char_length(p_name) NOT BETWEEN 1 AND 80 OR p_feed_url !~ '^https://' OR char_length(p_feed_url)>2048
    OR char_length(p_caption_template) NOT BETWEEN 1 AND 4000
    OR replace(replace(replace(p_caption_template,'{{title}}',''),'{{link}}',''),'{{summary}}','') ~ '\{\{[^}]+\}\}'
    OR p_refresh_interval_minutes NOT IN (30,60,180,360,720,1440)
    OR NOT EXISTS(SELECT 1 FROM public.social_publish_queues q WHERE q.id=p_queue_id AND q.brand_id=p_brand_id)
  THEN RETURN jsonb_build_object('ok',false,'code','INVALID_AUTOLIST'); END IF;
  IF p_id IS NULL THEN
    IF (SELECT count(*) FROM public.social_publish_autolists a WHERE a.brand_id=p_brand_id)>=20 THEN RETURN jsonb_build_object('ok',false,'code','AUTOLIST_LIMIT'); END IF;
    INSERT INTO public.social_publish_autolists(brand_id,queue_id,created_by_user_id,name,feed_url,caption_template,refresh_interval_minutes,enabled,auto_schedule)
      VALUES(p_brand_id,p_queue_id,v_actor,p_name,p_feed_url,p_caption_template,p_refresh_interval_minutes,coalesce(p_enabled,true),coalesce(p_auto_schedule,false)) RETURNING id INTO v_id;v_created:=true;
  ELSE
    UPDATE public.social_publish_autolists SET queue_id=p_queue_id,name=p_name,feed_url=p_feed_url,caption_template=p_caption_template,
      refresh_interval_minutes=p_refresh_interval_minutes,enabled=coalesce(p_enabled,true),auto_schedule=coalesce(p_auto_schedule,false),
      next_refresh_at=CASE WHEN coalesce(p_enabled,true) THEN least(next_refresh_at,now()) ELSE next_refresh_at END,updated_at=now()
      WHERE id=p_id AND brand_id=p_brand_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','AUTOLIST_NOT_FOUND'); END IF;
  END IF;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id,detail) VALUES(v_actor,p_brand_id,'save_publish_autolist',v_id,jsonb_build_object('created',v_created,'auto_schedule',coalesce(p_auto_schedule,false)));
  RETURN jsonb_build_object('ok',true,'autolist_id',v_id,'created',v_created);
EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'code','AUTOLIST_NAME_TAKEN');
END $$;

CREATE OR REPLACE FUNCTION public.delete_social_publish_autolist(p_auth_id TEXT,p_brand_id UUID,p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_id UUID;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;v_actor:=(v_context->>'actor_id')::UUID;
  DELETE FROM public.social_publish_autolists WHERE id=p_id AND brand_id=p_brand_id RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','AUTOLIST_NOT_FOUND'); END IF;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id) VALUES(v_actor,p_brand_id,'delete_autolist',v_id);
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.claim_due_social_publish_autolists(p_limit INTEGER DEFAULT 5)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_limit INTEGER;
BEGIN
  v_limit:=least(greatest(coalesce(p_limit,5),1),10);
  RETURN jsonb_build_object('ok',true,'autolists',coalesce((WITH claimed AS (
    SELECT a.id FROM public.social_publish_autolists a JOIN public.social_publish_queues q ON q.id=a.queue_id
    WHERE a.enabled AND q.enabled AND a.next_refresh_at<=now() ORDER BY a.next_refresh_at,a.id FOR UPDATE OF a SKIP LOCKED LIMIT v_limit
  ), updated AS (
    UPDATE public.social_publish_autolists a SET next_refresh_at=now()+make_interval(mins=>a.refresh_interval_minutes),updated_at=now()
    FROM claimed c WHERE a.id=c.id RETURNING a.*
  ) SELECT jsonb_agg(jsonb_build_object('id',u.id,'feed_url',u.feed_url,'etag',u.etag,'last_modified',u.last_modified,'auto_schedule',u.auto_schedule) ORDER BY u.id) FROM updated u),'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.record_social_publish_autolist_refresh(p_id UUID,p_items JSONB,p_etag TEXT,p_last_modified TEXT,p_not_modified BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_item JSONB;v_added INTEGER:=0;v_autolist public.social_publish_autolists%ROWTYPE;
BEGIN
  SELECT * INTO v_autolist FROM public.social_publish_autolists WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','AUTOLIST_NOT_FOUND'); END IF;
  IF coalesce(p_not_modified,false) THEN
    UPDATE public.social_publish_autolists SET last_refreshed_at=now(),last_error=NULL,updated_at=now() WHERE id=p_id;
    RETURN jsonb_build_object('ok',true,'added',0,'not_modified',true);
  END IF;
  IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)>50 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_ITEMS'); END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(v_item)<>'object' OR char_length(btrim(coalesce(v_item->>'external_id',''))) NOT BETWEEN 1 AND 512
      OR char_length(btrim(coalesce(v_item->>'title',''))) NOT BETWEEN 1 AND 500 OR btrim(coalesce(v_item->>'link','')) !~ '^https://'
      OR char_length(btrim(v_item->>'link'))>2048 OR char_length(btrim(coalesce(v_item->>'summary','')))>4000
    THEN RETURN jsonb_build_object('ok',false,'code','INVALID_ITEM'); END IF;
    INSERT INTO public.social_publish_autolist_items(autolist_id,external_id,title,link,summary,published_at)
      VALUES(p_id,btrim(v_item->>'external_id'),btrim(v_item->>'title'),btrim(v_item->>'link'),nullif(btrim(v_item->>'summary'),''),
        CASE WHEN coalesce(v_item->>'published_at','')='' THEN NULL ELSE (v_item->>'published_at')::TIMESTAMPTZ END)
      ON CONFLICT(autolist_id,external_id) DO NOTHING;
    IF FOUND THEN v_added:=v_added+1;END IF;
  END LOOP;
  UPDATE public.social_publish_autolists SET etag=nullif(left(coalesce(p_etag,''),500),''),last_modified=nullif(left(coalesce(p_last_modified,''),200),''),last_refreshed_at=now(),last_error=NULL,updated_at=now() WHERE id=p_id;
  RETURN jsonb_build_object('ok',true,'added',v_added,'not_modified',false);
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN jsonb_build_object('ok',false,'code','INVALID_ITEM');
END $$;

CREATE OR REPLACE FUNCTION public.fail_social_publish_autolist_refresh(p_id UUID,p_error TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.social_publish_autolists SET last_refreshed_at=now(),last_error=left(coalesce(nullif(btrim(p_error),''),'feed_unavailable'),200),updated_at=now() WHERE id=p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','AUTOLIST_NOT_FOUND'); END IF;RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.schedule_social_publish_autolist_items(p_id UUID,p_limit INTEGER DEFAULT 10)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_autolist public.social_publish_autolists%ROWTYPE;v_queue public.social_publish_queues%ROWTYPE;v_item public.social_publish_autolist_items%ROWTYPE;
  v_at TIMESTAMPTZ;v_post UUID;v_key TEXT;v_text TEXT;v_scheduled INTEGER:=0;v_limit INTEGER;v_target_count INTEGER;
BEGIN
  v_limit:=least(greatest(coalesce(p_limit,10),1),20);SELECT * INTO v_autolist FROM public.social_publish_autolists WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','AUTOLIST_NOT_FOUND'); END IF;
  IF NOT v_autolist.enabled OR NOT v_autolist.auto_schedule THEN RETURN jsonb_build_object('ok',true,'scheduled',0); END IF;
  SELECT * INTO v_queue FROM public.social_publish_queues WHERE id=v_autolist.queue_id AND brand_id=v_autolist.brand_id AND enabled;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','QUEUE_NOT_FOUND'); END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('social-queue-slot:'||v_queue.id::TEXT,0));
  FOR v_item IN SELECT * FROM public.social_publish_autolist_items WHERE autolist_id=p_id AND status='pending' ORDER BY coalesce(published_at,created_at),id FOR UPDATE SKIP LOCKED LIMIT v_limit LOOP
    WITH candidates AS (
      SELECT ((d.day::DATE+make_interval(mins=>s.minute_of_day)) AT TIME ZONE v_queue.timezone) scheduled_at
      FROM public.social_publish_queue_slots s CROSS JOIN LATERAL generate_series((now() AT TIME ZONE v_queue.timezone)::DATE,((now() AT TIME ZONE v_queue.timezone)::DATE+56),interval '1 day') d(day)
      WHERE s.queue_id=v_queue.id AND extract(isodow FROM d.day)::INTEGER=s.iso_weekday
    ) SELECT c.scheduled_at INTO v_at FROM candidates c WHERE c.scheduled_at>now()+interval '5 minutes'
      AND NOT EXISTS(SELECT 1 FROM public.social_publish_queue_assignments a WHERE a.queue_id=v_queue.id AND a.scheduled_at=c.scheduled_at AND (a.post_id IS NOT NULL OR a.expires_at>now())) ORDER BY c.scheduled_at LIMIT 1;
    EXIT WHEN v_at IS NULL;v_key:='autolist_'||replace(v_item.id::TEXT,'-','');
    v_text:=left(replace(replace(replace(v_autolist.caption_template,'{{title}}',v_item.title),'{{link}}',v_item.link),'{{summary}}',coalesce(v_item.summary,'')),4000);
    INSERT INTO public.social_posts(brand_id,created_by_user_id,status,scheduled_at,global_text,idempotency_key) VALUES(v_autolist.brand_id,v_autolist.created_by_user_id,'scheduled',v_at,v_text,v_key) RETURNING id INTO v_post;
    INSERT INTO public.social_post_targets(post_id,account_id,network) SELECT v_post,a.id,a.network FROM unnest(v_queue.account_ids) x JOIN public.social_accounts a ON a.id=x AND a.brand_id=v_autolist.brand_id AND a.status='active';
    GET DIAGNOSTICS v_target_count=ROW_COUNT;
    IF v_target_count=0 THEN DELETE FROM public.social_posts WHERE id=v_post;RETURN jsonb_build_object('ok',false,'code','NO_TARGET_ACCOUNTS');END IF;
    INSERT INTO public.social_publish_queue_assignments(queue_id,brand_id,idempotency_key,scheduled_at,post_id,expires_at) VALUES(v_queue.id,v_autolist.brand_id,v_key,v_at,v_post,now());
    UPDATE public.social_publish_autolist_items SET status='scheduled',post_id=v_post WHERE id=v_item.id;v_scheduled:=v_scheduled+1;
    INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id,detail) VALUES(v_autolist.created_by_user_id,v_autolist.brand_id,'autolist_schedule',v_post,jsonb_build_object('autolist_id',p_id,'item_id',v_item.id));
  END LOOP;
  RETURN jsonb_build_object('ok',true,'scheduled',v_scheduled);
END $$;

DO $$ DECLARE fn TEXT;BEGIN FOREACH fn IN ARRAY ARRAY[
  'public.list_social_publish_autolists(text,uuid)',
  'public.save_social_publish_autolist(text,uuid,uuid,uuid,text,text,text,integer,boolean,boolean)',
  'public.delete_social_publish_autolist(text,uuid,uuid)',
  'public.claim_due_social_publish_autolists(integer)',
  'public.record_social_publish_autolist_refresh(uuid,jsonb,text,text,boolean)',
  'public.fail_social_publish_autolist_refresh(uuid,text)',
  'public.schedule_social_publish_autolist_items(uuid,integer)'
] LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||fn||' FROM PUBLIC,anon,authenticated';EXECUTE 'GRANT EXECUTE ON FUNCTION '||fn||' TO service_role';END LOOP;END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
