-- 0308: actor-aware team publishing, scheduling, presets and approvals.
-- Owners keep the existing free Post now path. Delegated roles require the
-- brand owner's active Publish subscription, and every write records the
-- authenticated teammate rather than substituting the owner.
BEGIN;

CREATE OR REPLACE FUNCTION public.social_brand_role_context(
  p_auth_id TEXT,p_brand_id UUID,p_roles TEXT[],p_require_paid BOOLEAN DEFAULT false
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor UUID;v_owner UUID;v_role TEXT;
BEGIN
  IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND');
  END IF;
  SELECT u.id INTO v_actor FROM public.users u JOIN auth.users a ON a.id=p_auth_id::UUID WHERE u.auth_id=p_auth_id;
  IF v_actor IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
  SELECT b.owner_user_id INTO v_owner FROM public.social_brands b WHERE b.id=p_brand_id;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND'); END IF;
  v_role:=public.social_brand_role(p_auth_id,p_brand_id);
  IF v_role IS NULL THEN RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND'); END IF;
  IF p_roles IS NULL OR NOT v_role=ANY(p_roles) THEN RETURN jsonb_build_object('ok',false,'code','FORBIDDEN'); END IF;
  IF (COALESCE(p_require_paid,false) OR v_role<>'owner') AND NOT EXISTS(
    SELECT 1 FROM public.social_publish_subscriptions s WHERE s.user_id=v_owner
      AND s.status IN ('active','past_due') AND s.current_period_end>now()
  ) THEN RETURN jsonb_build_object('ok',false,'code','PLAN_REQUIRED'); END IF;
  RETURN jsonb_build_object('ok',true,'actor_id',v_actor,'owner_id',v_owner,'role',v_role);
END $$;

CREATE OR REPLACE FUNCTION public.create_social_post(
  p_auth_id TEXT,p_brand_id UUID,p_scheduled_at TIMESTAMPTZ,p_global_text TEXT,
  p_idempotency_key TEXT,p_account_ids UUID[],p_media JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_post_id UUID;v_existing UUID;v_item JSONB;
  v_position INTEGER:=0;v_account_count INTEGER;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor'],false);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_IDEMPOTENCY_KEY'); END IF;
  SELECT id INTO v_existing FROM public.social_posts WHERE brand_id=p_brand_id AND idempotency_key=p_idempotency_key;
  IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'idempotent',true,'post_id',v_existing); END IF;
  IF p_scheduled_at IS NULL OR p_scheduled_at<now()-interval '5 minutes' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_SCHEDULE'); END IF;
  IF p_account_ids IS NULL OR array_length(p_account_ids,1) IS NULL OR array_length(p_account_ids,1)>20 THEN RETURN jsonb_build_object('ok',false,'code','NO_TARGET_ACCOUNTS'); END IF;
  SELECT count(*) INTO v_account_count FROM public.social_accounts a WHERE a.id=ANY(p_account_ids) AND a.brand_id=p_brand_id AND a.status='active';
  IF v_account_count IS DISTINCT FROM array_length(p_account_ids,1)
    OR v_account_count IS DISTINCT FROM (SELECT count(*) FROM (SELECT DISTINCT unnest(p_account_ids)) d) THEN
    RETURN jsonb_build_object('ok',false,'code','ACCOUNT_NOT_FOUND');
  END IF;
  IF p_media IS NULL OR jsonb_typeof(p_media)<>'array' OR jsonb_array_length(p_media) NOT BETWEEN 1 AND 10 THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_MEDIA');
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_media) LOOP
    IF jsonb_typeof(v_item)<>'object' OR (v_item->>'media_type') IS NULL OR (v_item->>'media_type') NOT IN ('image','video')
      OR (v_item ? 'job_id')=(v_item ? 'upload_id') THEN RETURN jsonb_build_object('ok',false,'code','INVALID_MEDIA'); END IF;
    IF v_item ? 'job_id' THEN
      IF (v_item->>'job_id') IS NULL OR (v_item->>'job_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_MEDIA'); END IF;
      IF NOT EXISTS(SELECT 1 FROM public.assets a JOIN public.jobs j ON j.id=a.job_id
        WHERE j.id=(v_item->>'job_id')::UUID AND j.user_id=v_actor AND split_part(a.mime_type,'/',1)=v_item->>'media_type') THEN
        RETURN jsonb_build_object('ok',false,'code','MEDIA_NOT_FOUND'); END IF;
      IF EXISTS(SELECT 1 FROM public.assets a WHERE a.job_id=(v_item->>'job_id')::UUID AND a.held_at IS NOT NULL) THEN
        RETURN jsonb_build_object('ok',false,'code','MEDIA_HELD'); END IF;
    ELSE
      IF (v_item->>'upload_id') IS NULL OR (v_item->>'upload_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_MEDIA'); END IF;
      IF NOT EXISTS(SELECT 1 FROM public.social_uploads u WHERE u.id=(v_item->>'upload_id')::UUID AND u.user_id=v_actor
        AND u.status='ready' AND split_part(u.mime_type,'/',1)=v_item->>'media_type') THEN
        RETURN jsonb_build_object('ok',false,'code','MEDIA_NOT_FOUND'); END IF;
    END IF;
  END LOOP;
  INSERT INTO public.social_posts(brand_id,created_by_user_id,status,scheduled_at,global_text,idempotency_key)
    VALUES(p_brand_id,v_actor,'scheduled',p_scheduled_at,p_global_text,p_idempotency_key) RETURNING id INTO v_post_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_media) LOOP
    INSERT INTO public.social_post_media(post_id,"position",media_type,source_job_id,source_upload_id)
      VALUES(v_post_id,v_position,v_item->>'media_type',(v_item->>'job_id')::UUID,(v_item->>'upload_id')::UUID);
    v_position:=v_position+1;
  END LOOP;
  INSERT INTO public.social_post_targets(post_id,account_id,network)
    SELECT v_post_id,a.id,a.network FROM public.social_accounts a WHERE a.id=ANY(p_account_ids) AND a.brand_id=p_brand_id AND a.status='active';
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id,detail)
    VALUES(v_actor,p_brand_id,'created_post',v_post_id,jsonb_build_object('targets',array_length(p_account_ids,1)));
  RETURN jsonb_build_object('ok',true,'idempotent',false,'post_id',v_post_id,'target_count',array_length(p_account_ids,1));
