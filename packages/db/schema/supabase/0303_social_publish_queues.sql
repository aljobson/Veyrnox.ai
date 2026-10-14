-- 0303_social_publish_queues.sql — paid weekly posting queues.
-- A short-lived reservation makes concurrent queue submissions choose distinct
-- slots; it contains no provider credentials or media references.

CREATE TABLE IF NOT EXISTS public.social_publish_queues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.social_brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  timezone TEXT NOT NULL CHECK (char_length(timezone) BETWEEN 1 AND 64),
  account_ids UUID[] NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS social_publish_queues_brand_name_idx ON public.social_publish_queues(brand_id,lower(name));
CREATE INDEX IF NOT EXISTS social_publish_queues_brand_idx ON public.social_publish_queues(brand_id,updated_at DESC);
ALTER TABLE public.social_publish_queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_publish_queues FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_publish_queues FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.social_publish_queue_slots (
  queue_id UUID NOT NULL REFERENCES public.social_publish_queues(id) ON DELETE CASCADE,
  iso_weekday SMALLINT NOT NULL CHECK (iso_weekday BETWEEN 1 AND 7),
  minute_of_day SMALLINT NOT NULL CHECK (minute_of_day BETWEEN 0 AND 1439),
  PRIMARY KEY(queue_id,iso_weekday,minute_of_day)
);
ALTER TABLE public.social_publish_queue_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_publish_queue_slots FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_publish_queue_slots FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.social_publish_queue_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID NOT NULL REFERENCES public.social_publish_queues(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES public.social_brands(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  scheduled_at TIMESTAMPTZ NOT NULL,
  post_id UUID NULL REFERENCES public.social_posts(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '15 minutes',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(brand_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS social_queue_assignments_slot_idx ON public.social_publish_queue_assignments(queue_id,scheduled_at);
ALTER TABLE public.social_publish_queue_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_publish_queue_assignments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_publish_queue_assignments FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.list_social_publish_queues(p_auth_id TEXT,p_brand_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID;
BEGIN
  v_user:=public.social_inbox_paid_user(p_auth_id);
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','PLAN_REQUIRED'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_brands WHERE id=p_brand_id AND owner_user_id=v_user) THEN RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok',true,'queues',COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id',q.id,'name',q.name,'timezone',q.timezone,'account_ids',to_jsonb(q.account_ids),'enabled',q.enabled,
    'slots',COALESCE((SELECT jsonb_agg(jsonb_build_object('weekday',s.iso_weekday,'minute',s.minute_of_day) ORDER BY s.iso_weekday,s.minute_of_day)
      FROM public.social_publish_queue_slots s WHERE s.queue_id=q.id),'[]'::jsonb)) ORDER BY q.updated_at DESC,q.id DESC)
    FROM public.social_publish_queues q WHERE q.brand_id=p_brand_id),'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.save_social_publish_queue(p_auth_id TEXT,p_brand_id UUID,p_id UUID,p_name TEXT,p_timezone TEXT,p_account_ids UUID[],p_slots JSONB,p_enabled BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID;v_id UUID;v_count INTEGER;v_slot JSONB;
BEGIN
  v_user:=public.social_inbox_paid_user(p_auth_id);
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','PLAN_REQUIRED'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_brands WHERE id=p_brand_id AND owner_user_id=v_user) THEN RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND'); END IF;
  p_name:=btrim(COALESCE(p_name,''));p_timezone:=btrim(COALESCE(p_timezone,''));p_account_ids:=COALESCE(p_account_ids,'{}'::UUID[]);
  IF char_length(p_name) NOT BETWEEN 1 AND 80 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_timezone)
    OR cardinality(p_account_ids) NOT BETWEEN 1 AND 20 OR cardinality(p_account_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_account_ids) x)
    OR EXISTS(SELECT 1 FROM unnest(p_account_ids) x LEFT JOIN public.social_accounts a ON a.id=x AND a.brand_id=p_brand_id AND a.status='active' WHERE a.id IS NULL)
    OR jsonb_typeof(p_slots)<>'array' OR jsonb_array_length(p_slots) NOT BETWEEN 1 AND 35 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUT'); END IF;
  FOR v_slot IN SELECT value FROM jsonb_array_elements(p_slots) LOOP
    IF jsonb_typeof(v_slot)<>'object' OR (v_slot->>'weekday') !~ '^[1-7]$' OR (v_slot->>'minute') !~ '^(0|[1-9][0-9]{0,3})$'
      OR (v_slot->>'minute')::INTEGER>1439 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_SLOT'); END IF;
  END LOOP;
  IF (SELECT count(*) FROM (SELECT DISTINCT (v->>'weekday')::INTEGER,(v->>'minute')::INTEGER FROM jsonb_array_elements(p_slots) v) d)<>jsonb_array_length(p_slots)
    THEN RETURN jsonb_build_object('ok',false,'code','INVALID_SLOT'); END IF;
  IF p_id IS NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('social-publish-queue:'||p_brand_id::TEXT,0));
    SELECT count(*) INTO v_count FROM public.social_publish_queues WHERE brand_id=p_brand_id;
    IF v_count>=20 THEN RETURN jsonb_build_object('ok',false,'code','QUEUE_LIMIT'); END IF;
    INSERT INTO public.social_publish_queues(brand_id,name,timezone,account_ids,enabled) VALUES(p_brand_id,p_name,p_timezone,p_account_ids,COALESCE(p_enabled,true)) RETURNING id INTO v_id;
  ELSE
    UPDATE public.social_publish_queues SET name=p_name,timezone=p_timezone,account_ids=p_account_ids,enabled=COALESCE(p_enabled,true),updated_at=now()
      WHERE id=p_id AND brand_id=p_brand_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','QUEUE_NOT_FOUND'); END IF;
    DELETE FROM public.social_publish_queue_slots WHERE queue_id=v_id;
  END IF;
  INSERT INTO public.social_publish_queue_slots(queue_id,iso_weekday,minute_of_day)
    SELECT v_id,(v->>'weekday')::SMALLINT,(v->>'minute')::SMALLINT FROM jsonb_array_elements(p_slots) v;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id,detail) VALUES(v_user,p_brand_id,'save_publish_queue',v_id,jsonb_build_object('slots',jsonb_array_length(p_slots)));
  RETURN jsonb_build_object('ok',true,'queue_id',v_id);
EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'code','QUEUE_NAME_TAKEN');
END $$;

CREATE OR REPLACE FUNCTION public.delete_social_publish_queue(p_auth_id TEXT,p_brand_id UUID,p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID;v_id UUID;
BEGIN
  v_user:=public.social_inbox_paid_user(p_auth_id);IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','PLAN_REQUIRED');END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_brands WHERE id=p_brand_id AND owner_user_id=v_user) THEN RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND');END IF;
  DELETE FROM public.social_publish_queues WHERE id=p_id AND brand_id=p_brand_id RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','QUEUE_NOT_FOUND');END IF;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id) VALUES(v_user,p_brand_id,'delete_publish_queue',v_id);
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.reserve_social_publish_queue_slot(p_auth_id TEXT,p_brand_id UUID,p_queue_id UUID,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID;v_queue public.social_publish_queues%ROWTYPE;v_existing public.social_publish_queue_assignments%ROWTYPE;v_at TIMESTAMPTZ;v_assignment UUID;
BEGIN
  v_user:=public.social_inbox_paid_user(p_auth_id);IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','PLAN_REQUIRED');END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_IDEMPOTENCY_KEY');END IF;
  SELECT * INTO v_queue FROM public.social_publish_queues WHERE id=p_queue_id AND brand_id=p_brand_id;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.social_brands WHERE id=p_brand_id AND owner_user_id=v_user) THEN RETURN jsonb_build_object('ok',false,'code','QUEUE_NOT_FOUND');END IF;
  IF NOT v_queue.enabled THEN RETURN jsonb_build_object('ok',false,'code','QUEUE_DISABLED');END IF;
  SELECT * INTO v_existing FROM public.social_publish_queue_assignments WHERE brand_id=p_brand_id AND idempotency_key=p_idempotency_key;
  IF FOUND THEN RETURN jsonb_build_object('ok',true,'idempotent',true,'assignment_id',v_existing.id,'scheduled_at',v_existing.scheduled_at,'account_ids',to_jsonb(v_queue.account_ids));END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('social-queue-slot:'||p_queue_id::TEXT,0));
  WITH candidates AS (
    SELECT ((d.day::DATE + make_interval(mins=>s.minute_of_day)) AT TIME ZONE v_queue.timezone) AS scheduled_at
    FROM public.social_publish_queue_slots s
    CROSS JOIN LATERAL generate_series((now() AT TIME ZONE v_queue.timezone)::DATE,((now() AT TIME ZONE v_queue.timezone)::DATE+56),interval '1 day') d(day)
    WHERE s.queue_id=p_queue_id AND extract(isodow FROM d.day)::INTEGER=s.iso_weekday
  ) SELECT c.scheduled_at INTO v_at FROM candidates c WHERE c.scheduled_at>now()+interval '5 minutes'
    AND NOT EXISTS(SELECT 1 FROM public.social_publish_queue_assignments a WHERE a.queue_id=p_queue_id AND a.scheduled_at=c.scheduled_at AND (a.post_id IS NOT NULL OR a.expires_at>now()))
    ORDER BY c.scheduled_at LIMIT 1;
  IF v_at IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NO_QUEUE_SLOT');END IF;
  INSERT INTO public.social_publish_queue_assignments(queue_id,brand_id,idempotency_key,scheduled_at) VALUES(p_queue_id,p_brand_id,p_idempotency_key,v_at) RETURNING id INTO v_assignment;
  RETURN jsonb_build_object('ok',true,'idempotent',false,'assignment_id',v_assignment,'scheduled_at',v_at,'account_ids',to_jsonb(v_queue.account_ids));
