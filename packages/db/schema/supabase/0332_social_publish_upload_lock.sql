-- 0332: restore upload scheduling/removal serialization lost in 0308.
-- Preserve the actor-aware authorization and every existing validation/result.
-- Draft, approval and per-network option entry points delegate to this writer.
BEGIN;

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
  -- remove_social_upload takes this owner row before checking references.
  -- Keep the same lock order so removal cannot pass a stale in-use check.
  PERFORM u.id FROM public.users u WHERE u.id=v_actor FOR UPDATE OF u;
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
  -- Validate upload UUIDs before casting, then lock at most ten owned files
  -- in stable order. The original validation below remains authoritative.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_media) LOOP
    IF v_item ? 'upload_id' AND ((v_item->>'upload_id') IS NULL
      OR (v_item->>'upload_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
      RETURN jsonb_build_object('ok',false,'code','INVALID_MEDIA');
    END IF;
  END LOOP;
  PERFORM u.id FROM public.social_uploads u WHERE u.user_id=v_actor
    AND u.id IN (SELECT (item->>'upload_id')::UUID FROM jsonb_array_elements(p_media) item WHERE item ? 'upload_id')
    ORDER BY u.id FOR UPDATE OF u;
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

REVOKE ALL ON FUNCTION public.create_social_post(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,UUID[],JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_social_post(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,UUID[],JSONB) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
