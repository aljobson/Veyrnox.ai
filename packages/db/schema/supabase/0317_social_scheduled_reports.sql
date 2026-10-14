-- 0317: scheduled delivery for paid analytics report templates.
BEGIN;

ALTER TABLE public.social_report_templates ADD COLUMN IF NOT EXISTS delivery_cadence TEXT NOT NULL DEFAULT 'manual'
  CHECK (delivery_cadence IN ('manual','weekly','monthly'));
ALTER TABLE public.social_report_templates ADD COLUMN IF NOT EXISTS delivery_hour_utc INTEGER NULL
  CHECK (delivery_hour_utc IS NULL OR delivery_hour_utc BETWEEN 0 AND 23);
ALTER TABLE public.social_report_templates ADD COLUMN IF NOT EXISTS delivery_weekday INTEGER NULL
  CHECK (delivery_weekday IS NULL OR delivery_weekday BETWEEN 1 AND 7);
ALTER TABLE public.social_report_templates ADD COLUMN IF NOT EXISTS delivery_day INTEGER NULL
  CHECK (delivery_day IS NULL OR delivery_day BETWEEN 1 AND 28);
ALTER TABLE public.social_report_templates ADD COLUMN IF NOT EXISTS next_delivery_at TIMESTAMPTZ NULL;
ALTER TABLE public.social_report_templates ADD COLUMN IF NOT EXISTS delivery_scheduled_for TIMESTAMPTZ NULL;
ALTER TABLE public.social_report_templates ADD COLUMN IF NOT EXISTS delivery_attempts INTEGER NOT NULL DEFAULT 0 CHECK (delivery_attempts BETWEEN 0 AND 3);
ALTER TABLE public.social_report_templates ADD COLUMN IF NOT EXISTS delivery_claimed_at TIMESTAMPTZ NULL;
ALTER TABLE public.social_report_templates ADD COLUMN IF NOT EXISTS delivery_claim_key UUID NULL;
ALTER TABLE public.social_report_templates ADD COLUMN IF NOT EXISTS last_delivery_at TIMESTAMPTZ NULL;
ALTER TABLE public.social_report_templates ADD COLUMN IF NOT EXISTS last_delivery_status TEXT NULL CHECK (last_delivery_status IS NULL OR last_delivery_status IN ('sending','ready','failed'));
ALTER TABLE public.social_report_templates ADD COLUMN IF NOT EXISTS last_delivery_error TEXT NULL CHECK (last_delivery_error IS NULL OR last_delivery_error ~ '^[a-z0-9_]{1,64}$');
CREATE INDEX IF NOT EXISTS social_report_templates_delivery_idx ON public.social_report_templates(next_delivery_at,id)
  WHERE delivery_cadence<>'manual' AND next_delivery_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.next_social_report_delivery(
  p_cadence TEXT,p_weekday INTEGER,p_day INTEGER,p_hour INTEGER,p_after TIMESTAMPTZ
) RETURNS TIMESTAMPTZ LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE v_date DATE;v_candidate TIMESTAMP;
BEGIN
  IF p_cadence='weekly' THEN
    v_date:=(p_after AT TIME ZONE 'UTC')::DATE + ((p_weekday-extract(isodow FROM p_after AT TIME ZONE 'UTC')::INTEGER+7)%7);
    v_candidate:=v_date+p_hour*interval '1 hour';
    IF v_candidate<=p_after AT TIME ZONE 'UTC' THEN v_candidate:=v_candidate+interval '7 days'; END IF;
  ELSIF p_cadence='monthly' THEN
    v_date:=(date_trunc('month',p_after AT TIME ZONE 'UTC')::DATE+p_day-1);
    v_candidate:=v_date+p_hour*interval '1 hour';
    IF v_candidate<=p_after AT TIME ZONE 'UTC' THEN
      v_date:=(date_trunc('month',p_after AT TIME ZONE 'UTC')+interval '1 month')::DATE+p_day-1;
      v_candidate:=v_date+p_hour*interval '1 hour';
    END IF;
  ELSE RETURN NULL;
  END IF;
  RETURN v_candidate AT TIME ZONE 'UTC';
