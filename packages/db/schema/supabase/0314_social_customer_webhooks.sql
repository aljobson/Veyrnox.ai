-- 0314: signed customer webhooks, retry outbox and delivery audit for Publish.
BEGIN;

CREATE TABLE IF NOT EXISTS public.social_webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.social_brands(id) ON DELETE CASCADE,
  created_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  url TEXT NOT NULL CHECK (url ~ '^https://' AND char_length(url)<=2048),
  secret_enc BYTEA NOT NULL,
  events TEXT[] NOT NULL CHECK (cardinality(events) BETWEEN 1 AND 3),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS social_webhook_endpoints_brand_idx ON public.social_webhook_endpoints(brand_id,created_at DESC);
ALTER TABLE public.social_webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_webhook_endpoints FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_webhook_endpoints FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.social_webhook_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id UUID NOT NULL REFERENCES public.social_webhook_endpoints(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES public.social_brands(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES public.social_post_targets(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('post.published','post.delivered','post.failed')),
  payload JSONB NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claim_key UUID NULL,
  claimed_at TIMESTAMPTZ NULL,
  delivered_at TIMESTAMPTZ NULL,
  failed_at TIMESTAMPTZ NULL,
  last_status INTEGER NULL CHECK (last_status IS NULL OR last_status BETWEEN 100 AND 599),
  last_error TEXT NULL CHECK (last_error IS NULL OR char_length(last_error)<=120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(endpoint_id,target_id,event_type),
  CHECK (NOT (delivered_at IS NOT NULL AND failed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS social_webhook_outbox_due_idx ON public.social_webhook_outbox(next_attempt_at,created_at)
  WHERE delivered_at IS NULL AND failed_at IS NULL;
CREATE INDEX IF NOT EXISTS social_webhook_outbox_brand_idx ON public.social_webhook_outbox(brand_id,created_at DESC);
ALTER TABLE public.social_webhook_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_webhook_outbox FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_webhook_outbox FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.social_webhook_deliveries (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.social_webhook_outbox(id) ON DELETE CASCADE,
  endpoint_id UUID NOT NULL REFERENCES public.social_webhook_endpoints(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 8),
  outcome TEXT NOT NULL CHECK (outcome IN ('delivered','retrying','failed')),
  response_status INTEGER NULL CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599),
  error_code TEXT NULL CHECK (error_code IS NULL OR char_length(error_code)<=120),
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(event_id,attempt)
);
CREATE INDEX IF NOT EXISTS social_webhook_deliveries_endpoint_idx ON public.social_webhook_deliveries(endpoint_id,attempted_at DESC,id DESC);
ALTER TABLE public.social_webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_webhook_deliveries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_webhook_deliveries FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.enqueue_social_webhook_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_event TEXT;v_brand UUID;v_post public.social_posts%ROWTYPE;v_endpoint RECORD;v_id UUID;
BEGIN
  IF NEW.publish_status IS NOT DISTINCT FROM OLD.publish_status OR NEW.publish_status NOT IN ('published','delivered','failed') THEN RETURN NEW; END IF;
  v_event:=CASE NEW.publish_status WHEN 'published' THEN 'post.published' WHEN 'delivered' THEN 'post.delivered' ELSE 'post.failed' END;
  SELECT * INTO v_post FROM public.social_posts WHERE id=NEW.post_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  v_brand:=v_post.brand_id;
  FOR v_endpoint IN SELECT e.id FROM public.social_webhook_endpoints e WHERE e.brand_id=v_brand AND e.active AND v_event=ANY(e.events) LOOP
    v_id:=gen_random_uuid();
    INSERT INTO public.social_webhook_outbox(id,endpoint_id,brand_id,target_id,event_type,payload)
    VALUES(v_id,v_endpoint.id,v_brand,NEW.id,v_event,jsonb_build_object(
      'id',v_id,'type',v_event,'created_at',clock_timestamp(),'brand_id',v_brand,'post_id',NEW.post_id,
      'target_id',NEW.id,'account_id',NEW.account_id,'network',NEW.network,'status',NEW.publish_status,
      'platform_post_id',NEW.platform_post_id,'platform_post_url',NEW.platform_post_url,
      'error_code',CASE WHEN NEW.publish_status='failed' THEN left(COALESCE(NEW.last_error,'unknown_error'),120) ELSE NULL END
    )) ON CONFLICT(endpoint_id,target_id,event_type) DO NOTHING;
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS social_post_target_webhook_event ON public.social_post_targets;
CREATE TRIGGER social_post_target_webhook_event AFTER UPDATE OF publish_status ON public.social_post_targets
FOR EACH ROW EXECUTE FUNCTION public.enqueue_social_webhook_event();

CREATE OR REPLACE FUNCTION public.list_social_webhook_endpoints(p_auth_id TEXT,p_brand_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  RETURN jsonb_build_object('ok',true,'endpoints',COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id',e.id,'label',e.label,'url',e.url,'events',e.events,'active',e.active,'created_at',e.created_at,'revoked_at',e.revoked_at
  ) ORDER BY e.created_at DESC,e.id DESC) FROM public.social_webhook_endpoints e WHERE e.brand_id=p_brand_id),'[]'::JSONB));
END $$;

CREATE OR REPLACE FUNCTION public.create_social_webhook_endpoint(p_auth_id TEXT,p_brand_id UUID,p_label TEXT,p_url TEXT,p_secret_enc TEXT,p_events TEXT[])
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_id UUID;v_count INTEGER;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;p_label:=btrim(COALESCE(p_label,''));p_url:=btrim(COALESCE(p_url,''));
  IF char_length(p_label) NOT BETWEEN 1 AND 80 OR char_length(p_url) NOT BETWEEN 9 AND 2048 OR p_url !~ '^https://'
    OR p_secret_enc IS NULL OR p_secret_enc !~ '^\\x[0-9a-f]{90,}$' OR p_events IS NULL OR cardinality(p_events) NOT BETWEEN 1 AND 3
    OR EXISTS(SELECT 1 FROM unnest(p_events) event WHERE event NOT IN ('post.published','post.delivered','post.failed'))
    OR cardinality(p_events) IS DISTINCT FROM (SELECT count(DISTINCT event) FROM unnest(p_events) event) THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_INPUT');
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('social-webhook:'||p_brand_id::TEXT,0));
  SELECT count(*) INTO v_count FROM public.social_webhook_endpoints WHERE brand_id=p_brand_id AND active;
  IF v_count>=10 THEN RETURN jsonb_build_object('ok',false,'code','WEBHOOK_LIMIT'); END IF;
  INSERT INTO public.social_webhook_endpoints(brand_id,created_by_user_id,label,url,secret_enc,events)
    VALUES(p_brand_id,v_actor,p_label,p_url,p_secret_enc::BYTEA,p_events) RETURNING id INTO v_id;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id,detail)
    VALUES(v_actor,p_brand_id,'create_webhook',v_id,jsonb_build_object('label',p_label,'url',p_url,'events',p_events));
  RETURN jsonb_build_object('ok',true,'endpoint_id',v_id);
