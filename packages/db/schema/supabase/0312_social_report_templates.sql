-- 0312: reusable, branded analytics report templates.
BEGIN;

CREATE TABLE IF NOT EXISTS public.social_report_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.social_brands(id) ON DELETE CASCADE,
  created_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  account_id UUID NULL REFERENCES public.social_accounts(id) ON DELETE SET NULL,
  range_days INTEGER NOT NULL CHECK (range_days IN (7,30,90,365)),
  compare_previous BOOLEAN NOT NULL DEFAULT false,
  include_content BOOLEAN NOT NULL DEFAULT true,
  report_title TEXT NULL CHECK (report_title IS NULL OR char_length(report_title) BETWEEN 1 AND 100),
  accent_color TEXT NOT NULL DEFAULT '#38bdf8' CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS social_report_templates_brand_name_idx ON public.social_report_templates(brand_id,lower(name));
CREATE INDEX IF NOT EXISTS social_report_templates_brand_updated_idx ON public.social_report_templates(brand_id,updated_at DESC,id DESC);
ALTER TABLE public.social_report_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_report_templates FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_report_templates FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.list_social_report_templates(p_auth_id TEXT,p_brand_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor','reviewer','analyst','viewer'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  RETURN jsonb_build_object('ok',true,'templates',COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'account_id',r.account_id,'range_days',r.range_days,
      'compare_previous',r.compare_previous,'include_content',r.include_content,'report_title',r.report_title,
      'accent_color',r.accent_color,'updated_at',r.updated_at) ORDER BY r.updated_at DESC,r.id DESC)
    FROM public.social_report_templates r WHERE r.brand_id=p_brand_id
  ),'[]'::JSONB));
END $$;

CREATE OR REPLACE FUNCTION public.save_social_report_template(
  p_auth_id TEXT,p_brand_id UUID,p_id UUID,p_name TEXT,p_account_id UUID,p_range_days INTEGER,
  p_compare_previous BOOLEAN,p_include_content BOOLEAN,p_report_title TEXT,p_accent_color TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_id UUID;v_count INTEGER;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor','analyst'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  p_name:=btrim(COALESCE(p_name,''));p_report_title:=NULLIF(btrim(COALESCE(p_report_title,'')),'');
  p_accent_color:=lower(COALESCE(p_accent_color,''));
  IF char_length(p_name) NOT BETWEEN 1 AND 80 OR p_range_days IS NULL OR p_range_days NOT IN (7,30,90,365)
    OR p_compare_previous IS NULL OR p_include_content IS NULL
    OR (p_report_title IS NOT NULL AND char_length(p_report_title) NOT BETWEEN 1 AND 100)
    OR p_accent_color !~ '^#[0-9a-f]{6}$'
    OR (p_account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.social_accounts a WHERE a.id=p_account_id AND a.brand_id=p_brand_id)) THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_INPUT');
  END IF;
  IF p_id IS NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('social-report-template:'||p_brand_id::TEXT,0));
    SELECT count(*) INTO v_count FROM public.social_report_templates WHERE brand_id=p_brand_id;
    IF v_count>=50 THEN RETURN jsonb_build_object('ok',false,'code','REPORT_LIMIT'); END IF;
    INSERT INTO public.social_report_templates(brand_id,created_by_user_id,name,account_id,range_days,compare_previous,include_content,report_title,accent_color)
      VALUES(p_brand_id,v_actor,p_name,p_account_id,p_range_days,p_compare_previous,p_include_content,p_report_title,p_accent_color) RETURNING id INTO v_id;
  ELSE
    UPDATE public.social_report_templates SET name=p_name,account_id=p_account_id,range_days=p_range_days,
      compare_previous=p_compare_previous,include_content=p_include_content,report_title=p_report_title,
      accent_color=p_accent_color,updated_at=clock_timestamp()
      WHERE id=p_id AND brand_id=p_brand_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','REPORT_NOT_FOUND'); END IF;
  END IF;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id,detail)
    VALUES(v_actor,p_brand_id,'save_report_template',v_id,jsonb_build_object('range_days',p_range_days,'account_id',p_account_id));
  RETURN jsonb_build_object('ok',true,'template_id',v_id);
EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'code','REPORT_NAME_TAKEN');
END $$;

CREATE OR REPLACE FUNCTION public.delete_social_report_template(p_auth_id TEXT,p_brand_id UUID,p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_id UUID;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor','analyst'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  DELETE FROM public.social_report_templates WHERE id=p_id AND brand_id=p_brand_id RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','REPORT_NOT_FOUND'); END IF;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id) VALUES(v_actor,p_brand_id,'delete_report_template',v_id);
  RETURN jsonb_build_object('ok',true);
END $$;

REVOKE ALL ON FUNCTION public.list_social_report_templates(TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_social_report_template(TEXT,UUID,UUID,TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.delete_social_report_template(TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_social_report_templates(TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_social_report_template(TEXT,UUID,UUID,TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_social_report_template(TEXT,UUID,UUID) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
