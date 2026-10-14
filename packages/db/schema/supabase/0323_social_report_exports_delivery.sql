-- 0323: branded document exports and opt-in scheduled email delivery.
BEGIN;

ALTER TABLE public.social_report_templates ADD COLUMN IF NOT EXISTS delivery_recipients TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.social_report_templates ADD COLUMN IF NOT EXISTS delivery_reply_to TEXT NULL;
ALTER TABLE public.social_report_templates ADD COLUMN IF NOT EXISTS delivery_message TEXT NULL;
ALTER TABLE public.social_report_templates ADD COLUMN IF NOT EXISTS delivery_format TEXT NOT NULL DEFAULT 'pdf'
  CHECK (delivery_format IN ('pdf','pptx'));
ALTER TABLE public.social_report_templates DROP CONSTRAINT IF EXISTS social_report_templates_delivery_recipients_check;
ALTER TABLE public.social_report_templates ADD CONSTRAINT social_report_templates_delivery_recipients_check CHECK (
  cardinality(delivery_recipients)<=10 AND array_position(delivery_recipients,NULL) IS NULL
);

CREATE OR REPLACE FUNCTION public.save_social_report_template_v3(
  p_auth_id TEXT,p_brand_id UUID,p_id UUID,p_name TEXT,p_account_id UUID,p_range_days INTEGER,
  p_compare_previous BOOLEAN,p_include_content BOOLEAN,p_report_title TEXT,p_accent_color TEXT,
  p_delivery_cadence TEXT,p_delivery_hour_utc INTEGER,p_delivery_weekday INTEGER,p_delivery_day INTEGER,
  p_delivery_recipients TEXT[],p_delivery_reply_to TEXT,p_delivery_message TEXT,p_delivery_format TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_saved JSONB;v_id UUID;v_recipient TEXT;v_clean TEXT[]:='{}';
BEGIN
  p_delivery_format:=lower(COALESCE(p_delivery_format,'pdf'));
  IF p_delivery_format NOT IN ('pdf','pptx') OR cardinality(COALESCE(p_delivery_recipients,'{}'))>10
    OR length(COALESCE(p_delivery_message,''))>1000 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_DELIVERY'); END IF;
  FOREACH v_recipient IN ARRAY COALESCE(p_delivery_recipients,'{}') LOOP
    v_recipient:=lower(btrim(v_recipient));
    IF v_recipient !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' OR length(v_recipient)>254 THEN
      RETURN jsonb_build_object('ok',false,'code','INVALID_DELIVERY');
    END IF;
    IF NOT v_recipient=ANY(v_clean) THEN v_clean:=array_append(v_clean,v_recipient); END IF;
  END LOOP;
  p_delivery_reply_to:=NULLIF(lower(btrim(COALESCE(p_delivery_reply_to,''))), '');
  IF p_delivery_reply_to IS NOT NULL AND (p_delivery_reply_to !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' OR length(p_delivery_reply_to)>254) THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_DELIVERY');
  END IF;
  IF COALESCE(p_delivery_cadence,'manual')<>'manual' AND cardinality(v_clean)=0 THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_DELIVERY');
  END IF;
  v_saved:=public.save_social_report_template_v2(p_auth_id,p_brand_id,p_id,p_name,p_account_id,p_range_days,
    p_compare_previous,p_include_content,p_report_title,p_accent_color,p_delivery_cadence,p_delivery_hour_utc,p_delivery_weekday,p_delivery_day);
  IF NOT coalesce((v_saved->>'ok')::BOOLEAN,false) THEN RETURN v_saved; END IF;
  v_id:=(v_saved->>'template_id')::UUID;
  UPDATE public.social_report_templates SET delivery_recipients=v_clean,delivery_reply_to=p_delivery_reply_to,
    delivery_message=NULLIF(btrim(COALESCE(p_delivery_message,'')),''),delivery_format=p_delivery_format,updated_at=clock_timestamp()
    WHERE id=v_id AND brand_id=p_brand_id;
  RETURN v_saved;
END $$;

CREATE OR REPLACE FUNCTION public.list_social_report_templates(p_auth_id TEXT,p_brand_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor','reviewer','analyst','viewer'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  RETURN jsonb_build_object('ok',true,'templates',COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'account_id',r.account_id,'range_days',r.range_days,
      'compare_previous',r.compare_previous,'include_content',r.include_content,'report_title',r.report_title,
      'accent_color',r.accent_color,'delivery_cadence',r.delivery_cadence,'delivery_hour_utc',r.delivery_hour_utc,
      'delivery_weekday',r.delivery_weekday,'delivery_day',r.delivery_day,'delivery_recipients',r.delivery_recipients,
      'delivery_reply_to',r.delivery_reply_to,'delivery_message',r.delivery_message,'delivery_format',r.delivery_format,
      'next_delivery_at',r.next_delivery_at,'last_delivery_at',r.last_delivery_at,'last_delivery_status',r.last_delivery_status,
      'last_delivery_error',r.last_delivery_error,'updated_at',r.updated_at) ORDER BY r.updated_at DESC,r.id DESC)
    FROM public.social_report_templates r WHERE r.brand_id=p_brand_id
  ),'[]'::JSONB));