END $$;

CREATE OR REPLACE FUNCTION public.revoke_social_webhook_endpoint(p_auth_id TEXT,p_brand_id UUID,p_endpoint_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_id UUID;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  UPDATE public.social_webhook_endpoints SET active=false,revoked_at=COALESCE(revoked_at,clock_timestamp())
    WHERE id=p_endpoint_id AND brand_id=p_brand_id RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','WEBHOOK_NOT_FOUND'); END IF;
  UPDATE public.social_webhook_outbox SET failed_at=clock_timestamp(),last_error='endpoint_revoked',claim_key=NULL,claimed_at=NULL
    WHERE endpoint_id=v_id AND delivered_at IS NULL AND failed_at IS NULL;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id) VALUES(v_actor,p_brand_id,'revoke_webhook',v_id);
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.list_social_webhook_deliveries(p_auth_id TEXT,p_brand_id UUID,p_limit INTEGER DEFAULT 50)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  RETURN jsonb_build_object('ok',true,'deliveries',COALESCE((SELECT jsonb_agg(row_to_json(q)::JSONB ORDER BY q.created_at DESC,q.id DESC) FROM (
    SELECT o.id,e.label endpoint_label,e.url,o.event_type,o.attempts,o.last_status,o.last_error,o.created_at,
      CASE WHEN o.delivered_at IS NOT NULL THEN 'delivered' WHEN o.failed_at IS NOT NULL THEN 'failed' ELSE 'pending' END outcome,
      o.delivered_at,o.failed_at
    FROM public.social_webhook_outbox o JOIN public.social_webhook_endpoints e ON e.id=o.endpoint_id
    WHERE o.brand_id=p_brand_id ORDER BY o.created_at DESC,o.id DESC LIMIT least(greatest(COALESCE(p_limit,50),1),100)
  ) q),'[]'::JSONB));
END $$;

