-- 0318: paid inbox contact directory derived from provider conversations.
BEGIN;

CREATE TABLE IF NOT EXISTS public.social_inbox_contact_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.social_brands(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  participant_external_id TEXT NOT NULL CHECK (char_length(participant_external_id) BETWEEN 1 AND 256),
  tags TEXT[] NOT NULL DEFAULT '{}'::TEXT[] CHECK (cardinality(tags)<=10),
  subscription_status TEXT NOT NULL DEFAULT 'unknown' CHECK (subscription_status IN ('unknown','subscribed','unsubscribed')),
  notes TEXT NULL CHECK (notes IS NULL OR char_length(notes)<=2000),
  updated_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT social_inbox_contact_profiles_identity_unique UNIQUE(account_id,participant_external_id)
);
CREATE INDEX IF NOT EXISTS social_inbox_contact_profiles_brand_updated_idx
  ON public.social_inbox_contact_profiles(brand_id,updated_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS social_inbox_contact_profiles_account_idx ON public.social_inbox_contact_profiles(account_id);
CREATE INDEX IF NOT EXISTS social_inbox_contact_profiles_user_idx ON public.social_inbox_contact_profiles(updated_by_user_id);
CREATE INDEX IF NOT EXISTS social_inbox_contact_profiles_tags_idx ON public.social_inbox_contact_profiles USING gin(tags);
CREATE INDEX IF NOT EXISTS social_inbox_threads_participant_activity_idx
  ON public.social_inbox_threads(brand_id,account_id,participant_external_id,latest_message_at DESC)
  WHERE participant_external_id IS NOT NULL;
ALTER TABLE public.social_inbox_contact_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_inbox_contact_profiles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_inbox_contact_profiles FROM PUBLIC,anon,authenticated,service_role;

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
    SELECT jsonb_build_object('account_id',recent.account_id,'network',recent.network,'account_name',recent.account_name,
      'external_id',recent.participant_external_id,'name',recent.participant_name,'avatar_url',recent.participant_avatar_url,
      'first_seen_at',stats.first_seen_at,'last_active_at',stats.last_active_at,'thread_count',stats.thread_count,
      'message_count',stats.message_count,'unread_count',stats.unread_count,
      'tags',to_jsonb(coalesce(profile.tags,'{}'::TEXT[])),
      'subscription_status',coalesce(profile.subscription_status,'unknown'),'notes',profile.notes) row
    FROM (
      SELECT DISTINCT ON(t.account_id,t.participant_external_id) t.account_id,t.participant_external_id,
        t.participant_name,t.participant_avatar_url,a.network,a.display_name account_name,t.latest_message_at
      FROM public.social_inbox_threads t JOIN public.social_accounts a ON a.id=t.account_id
      WHERE t.brand_id=p_brand_id AND t.participant_external_id IS NOT NULL
      ORDER BY t.account_id,t.participant_external_id,t.latest_message_at DESC,t.id DESC
    ) recent
    JOIN LATERAL (
      SELECT totals.*,(SELECT count(*) FROM public.social_inbox_messages m JOIN public.social_inbox_threads mt ON mt.id=m.thread_id
        WHERE mt.brand_id=p_brand_id AND mt.account_id=recent.account_id
          AND mt.participant_external_id=recent.participant_external_id) message_count
      FROM (SELECT min(t.created_at) first_seen_at,max(t.latest_message_at) last_active_at,count(*) thread_count,
        coalesce(sum(t.unread_count),0) unread_count
        FROM public.social_inbox_threads t WHERE t.brand_id=p_brand_id AND t.account_id=recent.account_id
          AND t.participant_external_id=recent.participant_external_id) totals
    ) stats ON true
    LEFT JOIN public.social_inbox_contact_profiles profile ON profile.account_id=recent.account_id
      AND profile.participant_external_id=recent.participant_external_id
    WHERE (p_account_id IS NULL OR recent.account_id=p_account_id) AND (p_network IS NULL OR recent.network=p_network)
      AND (p_subscription_status IS NULL OR coalesce(profile.subscription_status,'unknown')=p_subscription_status)
      AND (p_search IS NULL OR recent.participant_name ILIKE '%'||p_search||'%' OR recent.participant_external_id ILIKE '%'||p_search||'%')
      AND (p_tag IS NULL OR lower(p_tag)=ANY(coalesce(profile.tags,'{}'::TEXT[])))
    ORDER BY stats.last_active_at DESC,recent.participant_external_id
    LIMIT 100
  ) q),'[]'::JSONB));
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
    OR coalesce(jsonb_typeof(p_tags),'')<>'array'
    OR char_length(coalesce(p_notes,''))>2000 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_CONTACT'); END IF;
  IF jsonb_array_length(p_tags)>10 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_tags) x
    WHERE jsonb_typeof(x)<>'string' OR char_length(btrim(x#>>'{}')) NOT BETWEEN 1 AND 32
      OR lower(btrim(x#>>'{}'))!~'^[a-z0-9][a-z0-9 _-]*$')
  THEN RETURN jsonb_build_object('ok',false,'code','INVALID_CONTACT'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_accounts a WHERE a.id=p_account_id AND a.brand_id=p_brand_id) THEN
    RETURN jsonb_build_object('ok',false,'code','ACCOUNT_NOT_FOUND'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_inbox_threads t WHERE t.brand_id=p_brand_id AND t.account_id=p_account_id
    AND t.participant_external_id=p_external_id) THEN RETURN jsonb_build_object('ok',false,'code','CONTACT_NOT_FOUND'); END IF;
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

REVOKE ALL ON FUNCTION public.list_social_inbox_contacts(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_social_inbox_contact(TEXT,UUID,UUID,TEXT,JSONB,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_social_inbox_contacts(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_social_inbox_contact(TEXT,UUID,UUID,TEXT,JSONB,TEXT,TEXT) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