END $$;

CREATE OR REPLACE FUNCTION public.save_social_report_template_v2(
  p_auth_id TEXT,p_brand_id UUID,p_id UUID,p_name TEXT,p_account_id UUID,p_range_days INTEGER,
  p_compare_previous BOOLEAN,p_include_content BOOLEAN,p_report_title TEXT,p_accent_color TEXT,
  p_delivery_cadence TEXT,p_delivery_hour_utc INTEGER,p_delivery_weekday INTEGER,p_delivery_day INTEGER
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_saved JSONB;v_id UUID;v_next TIMESTAMPTZ;
BEGIN
  p_delivery_cadence:=lower(COALESCE(p_delivery_cadence,'manual'));
  IF p_delivery_cadence NOT IN ('manual','weekly','monthly')
    OR (p_delivery_cadence<>'manual' AND (p_delivery_hour_utc IS NULL OR p_delivery_hour_utc NOT BETWEEN 0 AND 23))
    OR (p_delivery_cadence='weekly' AND (p_delivery_weekday IS NULL OR p_delivery_weekday NOT BETWEEN 1 AND 7))
    OR (p_delivery_cadence='monthly' AND (p_delivery_day IS NULL OR p_delivery_day NOT BETWEEN 1 AND 28)) THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_SCHEDULE');
  END IF;
  v_saved:=public.save_social_report_template(p_auth_id,p_brand_id,p_id,p_name,p_account_id,p_range_days,
    p_compare_previous,p_include_content,p_report_title,p_accent_color);
  IF NOT coalesce((v_saved->>'ok')::BOOLEAN,false) THEN RETURN v_saved; END IF;
  v_id:=(v_saved->>'template_id')::UUID;
  v_next:=public.next_social_report_delivery(p_delivery_cadence,p_delivery_weekday,p_delivery_day,p_delivery_hour_utc,now());
  UPDATE public.social_report_templates SET delivery_cadence=p_delivery_cadence,
    delivery_hour_utc=CASE WHEN p_delivery_cadence='manual' THEN NULL ELSE p_delivery_hour_utc END,
    delivery_weekday=CASE WHEN p_delivery_cadence='weekly' THEN p_delivery_weekday ELSE NULL END,
    delivery_day=CASE WHEN p_delivery_cadence='monthly' THEN p_delivery_day ELSE NULL END,
    next_delivery_at=v_next,delivery_scheduled_for=NULL,delivery_attempts=0,delivery_claimed_at=NULL,delivery_claim_key=NULL,
    last_delivery_error=NULL,updated_at=clock_timestamp() WHERE id=v_id AND brand_id=p_brand_id;
  RETURN jsonb_build_object('ok',true,'template_id',v_id,'next_delivery_at',v_next);
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
      'accent_color',r.accent_color,'delivery_cadence',r.delivery_cadence,
      'delivery_hour_utc',r.delivery_hour_utc,'delivery_weekday',r.delivery_weekday,'delivery_day',r.delivery_day,
      'next_delivery_at',r.next_delivery_at,'last_delivery_at',r.last_delivery_at,'last_delivery_status',r.last_delivery_status,
      'updated_at',r.updated_at) ORDER BY r.updated_at DESC,r.id DESC)
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
    WHERE r.delivery_cadence<>'manual' AND r.next_delivery_at<=now() AND coalesce(r.last_delivery_status,'failed')<>'sending'
      AND EXISTS(SELECT 1 FROM public.social_publish_subscriptions s WHERE s.user_id=b.owner_user_id AND s.plan_id='publish'
        AND s.status='active' AND s.current_period_end>now())
    ORDER BY r.next_delivery_at,r.id FOR UPDATE OF r SKIP LOCKED LIMIT p_limit
  ),claimed AS (
    UPDATE public.social_report_templates r SET delivery_scheduled_for=coalesce(r.delivery_scheduled_for,r.next_delivery_at),
      delivery_attempts=CASE WHEN r.delivery_scheduled_for IS NULL THEN 1 ELSE r.delivery_attempts+1 END,
      delivery_claimed_at=clock_timestamp(),delivery_claim_key=gen_random_uuid(),last_delivery_status='sending',last_delivery_error=NULL
    FROM due WHERE r.id=due.id RETURNING r.*
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'claim_key',c.delivery_claim_key,'scheduled_for',c.delivery_scheduled_for)),'[]'::JSONB)
    INTO v_reports FROM claimed c;
  RETURN jsonb_build_object('ok',true,'reports',v_reports);
