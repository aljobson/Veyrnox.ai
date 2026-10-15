-- 0300_social_smartlinks.sql — paid, brand-owned link-in-bio pages.
-- Public reads and click counters stay behind service-role RPCs; browsers
-- receive no table privileges and no visitor identifiers are stored.

CREATE TABLE IF NOT EXISTS public.social_smartlinks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL UNIQUE REFERENCES public.social_brands(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$'),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  bio TEXT NULL CHECK (bio IS NULL OR char_length(bio) <= 280),
  avatar_url TEXT NULL CHECK (avatar_url IS NULL OR (avatar_url ~ '^https://' AND char_length(avatar_url) <= 1000)),
  theme TEXT NOT NULL DEFAULT 'midnight' CHECK (theme IN ('midnight','light','sunset')),
  published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_smartlinks_published_slug_idx ON public.social_smartlinks(slug) WHERE published;
ALTER TABLE public.social_smartlinks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_smartlinks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_smartlinks FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.social_smartlink_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  smartlink_id UUID NOT NULL REFERENCES public.social_smartlinks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 19),
  label TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 60),
  url TEXT NOT NULL CHECK (url ~ '^https://' AND char_length(url) <= 1000),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(smartlink_id, position)
);
CREATE INDEX IF NOT EXISTS social_smartlink_items_link_idx ON public.social_smartlink_items(smartlink_id);
ALTER TABLE public.social_smartlink_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_smartlink_items FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_smartlink_items FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.social_smartlink_daily_counts (
  smartlink_id UUID NOT NULL REFERENCES public.social_smartlinks(id) ON DELETE CASCADE,
  item_id UUID NULL REFERENCES public.social_smartlink_items(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,
  views BIGINT NOT NULL DEFAULT 0 CHECK (views >= 0),
  clicks BIGINT NOT NULL DEFAULT 0 CHECK (clicks >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS social_smartlink_daily_page_unique
  ON public.social_smartlink_daily_counts(smartlink_id, metric_date) WHERE item_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS social_smartlink_daily_item_unique
  ON public.social_smartlink_daily_counts(smartlink_id, item_id, metric_date) WHERE item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS social_smartlink_counts_item_idx ON public.social_smartlink_daily_counts(item_id) WHERE item_id IS NOT NULL;
ALTER TABLE public.social_smartlink_daily_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_smartlink_daily_counts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_smartlink_daily_counts FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_social_smartlink_editor(p_auth_id TEXT, p_brand_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_link public.social_smartlinks%ROWTYPE;
BEGIN
  v_user := public.social_inbox_paid_user(p_auth_id);
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','PLAN_REQUIRED'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_brands WHERE id=p_brand_id AND owner_user_id=v_user) THEN
    RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND');
  END IF;
  SELECT * INTO v_link FROM public.social_smartlinks WHERE brand_id=p_brand_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'smartlink',NULL,'items','[]'::jsonb,'totals',jsonb_build_object('views',0,'clicks',0)); END IF;
  RETURN jsonb_build_object('ok',true,'smartlink',jsonb_build_object(
    'id',v_link.id,'slug',v_link.slug,'title',v_link.title,'bio',v_link.bio,'avatar_url',v_link.avatar_url,
    'theme',v_link.theme,'published',v_link.published,'updated_at',v_link.updated_at),
    'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'label',i.label,'url',i.url,'enabled',i.enabled,
      'clicks',COALESCE((SELECT sum(c.clicks) FROM public.social_smartlink_daily_counts c WHERE c.item_id=i.id),0)) ORDER BY i.position)
      FROM public.social_smartlink_items i WHERE i.smartlink_id=v_link.id),'[]'::jsonb),
    'totals',jsonb_build_object(
      'views',COALESCE((SELECT sum(c.views) FROM public.social_smartlink_daily_counts c WHERE c.smartlink_id=v_link.id),0),
      'clicks',COALESCE((SELECT sum(c.clicks) FROM public.social_smartlink_daily_counts c WHERE c.smartlink_id=v_link.id),0)));
END $$;