CREATE OR REPLACE FUNCTION public.claim_social_webhook_deliveries(p_limit INTEGER DEFAULT 20)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_claim UUID:=gen_random_uuid();v_events JSONB;
BEGIN
  WITH due AS (
    SELECT o.id FROM public.social_webhook_outbox o JOIN public.social_webhook_endpoints e ON e.id=o.endpoint_id
    WHERE e.active AND o.delivered_at IS NULL AND o.failed_at IS NULL AND o.next_attempt_at<=clock_timestamp()
      AND (o.claimed_at IS NULL OR o.claimed_at<clock_timestamp()-interval '2 minutes')
    ORDER BY o.next_attempt_at,o.created_at FOR UPDATE OF o SKIP LOCKED LIMIT least(greatest(COALESCE(p_limit,20),1),50)
  ),claimed AS (
    UPDATE public.social_webhook_outbox o SET claim_key=v_claim,claimed_at=clock_timestamp(),attempts=o.attempts+1
    FROM due WHERE o.id=due.id RETURNING o.*
  ) SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'claim_key',c.claim_key,'endpoint_id',c.endpoint_id,
      'event_type',c.event_type,'payload',c.payload,'attempt',c.attempts,'url',e.url,'secret_enc',encode(e.secret_enc,'hex'))),'[]'::JSONB)
    INTO v_events FROM claimed c JOIN public.social_webhook_endpoints e ON e.id=c.endpoint_id;
  RETURN jsonb_build_object('ok',true,'events',v_events);
END $$;

CREATE OR REPLACE FUNCTION public.complete_social_webhook_delivery(p_event_id UUID,p_claim_key UUID,p_success BOOLEAN,p_status INTEGER,p_error TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_event public.social_webhook_outbox%ROWTYPE;v_outcome TEXT;
BEGIN
  SELECT * INTO v_event FROM public.social_webhook_outbox WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','EVENT_NOT_FOUND'); END IF;
  IF v_event.claim_key IS DISTINCT FROM p_claim_key THEN RETURN jsonb_build_object('ok',false,'code','CLAIM_LOST'); END IF;
  p_error:=left(NULLIF(COALESCE(p_error,''),''),120);
  IF p_status IS NOT NULL AND (p_status<100 OR p_status>599) THEN p_status:=NULL; END IF;
  IF p_success THEN
    v_outcome:='delivered';UPDATE public.social_webhook_outbox SET delivered_at=clock_timestamp(),last_status=p_status,last_error=NULL,claim_key=NULL,claimed_at=NULL WHERE id=p_event_id;
  ELSIF v_event.attempts>=8 THEN
    v_outcome:='failed';UPDATE public.social_webhook_outbox SET failed_at=clock_timestamp(),last_status=p_status,last_error=COALESCE(p_error,'delivery_failed'),claim_key=NULL,claimed_at=NULL WHERE id=p_event_id;
  ELSE
    v_outcome:='retrying';UPDATE public.social_webhook_outbox SET next_attempt_at=clock_timestamp()+make_interval(mins=>least(5*(1 << greatest(v_event.attempts-1,0)),360)),last_status=p_status,last_error=COALESCE(p_error,'delivery_failed'),claim_key=NULL,claimed_at=NULL WHERE id=p_event_id;
  END IF;
  INSERT INTO public.social_webhook_deliveries(event_id,endpoint_id,attempt,outcome,response_status,error_code)
    VALUES(p_event_id,v_event.endpoint_id,v_event.attempts,v_outcome,p_status,p_error) ON CONFLICT(event_id,attempt) DO NOTHING;
  RETURN jsonb_build_object('ok',true,'outcome',v_outcome);
END $$;

REVOKE ALL ON FUNCTION public.enqueue_social_webhook_event() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.list_social_webhook_endpoints(TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_social_webhook_endpoint(TEXT,UUID,TEXT,TEXT,TEXT,TEXT[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.revoke_social_webhook_endpoint(TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.list_social_webhook_deliveries(TEXT,UUID,INTEGER) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_social_webhook_deliveries(INTEGER) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_social_webhook_delivery(UUID,UUID,BOOLEAN,INTEGER,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_social_webhook_endpoints(TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_social_webhook_endpoint(TEXT,UUID,TEXT,TEXT,TEXT,TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_social_webhook_endpoint(TEXT,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_social_webhook_deliveries(TEXT,UUID,INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_social_webhook_deliveries(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_social_webhook_delivery(UUID,UUID,BOOLEAN,INTEGER,TEXT) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