END $$;

CREATE OR REPLACE FUNCTION public.social_brand_contains_post(p_auth_id TEXT,p_brand_id UUID,p_post_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor'],false);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_posts p WHERE p.id=p_post_id AND p.brand_id=p_brand_id) THEN
    RETURN jsonb_build_object('ok',false,'code','POST_NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.reschedule_social_post(
  p_auth_id TEXT,p_post_id UUID,p_expected_at TIMESTAMPTZ,p_scheduled_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_brand UUID;v_post public.social_posts%ROWTYPE;
BEGIN
  SELECT p.brand_id INTO v_brand FROM public.social_posts p WHERE p.id=p_post_id;
  IF v_brand IS NULL THEN RETURN jsonb_build_object('ok',false,'code','POST_NOT_FOUND'); END IF;
  v_context:=public.social_brand_role_context(p_auth_id,v_brand,ARRAY['owner','manager','editor'],false);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  IF p_scheduled_at IS NULL OR NOT isfinite(p_scheduled_at) OR p_scheduled_at<=clock_timestamp()+interval '1 minute'
    OR p_expected_at IS NULL OR NOT isfinite(p_expected_at) THEN RETURN jsonb_build_object('ok',false,'code','INVALID_SCHEDULE'); END IF;
  PERFORM id FROM public.social_post_targets WHERE post_id=p_post_id ORDER BY id FOR UPDATE NOWAIT;
  SELECT p.* INTO v_post FROM public.social_posts p WHERE p.id=p_post_id AND p.brand_id=v_brand FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','POST_NOT_FOUND'); END IF;
  IF v_post.status<>'scheduled' OR NOT EXISTS(SELECT 1 FROM public.social_post_targets WHERE post_id=p_post_id)
    OR EXISTS(SELECT 1 FROM public.social_post_targets WHERE post_id=p_post_id AND (publish_status<>'pending' OR attempts<>0 OR claimed_at IS NOT NULL)) THEN
    RETURN jsonb_build_object('ok',false,'code','POST_STARTED'); END IF;
  IF p_scheduled_at<=clock_timestamp()+interval '1 minute' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_SCHEDULE'); END IF;
  IF v_post.scheduled_at=p_scheduled_at THEN RETURN jsonb_build_object('ok',true,'idempotent',true,'scheduled_at',v_post.scheduled_at); END IF;
  IF v_post.scheduled_at<>p_expected_at THEN RETURN jsonb_build_object('ok',false,'code','SCHEDULE_CHANGED'); END IF;
  UPDATE public.social_post_targets SET next_attempt_at=p_scheduled_at WHERE post_id=p_post_id;
  UPDATE public.social_posts SET scheduled_at=p_scheduled_at,updated_at=clock_timestamp() WHERE id=p_post_id;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id,detail)
    VALUES(v_actor,v_post.brand_id,'rescheduled_post',p_post_id,jsonb_build_object('from',v_post.scheduled_at,'to',p_scheduled_at));
  RETURN jsonb_build_object('ok',true,'idempotent',false,'scheduled_at',p_scheduled_at);
EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('ok',false,'code','POST_BUSY');
END $$;

CREATE OR REPLACE FUNCTION public.save_social_content_preset(
  p_auth_id TEXT,p_brand_id UUID,p_id UUID,p_name TEXT,p_caption TEXT,p_account_ids UUID[]
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_id UUID;v_count INTEGER;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  p_name:=btrim(COALESCE(p_name,''));p_caption:=COALESCE(p_caption,'');p_account_ids:=COALESCE(p_account_ids,'{}'::UUID[]);
  IF char_length(p_name) NOT BETWEEN 1 AND 80 OR char_length(p_caption) NOT BETWEEN 1 AND 4000
    OR cardinality(p_account_ids)>20 OR cardinality(p_account_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_account_ids) x)
    OR EXISTS(SELECT 1 FROM unnest(p_account_ids) x LEFT JOIN public.social_accounts a ON a.id=x AND a.brand_id=p_brand_id WHERE a.id IS NULL)
    THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUT'); END IF;
  IF p_id IS NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('social-content-preset:'||p_brand_id::TEXT,0));
    SELECT count(*) INTO v_count FROM public.social_content_presets WHERE brand_id=p_brand_id;
    IF v_count>=50 THEN RETURN jsonb_build_object('ok',false,'code','PRESET_LIMIT'); END IF;
    INSERT INTO public.social_content_presets(brand_id,name,caption,account_ids) VALUES(p_brand_id,p_name,p_caption,p_account_ids) RETURNING id INTO v_id;
  ELSE
    UPDATE public.social_content_presets SET name=p_name,caption=p_caption,account_ids=p_account_ids,updated_at=now()
      WHERE id=p_id AND brand_id=p_brand_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','PRESET_NOT_FOUND'); END IF;
  END IF;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id,detail)
    VALUES(v_actor,p_brand_id,'save_content_preset',v_id,jsonb_build_object('account_count',cardinality(p_account_ids)));
  RETURN jsonb_build_object('ok',true,'preset_id',v_id);
EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'code','PRESET_NAME_TAKEN');
END $$;

CREATE OR REPLACE FUNCTION public.delete_social_content_preset(p_auth_id TEXT,p_brand_id UUID,p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_id UUID;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  DELETE FROM public.social_content_presets WHERE id=p_id AND brand_id=p_brand_id RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','PRESET_NOT_FOUND'); END IF;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id) VALUES(v_actor,p_brand_id,'delete_content_preset',v_id);
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.reserve_social_publish_queue_slot(p_auth_id TEXT,p_brand_id UUID,p_queue_id UUID,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_queue public.social_publish_queues%ROWTYPE;v_existing public.social_publish_queue_assignments%ROWTYPE;v_at TIMESTAMPTZ;v_assignment UUID;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_IDEMPOTENCY_KEY'); END IF;
  SELECT * INTO v_queue FROM public.social_publish_queues WHERE id=p_queue_id AND brand_id=p_brand_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','QUEUE_NOT_FOUND'); END IF;
  IF NOT v_queue.enabled THEN RETURN jsonb_build_object('ok',false,'code','QUEUE_DISABLED'); END IF;
  SELECT * INTO v_existing FROM public.social_publish_queue_assignments WHERE brand_id=p_brand_id AND idempotency_key=p_idempotency_key;
  IF FOUND THEN RETURN jsonb_build_object('ok',true,'idempotent',true,'assignment_id',v_existing.id,'scheduled_at',v_existing.scheduled_at,'account_ids',to_jsonb(v_queue.account_ids)); END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('social-queue-slot:'||p_queue_id::TEXT,0));
  WITH candidates AS (
    SELECT ((d.day::DATE+make_interval(mins=>s.minute_of_day)) AT TIME ZONE v_queue.timezone) scheduled_at
    FROM public.social_publish_queue_slots s CROSS JOIN LATERAL generate_series((now() AT TIME ZONE v_queue.timezone)::DATE,
      ((now() AT TIME ZONE v_queue.timezone)::DATE+56),interval '1 day') d(day)
    WHERE s.queue_id=p_queue_id AND extract(isodow FROM d.day)::INTEGER=s.iso_weekday
  ) SELECT c.scheduled_at INTO v_at FROM candidates c WHERE c.scheduled_at>now()+interval '5 minutes'
    AND NOT EXISTS(SELECT 1 FROM public.social_publish_queue_assignments a WHERE a.queue_id=p_queue_id AND a.scheduled_at=c.scheduled_at AND (a.post_id IS NOT NULL OR a.expires_at>now()))
    ORDER BY c.scheduled_at LIMIT 1;
  IF v_at IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NO_QUEUE_SLOT'); END IF;
  INSERT INTO public.social_publish_queue_assignments(queue_id,brand_id,idempotency_key,scheduled_at)
    VALUES(p_queue_id,p_brand_id,p_idempotency_key,v_at) RETURNING id INTO v_assignment;
  RETURN jsonb_build_object('ok',true,'idempotent',false,'assignment_id',v_assignment,'scheduled_at',v_at,'account_ids',to_jsonb(v_queue.account_ids));
END $$;

CREATE OR REPLACE FUNCTION public.social_brand_contains_queue_assignment(p_auth_id TEXT,p_brand_id UUID,p_assignment_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_publish_queue_assignments a WHERE a.id=p_assignment_id AND a.brand_id=p_brand_id) THEN
    RETURN jsonb_build_object('ok',false,'code','ASSIGNMENT_NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.confirm_social_publish_queue_slot(p_auth_id TEXT,p_assignment_id UUID,p_post_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_assignment public.social_publish_queue_assignments%ROWTYPE;
BEGIN
  SELECT * INTO v_assignment FROM public.social_publish_queue_assignments WHERE id=p_assignment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','ASSIGNMENT_NOT_FOUND'); END IF;
  v_context:=public.social_brand_role_context(p_auth_id,v_assignment.brand_id,ARRAY['owner','manager','editor'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  IF v_assignment.post_id IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'idempotent',true); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_posts p WHERE p.id=p_post_id AND p.brand_id=v_assignment.brand_id AND p.scheduled_at=v_assignment.scheduled_at) THEN
    RETURN jsonb_build_object('ok',false,'code','POST_MISMATCH'); END IF;
  UPDATE public.social_publish_queue_assignments SET post_id=p_post_id,expires_at=now() WHERE id=p_assignment_id;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id,detail)
    VALUES(v_actor,v_assignment.brand_id,'queue_social_post',p_post_id,jsonb_build_object('queue_id',v_assignment.queue_id));
  RETURN jsonb_build_object('ok',true,'idempotent',false);
END $$;

CREATE OR REPLACE FUNCTION public.approve_social_post_batch(p_auth_id TEXT,p_brand_id UUID,p_batch_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_post UUID;v_approved INTEGER:=0;v_failed INTEGER;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','reviewer'],false);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  IF p_batch_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','INVALID_BATCH'); END IF;
  FOR v_post IN UPDATE public.social_posts SET status='scheduled',scheduled_at=greatest(scheduled_at,now()),updated_at=now()
    WHERE brand_id=p_brand_id AND draft_batch_id=p_batch_id AND status='draft' RETURNING id
  LOOP PERFORM public.settle_social_post(v_post);v_approved:=v_approved+1;END LOOP;
  SELECT count(*) INTO v_failed FROM public.social_posts WHERE brand_id=p_brand_id AND draft_batch_id=p_batch_id AND status='failed';
  IF v_approved>0 THEN INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id,detail)
    VALUES(v_actor,p_brand_id,'approve_drafts',p_batch_id,jsonb_build_object('posts',v_approved)); END IF;
  RETURN jsonb_build_object('ok',true,'approved',v_approved,'failed',v_failed);