END $$;

CREATE OR REPLACE FUNCTION public.confirm_social_publish_queue_slot(p_auth_id TEXT,p_assignment_id UUID,p_post_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID;v_assignment public.social_publish_queue_assignments%ROWTYPE;
BEGIN
  v_user:=public.social_inbox_paid_user(p_auth_id);IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','PLAN_REQUIRED');END IF;
  SELECT a.* INTO v_assignment FROM public.social_publish_queue_assignments a JOIN public.social_brands b ON b.id=a.brand_id AND b.owner_user_id=v_user WHERE a.id=p_assignment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','ASSIGNMENT_NOT_FOUND');END IF;
  IF v_assignment.post_id IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'idempotent',true);END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_posts p WHERE p.id=p_post_id AND p.brand_id=v_assignment.brand_id AND p.scheduled_at=v_assignment.scheduled_at) THEN RETURN jsonb_build_object('ok',false,'code','POST_MISMATCH');END IF;
  UPDATE public.social_publish_queue_assignments SET post_id=p_post_id,expires_at=now() WHERE id=p_assignment_id;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id,detail) VALUES(v_user,v_assignment.brand_id,'queue_social_post',p_post_id,jsonb_build_object('queue_id',v_assignment.queue_id));
  RETURN jsonb_build_object('ok',true,'idempotent',false);
END $$;

REVOKE ALL ON FUNCTION public.list_social_publish_queues(TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_social_publish_queue(TEXT,UUID,UUID,TEXT,TEXT,UUID[],JSONB,BOOLEAN) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.delete_social_publish_queue(TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reserve_social_publish_queue_slot(TEXT,UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.confirm_social_publish_queue_slot(TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_social_publish_queues(TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_social_publish_queue(TEXT,UUID,UUID,TEXT,TEXT,UUID[],JSONB,BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_social_publish_queue(TEXT,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_social_publish_queue_slot(TEXT,UUID,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_social_publish_queue_slot(TEXT,UUID,UUID) TO service_role;
