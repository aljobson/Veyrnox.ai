-- 0319: manually created and CSV-imported contacts alongside inbox-derived contacts.
BEGIN;

ALTER TABLE public.social_inbox_contact_profiles
  ADD COLUMN IF NOT EXISTS display_name TEXT NULL CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 120),
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'conversation' CHECK (source IN ('conversation','manual','csv'));

CREATE OR REPLACE FUNCTION public.list_social_inbox_contacts(
  p_auth_id TEXT,p_brand_id UUID,p_account_id UUID DEFAULT NULL,p_network TEXT DEFAULT NULL,
  p_subscription_status TEXT DEFAULT NULL,p_search TEXT DEFAULT NULL,p_tag TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,
    ARRAY['owner','manager','editor','reviewer','analyst','viewer'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  IF p_account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.social_accounts a WHERE a.id=p_account_id AND a.brand_id=p_brand_id)
    THEN RETURN jsonb_build_object('ok',false,'code','ACCOUNT_NOT_FOUND'); END IF;
  IF p_network IS NOT NULL AND p_network NOT IN ('instagram','facebook','twitter','linkedin','tiktok','youtube','threads','bluesky','twitch','gmb')
    OR p_subscription_status IS NOT NULL AND p_subscription_status NOT IN ('unknown','subscribed','unsubscribed')
    OR p_search IS NOT NULL AND char_length(p_search)>100
    OR p_tag IS NOT NULL AND char_length(p_tag) NOT BETWEEN 1 AND 32
  THEN RETURN jsonb_build_object('ok',false,'code','INVALID_FILTER'); END IF;

  RETURN jsonb_build_object('ok',true,'contacts',coalesce((SELECT jsonb_agg(row ORDER BY (row->>'last_active_at')::TIMESTAMPTZ DESC,row->>'external_id') FROM (
    SELECT jsonb_build_object('account_id',keys.account_id,'network',account.network,'account_name',account.display_name,
      'external_id',keys.participant_external_id,'name',coalesce(recent.participant_name,profile.display_name),
      'avatar_url',recent.participant_avatar_url,'source',coalesce(profile.source,'conversation'),
      'first_seen_at',coalesce(stats.first_seen_at,profile.created_at),'last_active_at',coalesce(stats.last_active_at,profile.updated_at),
      'thread_count',coalesce(stats.thread_count,0),'message_count',coalesce(stats.message_count,0),
      'unread_count',coalesce(stats.unread_count,0),'tags',to_jsonb(coalesce(profile.tags,'{}'::TEXT[])),
      'subscription_status',coalesce(profile.subscription_status,'unknown'),'notes',profile.notes) row
    FROM (
      SELECT t.account_id,t.participant_external_id FROM public.social_inbox_threads t
        WHERE t.brand_id=p_brand_id AND t.participant_external_id IS NOT NULL
      UNION
      SELECT p.account_id,p.participant_external_id FROM public.social_inbox_contact_profiles p WHERE p.brand_id=p_brand_id
    ) keys
    JOIN public.social_accounts account ON account.id=keys.account_id AND account.brand_id=p_brand_id
    LEFT JOIN public.social_inbox_contact_profiles profile ON profile.account_id=keys.account_id
      AND profile.participant_external_id=keys.participant_external_id
    LEFT JOIN LATERAL (
      SELECT t.participant_name,t.participant_avatar_url FROM public.social_inbox_threads t
      WHERE t.brand_id=p_brand_id AND t.account_id=keys.account_id AND t.participant_external_id=keys.participant_external_id
      ORDER BY t.latest_message_at DESC,t.id DESC LIMIT 1
    ) recent ON true
    LEFT JOIN LATERAL (
      SELECT min(t.created_at) first_seen_at,max(t.latest_message_at) last_active_at,count(*) thread_count,
        coalesce(sum(t.unread_count),0) unread_count,
        (SELECT count(*) FROM public.social_inbox_messages m JOIN public.social_inbox_threads mt ON mt.id=m.thread_id
          WHERE mt.brand_id=p_brand_id AND mt.account_id=keys.account_id
            AND mt.participant_external_id=keys.participant_external_id) message_count
      FROM public.social_inbox_threads t WHERE t.brand_id=p_brand_id AND t.account_id=keys.account_id
        AND t.participant_external_id=keys.participant_external_id
    ) stats ON true
    WHERE (p_account_id IS NULL OR keys.account_id=p_account_id) AND (p_network IS NULL OR account.network=p_network)
      AND (p_subscription_status IS NULL OR coalesce(profile.subscription_status,'unknown')=p_subscription_status)
      AND (p_search IS NULL OR coalesce(recent.participant_name,profile.display_name,'') ILIKE '%'||p_search||'%'
        OR keys.participant_external_id ILIKE '%'||p_search||'%')
      AND (p_tag IS NULL OR lower(p_tag)=ANY(coalesce(profile.tags,'{}'::TEXT[])))
    ORDER BY coalesce(stats.last_active_at,profile.updated_at) DESC,keys.participant_external_id
    LIMIT 100
  ) q),'[]'::JSONB));
END $$;

CREATE OR REPLACE FUNCTION public.import_social_inbox_contacts(
  p_auth_id TEXT,p_brand_id UUID,p_account_id UUID,p_source TEXT,p_contacts JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_count INTEGER;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  IF p_source NOT IN ('manual','csv') OR coalesce(jsonb_typeof(p_contacts),'')<>'array'
    THEN RETURN jsonb_build_object('ok',false,'code','INVALID_CONTACTS'); END IF;
  v_count:=jsonb_array_length(p_contacts);
  IF v_count NOT BETWEEN 1 AND 250 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_CONTACTS'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_accounts a WHERE a.id=p_account_id AND a.brand_id=p_brand_id AND a.status='active')
    THEN RETURN jsonb_build_object('ok',false,'code','ACCOUNT_NOT_FOUND'); END IF;
  IF (SELECT count(*)<>count(DISTINCT btrim(item->>'external_id')) FROM jsonb_array_elements(p_contacts) item)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_contacts) item WHERE jsonb_typeof(item)<>'object'
      OR char_length(btrim(coalesce(item->>'external_id',''))) NOT BETWEEN 1 AND 256
      OR char_length(btrim(coalesce(item->>'name',''))) NOT BETWEEN 1 AND 120
      OR coalesce(item->>'subscription_status','unknown') NOT IN ('unknown','subscribed','unsubscribed')
      OR char_length(btrim(coalesce(item->>'notes','')))>2000
      OR coalesce(jsonb_typeof(item->'tags'),'array')<>'array'
      OR jsonb_array_length(coalesce(item->'tags','[]'::JSONB))>10
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(item->'tags','[]'::JSONB)) tag
        WHERE jsonb_typeof(tag)<>'string' OR char_length(btrim(tag#>>'{}')) NOT BETWEEN 1 AND 32
          OR lower(btrim(tag#>>'{}'))!~'^[a-z0-9][a-z0-9 _-]*$'))
    THEN RETURN jsonb_build_object('ok',false,'code','INVALID_CONTACTS'); END IF;

  INSERT INTO public.social_inbox_contact_profiles(
    brand_id,account_id,participant_external_id,display_name,tags,subscription_status,notes,source,updated_by_user_id)
  SELECT p_brand_id,p_account_id,btrim(item->>'external_id'),btrim(item->>'name'),
    ARRAY(SELECT DISTINCT lower(btrim(tag#>>'{}')) FROM jsonb_array_elements(coalesce(item->'tags','[]'::JSONB)) tag ORDER BY 1),
    coalesce(item->>'subscription_status','unknown'),NULLIF(btrim(coalesce(item->>'notes','')),''),p_source,v_actor
  FROM jsonb_array_elements(p_contacts) item
  ON CONFLICT(account_id,participant_external_id) DO UPDATE SET display_name=excluded.display_name,tags=excluded.tags,
    subscription_status=excluded.subscription_status,notes=excluded.notes,source=excluded.source,
    updated_by_user_id=excluded.updated_by_user_id,updated_at=clock_timestamp();
  INSERT INTO public.social_inbox_actions(brand_id,actor_id,action,detail)
    VALUES(p_brand_id,v_actor,'contact_import',jsonb_build_object('account_id',p_account_id,'source',p_source,'count',v_count));
  RETURN jsonb_build_object('ok',true,'imported',v_count);
END $$;

CREATE OR REPLACE FUNCTION public.update_social_inbox_contact(
  p_auth_id TEXT,p_brand_id UUID,p_account_id UUID,p_external_id TEXT,p_tags JSONB,
  p_subscription_status TEXT,p_notes TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_tags TEXT[];
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor','reviewer'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  IF p_external_id IS NULL OR char_length(p_external_id) NOT BETWEEN 1 AND 256
    OR coalesce(p_subscription_status,'') NOT IN ('unknown','subscribed','unsubscribed')
    OR coalesce(jsonb_typeof(p_tags),'')<>'array' OR char_length(coalesce(p_notes,''))>2000
    THEN RETURN jsonb_build_object('ok',false,'code','INVALID_CONTACT'); END IF;
  IF jsonb_array_length(p_tags)>10 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_tags) x
    WHERE jsonb_typeof(x)<>'string' OR char_length(btrim(x#>>'{}')) NOT BETWEEN 1 AND 32
      OR lower(btrim(x#>>'{}'))!~'^[a-z0-9][a-z0-9 _-]*$')
    THEN RETURN jsonb_build_object('ok',false,'code','INVALID_CONTACT'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_accounts a WHERE a.id=p_account_id AND a.brand_id=p_brand_id)
    THEN RETURN jsonb_build_object('ok',false,'code','ACCOUNT_NOT_FOUND'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_inbox_contact_profiles p WHERE p.brand_id=p_brand_id AND p.account_id=p_account_id
      AND p.participant_external_id=p_external_id)
    AND NOT EXISTS(SELECT 1 FROM public.social_inbox_threads t WHERE t.brand_id=p_brand_id AND t.account_id=p_account_id
      AND t.participant_external_id=p_external_id)
    THEN RETURN jsonb_build_object('ok',false,'code','CONTACT_NOT_FOUND'); END IF;
  SELECT coalesce(array_agg(tag ORDER BY tag),'{}'::TEXT[]) INTO v_tags FROM (
    SELECT DISTINCT lower(btrim(x#>>'{}')) tag FROM jsonb_array_elements(p_tags) x
  ) q;
  INSERT INTO public.social_inbox_contact_profiles(brand_id,account_id,participant_external_id,tags,subscription_status,notes,updated_by_user_id)
    VALUES(p_brand_id,p_account_id,p_external_id,v_tags,p_subscription_status,NULLIF(btrim(coalesce(p_notes,'')),''),v_actor)
  ON CONFLICT(account_id,participant_external_id) DO UPDATE SET tags=excluded.tags,subscription_status=excluded.subscription_status,
    notes=excluded.notes,updated_by_user_id=excluded.updated_by_user_id,updated_at=clock_timestamp();
  INSERT INTO public.social_inbox_actions(brand_id,actor_id,action,detail)
    VALUES(p_brand_id,v_actor,'contact_update',jsonb_build_object('account_id',p_account_id,'subscription_status',p_subscription_status));
  RETURN jsonb_build_object('ok',true,'tags',to_jsonb(v_tags),'subscription_status',p_subscription_status);
END $$;

REVOKE ALL ON FUNCTION public.import_social_inbox_contacts(TEXT,UUID,UUID,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.import_social_inbox_contacts(TEXT,UUID,UUID,TEXT,JSONB) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
