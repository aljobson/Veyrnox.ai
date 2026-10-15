-- 0302_social_content_presets.sql — paid, brand-owned caption/destination presets.
-- Presets contain no provider tokens or object keys. Browsers use service-only
-- RPCs and receive only the text and account ids they originally selected.

CREATE TABLE IF NOT EXISTS public.social_content_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.social_brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  caption TEXT NOT NULL CHECK (char_length(caption) BETWEEN 1 AND 4000),
  account_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS social_content_presets_brand_name_idx
  ON public.social_content_presets(brand_id, lower(name));
CREATE INDEX IF NOT EXISTS social_content_presets_brand_updated_idx
  ON public.social_content_presets(brand_id, updated_at DESC, id DESC);
ALTER TABLE public.social_content_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_content_presets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_content_presets FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_social_content_presets(p_auth_id TEXT, p_brand_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID;
BEGIN
  v_user := public.social_inbox_paid_user(p_auth_id);
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','PLAN_REQUIRED'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_brands WHERE id=p_brand_id AND owner_user_id=v_user) THEN
    RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND');
  END IF;
  RETURN jsonb_build_object('ok',true,'presets',COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'caption',p.caption,
      'account_ids',to_jsonb(p.account_ids),'updated_at',p.updated_at) ORDER BY p.updated_at DESC,p.id DESC)
    FROM public.social_content_presets p WHERE p.brand_id=p_brand_id
  ),'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.save_social_content_preset(
  p_auth_id TEXT,p_brand_id UUID,p_id UUID,p_name TEXT,p_caption TEXT,p_account_ids UUID[]
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_id UUID; v_count INTEGER;
BEGIN
  v_user := public.social_inbox_paid_user(p_auth_id);
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','PLAN_REQUIRED'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_brands WHERE id=p_brand_id AND owner_user_id=v_user) THEN
    RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND');
  END IF;
  p_name:=btrim(COALESCE(p_name,'')); p_caption:=COALESCE(p_caption,''); p_account_ids:=COALESCE(p_account_ids,'{}'::UUID[]);
  IF char_length(p_name) NOT BETWEEN 1 AND 80 OR char_length(p_caption) NOT BETWEEN 1 AND 4000
    OR cardinality(p_account_ids)>20 OR cardinality(p_account_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_account_ids) x)
    OR EXISTS(SELECT 1 FROM unnest(p_account_ids) x LEFT JOIN public.social_accounts a ON a.id=x AND a.brand_id=p_brand_id
      WHERE a.id IS NULL) THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUT'); END IF;
  IF p_id IS NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('social-content-preset:'||p_brand_id::TEXT,0));
    SELECT count(*) INTO v_count FROM public.social_content_presets WHERE brand_id=p_brand_id;
    IF v_count>=50 THEN RETURN jsonb_build_object('ok',false,'code','PRESET_LIMIT'); END IF;
    INSERT INTO public.social_content_presets(brand_id,name,caption,account_ids)
      VALUES(p_brand_id,p_name,p_caption,p_account_ids) RETURNING id INTO v_id;
  ELSE
    UPDATE public.social_content_presets SET name=p_name,caption=p_caption,account_ids=p_account_ids,updated_at=now()
      WHERE id=p_id AND brand_id=p_brand_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','PRESET_NOT_FOUND'); END IF;
  END IF;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id,detail)
    VALUES(v_user,p_brand_id,'save_content_preset',v_id,jsonb_build_object('account_count',cardinality(p_account_ids)));
  RETURN jsonb_build_object('ok',true,'preset_id',v_id);
EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'code','PRESET_NAME_TAKEN');
END $$;

CREATE OR REPLACE FUNCTION public.delete_social_content_preset(p_auth_id TEXT,p_brand_id UUID,p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_id UUID;
BEGIN
  v_user := public.social_inbox_paid_user(p_auth_id);
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','PLAN_REQUIRED'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_brands WHERE id=p_brand_id AND owner_user_id=v_user) THEN
    RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND');
  END IF;
  DELETE FROM public.social_content_presets WHERE id=p_id AND brand_id=p_brand_id RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','PRESET_NOT_FOUND'); END IF;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id)
    VALUES(v_user,p_brand_id,'delete_content_preset',v_id);
  RETURN jsonb_build_object('ok',true);
END $$;

REVOKE ALL ON FUNCTION public.list_social_content_presets(TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_social_content_preset(TEXT,UUID,UUID,TEXT,TEXT,UUID[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.delete_social_content_preset(TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_social_content_presets(TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_social_content_preset(TEXT,UUID,UUID,TEXT,TEXT,UUID[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_social_content_preset(TEXT,UUID,UUID) TO service_role;