CREATE OR REPLACE FUNCTION public.save_social_smartlink(
  p_auth_id TEXT,p_brand_id UUID,p_slug TEXT,p_title TEXT,p_bio TEXT,p_avatar_url TEXT,p_theme TEXT,p_published BOOLEAN,p_items JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_link UUID; v_item JSONB; v_position INTEGER:=0;
BEGIN
  v_user := public.social_inbox_paid_user(p_auth_id);
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','PLAN_REQUIRED'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_brands WHERE id=p_brand_id AND owner_user_id=v_user) THEN RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND'); END IF;
  p_slug := lower(btrim(COALESCE(p_slug,''))); p_title := btrim(COALESCE(p_title,''));
  IF p_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$' OR char_length(p_title) NOT BETWEEN 1 AND 80
    OR p_theme NOT IN ('midnight','light','sunset') OR (p_bio IS NOT NULL AND char_length(p_bio)>280)
    OR (p_avatar_url IS NOT NULL AND (p_avatar_url !~ '^https://' OR char_length(p_avatar_url)>1000))
    OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)>20 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUT'); END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(v_item)<>'object' OR char_length(btrim(COALESCE(v_item->>'label',''))) NOT BETWEEN 1 AND 60
      OR COALESCE(v_item->>'url','') !~ '^https://' OR char_length(COALESCE(v_item->>'url',''))>1000 THEN
      RETURN jsonb_build_object('ok',false,'code','INVALID_ITEM');
    END IF;
  END LOOP;
  INSERT INTO public.social_smartlinks(brand_id,slug,title,bio,avatar_url,theme,published)
  VALUES(p_brand_id,p_slug,p_title,NULLIF(btrim(p_bio),''),NULLIF(btrim(p_avatar_url),''),p_theme,COALESCE(p_published,false))
  ON CONFLICT(brand_id) DO UPDATE SET slug=EXCLUDED.slug,title=EXCLUDED.title,bio=EXCLUDED.bio,avatar_url=EXCLUDED.avatar_url,
    theme=EXCLUDED.theme,published=EXCLUDED.published,updated_at=now() RETURNING id INTO v_link;
  DELETE FROM public.social_smartlink_items WHERE smartlink_id=v_link;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.social_smartlink_items(smartlink_id,position,label,url,enabled)
    VALUES(v_link,v_position,btrim(v_item->>'label'),v_item->>'url',COALESCE((v_item->>'enabled')::BOOLEAN,true));
    v_position:=v_position+1;
  END LOOP;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id,detail)
  VALUES(v_user,p_brand_id,'save_smartlink',v_link,jsonb_build_object('published',COALESCE(p_published,false),'items',v_position));
  RETURN jsonb_build_object('ok',true,'smartlink_id',v_link);
EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'code','SLUG_TAKEN');
END $$;

CREATE OR REPLACE FUNCTION public.read_social_smartlink_public(p_slug TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_link public.social_smartlinks%ROWTYPE;
BEGIN
  SELECT * INTO v_link FROM public.social_smartlinks WHERE slug=lower(COALESCE(p_slug,'')) AND published;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok',true,'smartlink',jsonb_build_object('id',v_link.id,'slug',v_link.slug,'title',v_link.title,
    'bio',v_link.bio,'avatar_url',v_link.avatar_url,'theme',v_link.theme),
    'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'label',i.label) ORDER BY i.position)
      FROM public.social_smartlink_items i WHERE i.smartlink_id=v_link.id AND i.enabled),'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.record_social_smartlink_view(p_slug TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_link UUID;
BEGIN
  SELECT id INTO v_link FROM public.social_smartlinks WHERE slug=lower(COALESCE(p_slug,'')) AND published;
  IF v_link IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  INSERT INTO public.social_smartlink_daily_counts(smartlink_id,item_id,metric_date,views,clicks)
  VALUES(v_link,NULL,(now() AT TIME ZONE 'UTC')::DATE,1,0)
  ON CONFLICT(smartlink_id,metric_date) WHERE item_id IS NULL DO UPDATE SET views=public.social_smartlink_daily_counts.views+1;
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.record_social_smartlink_click(p_slug TEXT,p_item_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_link UUID; v_url TEXT;
BEGIN
  SELECT s.id,i.url INTO v_link,v_url FROM public.social_smartlinks s JOIN public.social_smartlink_items i ON i.smartlink_id=s.id
  WHERE s.slug=lower(COALESCE(p_slug,'')) AND s.published AND i.id=p_item_id AND i.enabled;
  IF v_link IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  INSERT INTO public.social_smartlink_daily_counts(smartlink_id,item_id,metric_date,views,clicks)
  VALUES(v_link,p_item_id,(now() AT TIME ZONE 'UTC')::DATE,0,1)
  ON CONFLICT(smartlink_id,item_id,metric_date) WHERE item_id IS NOT NULL DO UPDATE SET clicks=public.social_smartlink_daily_counts.clicks+1;
  RETURN jsonb_build_object('ok',true,'url',v_url);
END $$;

REVOKE ALL ON FUNCTION public.get_social_smartlink_editor(TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_social_smartlink(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.read_social_smartlink_public(TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_social_smartlink_view(TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_social_smartlink_click(TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_social_smartlink_editor(TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_social_smartlink(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_social_smartlink_public(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_social_smartlink_view(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_social_smartlink_click(TEXT,UUID) TO service_role;