END $$;

CREATE OR REPLACE FUNCTION public.complete_social_report_delivery(
  p_id UUID,p_claim_key UUID,p_success BOOLEAN,p_provider_id TEXT,p_error TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row public.social_report_templates%ROWTYPE;v_next TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_row FROM public.social_report_templates WHERE id=p_id AND delivery_claim_key=p_claim_key
    AND last_delivery_status='sending' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','DELIVERY_NOT_FOUND'); END IF;
  IF p_success THEN
    v_next:=public.next_social_report_delivery(v_row.delivery_cadence,v_row.delivery_weekday,v_row.delivery_day,v_row.delivery_hour_utc,v_row.delivery_scheduled_for+interval '1 second');
    UPDATE public.social_report_templates SET next_delivery_at=v_next,delivery_scheduled_for=NULL,delivery_attempts=0,
      delivery_claimed_at=NULL,delivery_claim_key=NULL,last_delivery_at=clock_timestamp(),last_delivery_status='ready',last_delivery_error=NULL WHERE id=p_id;
  ELSIF v_row.delivery_attempts<3 THEN
    UPDATE public.social_report_templates SET next_delivery_at=now()+make_interval(mins=>(5*power(2,v_row.delivery_attempts-1))::INTEGER),
      delivery_claimed_at=NULL,delivery_claim_key=NULL,last_delivery_at=clock_timestamp(),last_delivery_status='failed',
      last_delivery_error=CASE WHEN COALESCE(p_error,'')~'^[a-z0-9_]{1,64}$' THEN p_error ELSE 'delivery_failed' END WHERE id=p_id;
  ELSE
    v_next:=public.next_social_report_delivery(v_row.delivery_cadence,v_row.delivery_weekday,v_row.delivery_day,v_row.delivery_hour_utc,v_row.delivery_scheduled_for+interval '1 second');
    UPDATE public.social_report_templates SET next_delivery_at=v_next,delivery_scheduled_for=NULL,delivery_attempts=0,
      delivery_claimed_at=NULL,delivery_claim_key=NULL,last_delivery_at=clock_timestamp(),last_delivery_status='failed',
      last_delivery_error=CASE WHEN COALESCE(p_error,'')~'^[a-z0-9_]{1,64}$' THEN p_error ELSE 'delivery_failed' END WHERE id=p_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'next_delivery_at',v_next,'provider_id',NULLIF(p_provider_id,''));
END $$;

REVOKE ALL ON FUNCTION public.next_social_report_delivery(TEXT,INTEGER,INTEGER,INTEGER,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_social_report_template_v2(TEXT,UUID,UUID,TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN,TEXT,TEXT,TEXT,INTEGER,INTEGER,INTEGER) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_social_report_deliveries(INTEGER) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_social_report_delivery(UUID,UUID,BOOLEAN,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_social_report_template_v2(TEXT,UUID,UUID,TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN,TEXT,TEXT,TEXT,INTEGER,INTEGER,INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_social_report_deliveries(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_social_report_delivery(UUID,UUID,BOOLEAN,TEXT,TEXT) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
