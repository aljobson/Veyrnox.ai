-- 0315: searchable customer API request history for Publish developer operations.
BEGIN;

ALTER TABLE public.social_api_key_requests
  ADD COLUMN IF NOT EXISTS method TEXT NULL CHECK (method IS NULL OR method IN ('GET','POST')),
  ADD COLUMN IF NOT EXISTS route TEXT NULL CHECK (route IS NULL OR route IN ('/api/publish/v1/accounts','/api/publish/v1/posts')),
  ADD COLUMN IF NOT EXISTS response_status INTEGER NULL CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599),
  ADD COLUMN IF NOT EXISTS error_code TEXT NULL CHECK (error_code IS NULL OR char_length(error_code)<=80),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL;
CREATE INDEX IF NOT EXISTS social_api_key_requests_history_idx
  ON public.social_api_key_requests(api_key_id,requested_at DESC,id DESC);

CREATE OR REPLACE FUNCTION public.authenticate_social_api_key(p_key_hash TEXT,p_scope TEXT,p_method TEXT,p_route TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_key public.social_api_keys%ROWTYPE;v_auth TEXT;v_role TEXT;v_count INTEGER;v_oldest TIMESTAMPTZ;v_retry INTEGER;v_request_id BIGINT;
BEGIN
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' OR p_scope NOT IN ('accounts:read','posts:read','posts:write')
    OR p_method NOT IN ('GET','POST') OR p_route NOT IN ('/api/publish/v1/accounts','/api/publish/v1/posts') THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_API_KEY');
  END IF;
  SELECT k.* INTO v_key FROM public.social_api_keys k WHERE k.key_hash=decode(p_key_hash,'hex') FOR UPDATE;
  IF NOT FOUND OR v_key.revoked_at IS NOT NULL OR v_key.expires_at<=now() THEN RETURN jsonb_build_object('ok',false,'code','INVALID_API_KEY'); END IF;
  IF NOT p_scope=ANY(v_key.scopes) THEN RETURN jsonb_build_object('ok',false,'code','INSUFFICIENT_SCOPE'); END IF;
  SELECT u.auth_id INTO v_auth FROM public.users u JOIN auth.users a ON a.id=u.auth_id::UUID WHERE u.id=v_key.created_by_user_id;
  IF v_auth IS NULL THEN RETURN jsonb_build_object('ok',false,'code','INVALID_API_KEY'); END IF;
  v_role:=public.social_brand_role(v_auth,v_key.brand_id);
  IF v_role IS NULL OR v_role NOT IN ('owner','manager') THEN RETURN jsonb_build_object('ok',false,'code','INVALID_API_KEY'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_brands b JOIN public.social_publish_subscriptions s ON s.user_id=b.owner_user_id
    WHERE b.id=v_key.brand_id AND s.status IN ('active','past_due') AND s.current_period_end>now()) THEN
    RETURN jsonb_build_object('ok',false,'code','PLAN_REQUIRED');
  END IF;
  DELETE FROM public.social_api_key_requests WHERE api_key_id=v_key.id AND requested_at<clock_timestamp()-interval '90 days';
  SELECT count(*),min(requested_at) INTO v_count,v_oldest FROM public.social_api_key_requests
    WHERE api_key_id=v_key.id AND requested_at>clock_timestamp()-interval '1 minute';
  IF v_count>=120 THEN
    v_retry:=greatest(1,ceil(extract(epoch FROM (v_oldest+interval '1 minute'-clock_timestamp())))::INTEGER);
    RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED','retry_after_seconds',v_retry);
  END IF;
  INSERT INTO public.social_api_key_requests(api_key_id,method,route) VALUES(v_key.id,p_method,p_route) RETURNING id INTO v_request_id;
  IF v_key.last_used_at IS NULL OR v_key.last_used_at<clock_timestamp()-interval '5 minutes' THEN
    UPDATE public.social_api_keys SET last_used_at=clock_timestamp() WHERE id=v_key.id;
  END IF;
  RETURN jsonb_build_object('ok',true,'key_id',v_key.id,'brand_id',v_key.brand_id,'auth_id',v_auth,'role',v_role,'request_id',v_request_id);
END $$;

CREATE OR REPLACE FUNCTION public.complete_social_api_key_request(
  p_request_id BIGINT,p_api_key_id UUID,p_status INTEGER,p_error_code TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id BIGINT;
BEGIN
  IF p_status<100 OR p_status>599 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUT'); END IF;
  p_error_code:=left(NULLIF(btrim(COALESCE(p_error_code,'')),''),80);
  UPDATE public.social_api_key_requests SET response_status=p_status,error_code=p_error_code,completed_at=clock_timestamp()
    WHERE id=p_request_id AND api_key_id=p_api_key_id AND completed_at IS NULL RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','REQUEST_NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.list_social_api_request_logs(
  p_auth_id TEXT,p_brand_id UUID,p_status TEXT DEFAULT NULL,p_route TEXT DEFAULT NULL,p_query TEXT DEFAULT NULL,p_limit INTEGER DEFAULT 100
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_query TEXT:=left(btrim(COALESCE(p_query,'')),80);
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('success','error','pending') THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUT'); END IF;
  IF p_route IS NOT NULL AND p_route NOT IN ('/api/publish/v1/accounts','/api/publish/v1/posts') THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUT'); END IF;
  RETURN jsonb_build_object('ok',true,'logs',COALESCE((SELECT jsonb_agg(row_to_json(q)::JSONB ORDER BY q.requested_at DESC,q.id DESC) FROM (
    SELECT r.id,r.requested_at,r.completed_at,r.method,r.route,r.response_status,r.error_code,
      k.id api_key_id,k.label api_key_label,k.key_prefix
    FROM public.social_api_key_requests r JOIN public.social_api_keys k ON k.id=r.api_key_id
    WHERE k.brand_id=p_brand_id
      AND (p_status IS NULL OR (p_status='success' AND r.response_status BETWEEN 200 AND 399)
        OR (p_status='error' AND r.response_status>=400) OR (p_status='pending' AND r.response_status IS NULL))
      AND (p_route IS NULL OR r.route=p_route)
      AND (v_query='' OR k.label ILIKE '%'||v_query||'%' OR r.route ILIKE '%'||v_query||'%' OR COALESCE(r.error_code,'') ILIKE '%'||v_query||'%')
    ORDER BY r.requested_at DESC,r.id DESC LIMIT least(greatest(COALESCE(p_limit,100),1),250)
  ) q),'[]'::JSONB));
END $$;

REVOKE ALL ON FUNCTION public.authenticate_social_api_key(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_social_api_key_request(BIGINT,UUID,INTEGER,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.list_social_api_request_logs(TEXT,UUID,TEXT,TEXT,TEXT,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authenticate_social_api_key(TEXT,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_social_api_key_request(BIGINT,UUID,INTEGER,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_social_api_request_logs(TEXT,UUID,TEXT,TEXT,TEXT,INTEGER) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
