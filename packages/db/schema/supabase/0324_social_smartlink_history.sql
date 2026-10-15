-- Preserve destination identity and historical clicks across SmartLink edits.
BEGIN;
ALTER TABLE public.social_smartlink_items DROP CONSTRAINT social_smartlink_items_smartlink_id_position_key;
ALTER TABLE public.social_smartlink_items ADD CONSTRAINT social_smartlink_items_smartlink_id_position_key
  UNIQUE(smartlink_id,position) DEFERRABLE INITIALLY IMMEDIATE;

CREATE OR REPLACE FUNCTION public.save_social_smartlink(
  p_auth_id TEXT,p_brand_id UUID,p_slug TEXT,p_title TEXT,p_bio TEXT,p_avatar_url TEXT,p_theme TEXT,p_published BOOLEAN,p_items JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_link UUID;v_item JSONB;v_position INTEGER:=0;v_item_id UUID;v_kept UUID[]:=ARRAY[]::UUID[];v_existing UUID;v_reserved UUID[];
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
  -- Serialize saves, including first creation, and validate IDs before writing.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('social-smartlink:'||p_brand_id::TEXT,0));
  SELECT id INTO v_existing FROM public.social_smartlinks WHERE brand_id=p_brand_id FOR UPDATE;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF v_item->>'id' IS NOT NULL THEN
      IF v_item->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_ITEM');
      END IF;
      v_item_id:=(v_item->>'id')::UUID;
      IF v_item_id=ANY(v_kept) OR NOT EXISTS(SELECT 1 FROM public.social_smartlink_items WHERE id=v_item_id AND smartlink_id=v_existing) THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_ITEM');
      END IF;
      v_kept:=array_append(v_kept,v_item_id);
    END IF;
  END LOOP;
  v_reserved:=v_kept;v_kept:=ARRAY[]::UUID[];
  INSERT INTO public.social_smartlinks(brand_id,slug,title,bio,avatar_url,theme,published)
  VALUES(p_brand_id,p_slug,p_title,NULLIF(btrim(p_bio),''),NULLIF(btrim(p_avatar_url),''),p_theme,COALESCE(p_published,false))
  ON CONFLICT(brand_id) DO UPDATE SET slug=EXCLUDED.slug,title=EXCLUDED.title,bio=EXCLUDED.bio,avatar_url=EXCLUDED.avatar_url,
    theme=EXCLUDED.theme,published=EXCLUDED.published,updated_at=now() RETURNING id INTO v_link;
  SET CONSTRAINTS public.social_smartlink_items_smartlink_id_position_key DEFERRED;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_item_id:=NULL;
    IF v_item->>'id' IS NOT NULL THEN v_item_id:=(v_item->>'id')::UUID;
    ELSE
      -- Older clients have no IDs; preserve an exact destination match once.
      SELECT id INTO v_item_id FROM public.social_smartlink_items
        WHERE smartlink_id=v_link AND url=v_item->>'url' AND label=btrim(v_item->>'label')
          AND NOT id=ANY(v_kept) AND NOT id=ANY(v_reserved) ORDER BY position LIMIT 1;
    END IF;
    IF v_item_id IS NULL THEN
      INSERT INTO public.social_smartlink_items(smartlink_id,position,label,url,enabled)
        VALUES(v_link,v_position,btrim(v_item->>'label'),v_item->>'url',COALESCE((v_item->>'enabled')::BOOLEAN,true)) RETURNING id INTO v_item_id;
    ELSE
      UPDATE public.social_smartlink_items SET position=v_position,label=btrim(v_item->>'label'),url=v_item->>'url',enabled=COALESCE((v_item->>'enabled')::BOOLEAN,true)
        WHERE id=v_item_id AND smartlink_id=v_link;
    END IF;
    v_kept:=array_append(v_kept,v_item_id);v_position:=v_position+1;
  END LOOP;
  -- Removed destinations stop resolving, but their historic clicks remain in
  -- the page total. Merge before the cascading item deletion.
  INSERT INTO public.social_smartlink_daily_counts(smartlink_id,item_id,metric_date,views,clicks)
    SELECT v_link,NULL,c.metric_date,0,sum(c.clicks) FROM public.social_smartlink_daily_counts c
      JOIN public.social_smartlink_items i ON i.id=c.item_id
      WHERE i.smartlink_id=v_link AND NOT i.id=ANY(v_kept) GROUP BY c.metric_date
    ON CONFLICT(smartlink_id,metric_date) WHERE item_id IS NULL
      DO UPDATE SET clicks=public.social_smartlink_daily_counts.clicks+EXCLUDED.clicks;
  DELETE FROM public.social_smartlink_items WHERE smartlink_id=v_link AND NOT id=ANY(v_kept);
  SET CONSTRAINTS public.social_smartlink_items_smartlink_id_position_key IMMEDIATE;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id,detail)
    VALUES(v_actor,p_brand_id,'save_smartlink',v_link,jsonb_build_object('published',COALESCE(p_published,false),'items',v_position));
  RETURN jsonb_build_object('ok',true,'smartlink_id',v_link);
EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'code','SLUG_TAKEN');
END $$;

-- Serialize click increments with editor saves so removal cannot lose an in-flight click.
CREATE OR REPLACE FUNCTION public.record_social_smartlink_click(p_slug TEXT,p_item_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_link UUID; v_url TEXT;
BEGIN
  SELECT s.id INTO v_link FROM public.social_smartlinks s
    WHERE s.slug=lower(COALESCE(p_slug,'')) AND s.published FOR UPDATE;
  SELECT i.url INTO v_url FROM public.social_smartlink_items i
    WHERE i.smartlink_id=v_link AND i.id=p_item_id AND i.enabled;
  IF v_url IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  INSERT INTO public.social_smartlink_daily_counts(smartlink_id,item_id,metric_date,views,clicks)
  VALUES(v_link,p_item_id,(now() AT TIME ZONE 'UTC')::DATE,0,1)
  ON CONFLICT(smartlink_id,item_id,metric_date) WHERE item_id IS NOT NULL DO UPDATE SET clicks=public.social_smartlink_daily_counts.clicks+1;
  RETURN jsonb_build_object('ok',true,'url',v_url);
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