END $$;

CREATE OR REPLACE FUNCTION public.claim_social_report_deliveries(p_limit INTEGER DEFAULT 10)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_reports JSONB;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 25 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_LIMIT'); END IF;
  UPDATE public.social_report_templates SET last_delivery_status='failed',last_delivery_error='claim_timeout',
    delivery_claimed_at=NULL,delivery_claim_key=NULL,next_delivery_at=now()
    WHERE last_delivery_status='sending' AND delivery_claimed_at<now()-interval '10 minutes';
  WITH due AS (
    SELECT r.id FROM public.social_report_templates r JOIN public.social_brands b ON b.id=r.brand_id
    WHERE r.delivery_cadence<>'manual' AND cardinality(r.delivery_recipients)>0 AND r.next_delivery_at<=now()
      AND coalesce(r.last_delivery_status,'failed')<>'sending'
      AND EXISTS(SELECT 1 FROM public.social_publish_subscriptions s WHERE s.user_id=b.owner_user_id AND s.plan_id='publish'
        AND s.status='active' AND s.current_period_end>now())
    ORDER BY r.next_delivery_at,r.id FOR UPDATE OF r SKIP LOCKED LIMIT p_limit
  ),claimed AS (
    UPDATE public.social_report_templates r SET delivery_scheduled_for=coalesce(r.delivery_scheduled_for,r.next_delivery_at),
      delivery_attempts=CASE WHEN r.delivery_scheduled_for IS NULL THEN 1 ELSE r.delivery_attempts+1 END,
      delivery_claimed_at=clock_timestamp(),delivery_claim_key=gen_random_uuid(),last_delivery_status='sending',last_delivery_error=NULL
    FROM due WHERE r.id=due.id RETURNING r.*
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'claim_key',c.delivery_claim_key,
      'scheduled_for',c.delivery_scheduled_for,'brand_id',c.brand_id,'name',c.name,'account_id',c.account_id,
      'range_days',c.range_days,'compare_previous',c.compare_previous,'include_content',c.include_content,
      'report_title',c.report_title,'accent_color',c.accent_color,'delivery_recipients',c.delivery_recipients,
      'delivery_reply_to',c.delivery_reply_to,'delivery_message',c.delivery_message,'delivery_format',c.delivery_format,
      'owner_auth_id',(SELECT u.auth_id FROM public.social_brands b JOIN public.users u ON u.id=b.owner_user_id WHERE b.id=c.brand_id)
    )),'[]'::JSONB) INTO v_reports FROM claimed c;
  RETURN jsonb_build_object('ok',true,'reports',v_reports);
END $$;

REVOKE ALL ON FUNCTION public.save_social_report_template_v3(TEXT,UUID,UUID,TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN,TEXT,TEXT,TEXT,INTEGER,INTEGER,INTEGER,TEXT[],TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_social_report_template_v3(TEXT,UUID,UUID,TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN,TEXT,TEXT,TEXT,INTEGER,INTEGER,INTEGER,TEXT[],TEXT,TEXT,TEXT) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