END $$;

CREATE OR REPLACE FUNCTION public.discard_social_post_drafts(
  p_auth_id TEXT,p_brand_id UUID,p_batch_id UUID,p_post_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_discarded INTEGER;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','reviewer'],false);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  IF p_batch_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','INVALID_BATCH'); END IF;
  WITH discarded AS (
    UPDATE public.social_posts SET status='canceled',updated_at=now()
      WHERE brand_id=p_brand_id AND draft_batch_id=p_batch_id AND status='draft' AND (p_post_id IS NULL OR id=p_post_id) RETURNING id
  ),targets AS (
    UPDATE public.social_post_targets t SET publish_status='failed',last_error='draft_discarded',claim_key=NULL
      FROM discarded d WHERE t.post_id=d.id AND t.publish_status='pending' RETURNING t.id
  ) SELECT count(*) INTO v_discarded FROM discarded;
  IF v_discarded>0 THEN INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id,detail)
    VALUES(v_actor,p_brand_id,'discard_drafts',p_batch_id,jsonb_build_object('posts',v_discarded,'post_id',p_post_id)); END IF;
  RETURN jsonb_build_object('ok',true,'discarded',v_discarded);
END $$;

CREATE OR REPLACE FUNCTION public.create_social_post_approval(
  p_auth_id TEXT,p_brand_id UUID,p_batch_id UUID,p_scheduled_at TIMESTAMPTZ,p_global_text TEXT,
  p_idempotency_key TEXT,p_account_ids UUID[],p_media JSONB,p_policy TEXT,p_reviewer_emails JSONB,
  p_youtube_visibility TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_post JSONB;v_post_id UUID;v_request UUID;v_email TEXT;v_count INTEGER;v_distinct INTEGER;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  IF p_batch_id IS NULL OR p_policy IS NULL OR p_policy NOT IN ('any','all') OR p_reviewer_emails IS NULL
    OR jsonb_typeof(p_reviewer_emails)<>'array' OR jsonb_array_length(p_reviewer_emails) NOT BETWEEN 1 AND 10 THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_APPROVAL'); END IF;
  IF p_youtube_visibility IS NOT NULL AND p_youtube_visibility NOT IN ('private','unlisted','public') THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_YOUTUBE_VISIBILITY'); END IF;
  SELECT count(*),count(DISTINCT lower(btrim(value))) INTO v_count,v_distinct FROM jsonb_array_elements_text(p_reviewer_emails);
  IF v_count<>v_distinct OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_reviewer_emails) e(value)
    WHERE char_length(btrim(value)) NOT BETWEEN 3 AND 254 OR btrim(value) !~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$') THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_REVIEWERS'); END IF;
  v_post:=public.create_social_post_draft(p_auth_id,p_brand_id,p_batch_id,p_scheduled_at,p_global_text,p_idempotency_key,p_account_ids,p_media);
  IF NOT coalesce((v_post->>'ok')::BOOLEAN,false) THEN RETURN v_post; END IF;
  v_post_id:=(v_post->>'post_id')::UUID;
  IF NOT coalesce((v_post->>'idempotent')::BOOLEAN,false) AND p_youtube_visibility IS NOT NULL THEN
    UPDATE public.social_post_targets SET provider_state=coalesce(provider_state,'{}'::jsonb)||jsonb_build_object('youtube_visibility',p_youtube_visibility)
      WHERE post_id=v_post_id AND network='youtube';
  END IF;
  SELECT r.id INTO v_request FROM public.social_approval_requests r WHERE r.post_id=v_post_id;
  IF v_request IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'idempotent',true,'request_id',v_request,'post_id',v_post_id,
    'reviewers',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',rv.id,'email',rv.email) ORDER BY rv.created_at),'[]'::jsonb)
      FROM public.social_approval_reviewers rv WHERE rv.request_id=v_request)); END IF;
  IF coalesce((v_post->>'idempotent')::BOOLEAN,false) THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  INSERT INTO public.social_approval_requests(brand_id,post_id,draft_batch_id,requester_user_id,policy)
    VALUES(p_brand_id,v_post_id,p_batch_id,v_actor,p_policy) RETURNING id INTO v_request;
  FOR v_email IN SELECT DISTINCT lower(btrim(value)) FROM jsonb_array_elements_text(p_reviewer_emails) LOOP
    INSERT INTO public.social_approval_reviewers(request_id,email) VALUES(v_request,v_email);
  END LOOP;
  INSERT INTO public.social_approval_events(request_id,actor_user_id,action,detail)
    VALUES(v_request,v_actor,'requested',jsonb_build_object('policy',p_policy,'reviewers',v_count));
  RETURN jsonb_build_object('ok',true,'idempotent',false,'request_id',v_request,'post_id',v_post_id,
    'reviewers',(SELECT jsonb_agg(jsonb_build_object('id',rv.id,'email',rv.email) ORDER BY rv.created_at)
      FROM public.social_approval_reviewers rv WHERE rv.request_id=v_request));
END $$;

REVOKE ALL ON FUNCTION public.social_brand_role_context(TEXT,UUID,TEXT[],BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE fn TEXT; BEGIN FOREACH fn IN ARRAY ARRAY[
  'public.create_social_post(text,uuid,timestamptz,text,text,uuid[],jsonb)',
  'public.social_brand_contains_post(text,uuid,uuid)',
  'public.reschedule_social_post(text,uuid,timestamptz,timestamptz)',
  'public.save_social_content_preset(text,uuid,uuid,text,text,uuid[])',
  'public.delete_social_content_preset(text,uuid,uuid)',
  'public.reserve_social_publish_queue_slot(text,uuid,uuid,text)',
  'public.social_brand_contains_queue_assignment(text,uuid,uuid)',
  'public.confirm_social_publish_queue_slot(text,uuid,uuid)',
  'public.approve_social_post_batch(text,uuid,uuid)',
  'public.discard_social_post_drafts(text,uuid,uuid,uuid)',
  'public.create_social_post_approval(text,uuid,uuid,timestamptz,text,text,uuid[],jsonb,text,jsonb,text)'
] LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||fn||' FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION '||fn||' TO service_role';END LOOP;END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
