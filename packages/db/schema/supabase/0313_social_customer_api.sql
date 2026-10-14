-- 0313: scoped customer API keys and per-key request limits for Publish.
BEGIN;

CREATE TABLE IF NOT EXISTS public.social_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.social_brands(id) ON DELETE CASCADE,
  created_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  key_prefix TEXT NOT NULL CHECK (key_prefix ~ '^vxpub_[A-Za-z0-9_-]{8,16}$'),
  key_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(key_hash)=32),
  scopes TEXT[] NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (cardinality(scopes) BETWEEN 1 AND 3)
);
CREATE INDEX IF NOT EXISTS social_api_keys_brand_created_idx ON public.social_api_keys(brand_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS social_api_keys_creator_idx ON public.social_api_keys(created_by_user_id);
ALTER TABLE public.social_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_api_keys FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_api_keys FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.social_api_key_requests (
  id BIGSERIAL PRIMARY KEY,
  api_key_id UUID NOT NULL REFERENCES public.social_api_keys(id) ON DELETE CASCADE,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS social_api_key_requests_window_idx ON public.social_api_key_requests(api_key_id,requested_at DESC);
ALTER TABLE public.social_api_key_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_api_key_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_api_key_requests FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.list_social_api_keys(p_auth_id TEXT,p_brand_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  RETURN jsonb_build_object('ok',true,'keys',COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id',k.id,'label',k.label,'key_prefix',k.key_prefix,'scopes',k.scopes,
      'expires_at',k.expires_at,'last_used_at',k.last_used_at,'revoked_at',k.revoked_at,'created_at',k.created_at)
      ORDER BY k.created_at DESC,k.id DESC)
    FROM public.social_api_keys k WHERE k.brand_id=p_brand_id
  ),'[]'::JSONB));
END $$;

CREATE OR REPLACE FUNCTION public.create_social_api_key(
  p_auth_id TEXT,p_brand_id UUID,p_label TEXT,p_key_prefix TEXT,p_key_hash TEXT,p_scopes TEXT[],p_expires_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_id UUID;v_count INTEGER;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;p_label:=btrim(COALESCE(p_label,''));
  IF char_length(p_label) NOT BETWEEN 1 AND 80 OR p_key_prefix IS NULL OR p_key_prefix !~ '^vxpub_[A-Za-z0-9_-]{8,16}$'
    OR p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' OR p_scopes IS NULL OR cardinality(p_scopes) NOT BETWEEN 1 AND 3
    OR EXISTS(SELECT 1 FROM unnest(p_scopes) scope WHERE scope NOT IN ('accounts:read','posts:read','posts:write'))
    OR cardinality(p_scopes) IS DISTINCT FROM (SELECT count(DISTINCT scope) FROM unnest(p_scopes) scope)
    OR p_expires_at IS NULL OR p_expires_at<now()+interval '1 day' OR p_expires_at>now()+interval '366 days' THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_INPUT');
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('social-api-key:'||p_brand_id::TEXT,0));
  SELECT count(*) INTO v_count FROM public.social_api_keys WHERE brand_id=p_brand_id AND revoked_at IS NULL AND expires_at>now();
  IF v_count>=10 THEN RETURN jsonb_build_object('ok',false,'code','API_KEY_LIMIT'); END IF;
  INSERT INTO public.social_api_keys(brand_id,created_by_user_id,label,key_prefix,key_hash,scopes,expires_at)
    VALUES(p_brand_id,v_actor,p_label,p_key_prefix,decode(p_key_hash,'hex'),p_scopes,p_expires_at) RETURNING id INTO v_id;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id,detail)
    VALUES(v_actor,p_brand_id,'create_api_key',v_id,jsonb_build_object('label',p_label,'scopes',p_scopes,'expires_at',p_expires_at));
  RETURN jsonb_build_object('ok',true,'key_id',v_id);
EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'code','KEY_COLLISION');
END $$;

CREATE OR REPLACE FUNCTION public.revoke_social_api_key(p_auth_id TEXT,p_brand_id UUID,p_key_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_id UUID;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  v_actor:=(v_context->>'actor_id')::UUID;
  UPDATE public.social_api_keys SET revoked_at=COALESCE(revoked_at,clock_timestamp())
    WHERE id=p_key_id AND brand_id=p_brand_id RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','API_KEY_NOT_FOUND'); END IF;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id) VALUES(v_actor,p_brand_id,'revoke_api_key',v_id);
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.authenticate_social_api_key(p_key_hash TEXT,p_scope TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_key public.social_api_keys%ROWTYPE;v_auth TEXT;v_role TEXT;v_count INTEGER;v_oldest TIMESTAMPTZ;v_retry INTEGER;
BEGIN
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' OR p_scope NOT IN ('accounts:read','posts:read','posts:write') THEN
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
  DELETE FROM public.social_api_key_requests WHERE api_key_id=v_key.id AND requested_at<clock_timestamp()-interval '10 minutes';
  SELECT count(*),min(requested_at) INTO v_count,v_oldest FROM public.social_api_key_requests
    WHERE api_key_id=v_key.id AND requested_at>clock_timestamp()-interval '1 minute';
  IF v_count>=120 THEN
    v_retry:=greatest(1,ceil(extract(epoch FROM (v_oldest+interval '1 minute'-clock_timestamp())))::INTEGER);
    RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED','retry_after_seconds',v_retry);
  END IF;
  INSERT INTO public.social_api_key_requests(api_key_id) VALUES(v_key.id);
  IF v_key.last_used_at IS NULL OR v_key.last_used_at<clock_timestamp()-interval '5 minutes' THEN
    UPDATE public.social_api_keys SET last_used_at=clock_timestamp() WHERE id=v_key.id;
  END IF;
  RETURN jsonb_build_object('ok',true,'key_id',v_key.id,'brand_id',v_key.brand_id,'auth_id',v_auth,'role',v_role);
END $$;

REVOKE ALL ON FUNCTION public.list_social_api_keys(TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_social_api_key(TEXT,UUID,TEXT,TEXT,TEXT,TEXT[],TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.revoke_social_api_key(TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.authenticate_social_api_key(TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_social_api_keys(TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_social_api_key(TEXT,UUID,TEXT,TEXT,TEXT,TEXT[],TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_social_api_key(TEXT,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.authenticate_social_api_key(TEXT,TEXT) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
