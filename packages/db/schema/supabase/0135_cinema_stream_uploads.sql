-- Bounded private media reservations. Content remains PRIVATE/DRAFT.
CREATE TABLE IF NOT EXISTS public.cinema_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID NOT NULL UNIQUE REFERENCES public.cinema_content(id) ON DELETE RESTRICT,
  creator_id UUID NOT NULL REFERENCES public.cinema_profiles(user_id) ON DELETE RESTRICT,
  create_key UUID NOT NULL,
  file_size BIGINT NOT NULL CHECK(file_size BETWEEN 1 AND 2147483648),
  fingerprint TEXT NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
  state TEXT NOT NULL DEFAULT 'provisioning' CHECK(state IN ('provisioning','uploading','processing','ready','error')),
  stream_uid TEXT UNIQUE CHECK(stream_uid ~ '^[A-Za-z0-9]{32}$'),
  upload_url TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '1 hour',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  observed_at TIMESTAMPTZ,
  duration_seconds NUMERIC,
  width INTEGER,
  height INTEGER,
  UNIQUE(creator_id,create_key)
);
CREATE INDEX IF NOT EXISTS cinema_upload_creator_idx ON public.cinema_uploads(creator_id,created_at);
ALTER TABLE public.cinema_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_uploads FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_uploads FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.cinema_upload_owner(p_auth_id TEXT,p_content_id UUID)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID;
BEGIN
  IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NULL; END IF;
  SELECT u.id INTO v_user FROM public.users u JOIN auth.users a ON a.id=p_auth_id::UUID
    JOIN public.cinema_profiles p ON p.user_id=u.id JOIN public.cinema_memberships m ON m.user_id=u.id
    JOIN public.cinema_content c ON c.creator_id=u.id AND c.id=p_content_id
    WHERE u.auth_id=p_auth_id AND m.role='creator' AND m.account_status='active'
    AND c.lifecycle_status='DRAFT' AND c.content_type IN ('FILM','SHORT','TRAILER','EPISODE');
  RETURN v_user;
END $$;
REVOKE ALL ON FUNCTION public.cinema_upload_owner(TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.reserve_cinema_upload(p_auth_id TEXT,p_content_id UUID,p_key UUID,p_size BIGINT,p_fingerprint TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_row public.cinema_uploads%ROWTYPE;
BEGIN
  -- One small, fixed global lock makes the preview account/storage cap exact.
  PERFORM pg_advisory_xact_lock(135,1);
  v_user:=public.cinema_upload_owner(p_auth_id,p_content_id);
  IF v_user IS NULL THEN RETURN jsonb_build_object('error','upload_not_allowed'); END IF;
  PERFORM 1 FROM public.cinema_memberships WHERE user_id=v_user FOR UPDATE;
  IF public.cinema_upload_owner(p_auth_id,p_content_id) IS NULL THEN RETURN jsonb_build_object('error','upload_not_allowed'); END IF;
  IF p_key IS NULL OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 2147483648 OR p_fingerprint IS NULL OR p_fingerprint !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('error','invalid_upload'); END IF;
  SELECT * INTO v_row FROM public.cinema_uploads WHERE creator_id=v_user AND create_key=p_key;
  IF FOUND AND (v_row.content_id<>p_content_id OR v_row.file_size<>p_size OR v_row.fingerprint<>p_fingerprint) THEN RETURN jsonb_build_object('error','idempotency_conflict'); END IF;
  SELECT * INTO v_row FROM public.cinema_uploads WHERE content_id=p_content_id;
  IF FOUND THEN
    IF v_row.file_size<>p_size OR v_row.fingerprint<>p_fingerprint THEN RETURN jsonb_build_object('error','upload_exists'); END IF;
    RETURN to_jsonb(v_row)||jsonb_build_object('claimed',false);
  END IF;
  IF (SELECT count(*) FROM public.cinema_uploads)>=100 OR (SELECT count(*) FROM public.cinema_uploads WHERE creator_id=v_user)>=10 THEN RETURN jsonb_build_object('error','upload_capacity_reached'); END IF;
  INSERT INTO public.cinema_uploads(content_id,creator_id,create_key,file_size,fingerprint)
    VALUES(p_content_id,v_user,p_key,p_size,p_fingerprint) RETURNING * INTO v_row;
  RETURN to_jsonb(v_row)||jsonb_build_object('claimed',true);
END $$;

CREATE OR REPLACE FUNCTION public.attach_cinema_upload(p_id UUID,p_uid TEXT,p_url TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row public.cinema_uploads%ROWTYPE;
BEGIN
  IF p_uid IS NULL OR p_uid !~ '^[A-Za-z0-9]{32}$' OR p_url IS NULL OR length(p_url)>2048
    OR p_url !~ '^https://upload\.(videodelivery\.net|cloudflarestream\.com)/[^[:space:]#]+$' THEN RETURN jsonb_build_object('error','invalid_upload'); END IF;
  SELECT * INTO v_row FROM public.cinema_uploads WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','upload_not_found'); END IF;
  IF v_row.stream_uid IS NOT NULL THEN
    IF v_row.stream_uid<>p_uid OR v_row.upload_url<>p_url THEN RETURN jsonb_build_object('error','idempotency_conflict'); END IF;
    RETURN jsonb_build_object('ok',true);
  END IF;
  UPDATE public.cinema_uploads SET stream_uid=p_uid,upload_url=p_url,state='uploading' WHERE id=p_id;
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.read_cinema_upload(p_auth_id TEXT,p_content_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row public.cinema_uploads%ROWTYPE;
BEGIN
  IF public.cinema_upload_owner(p_auth_id,p_content_id) IS NULL THEN RETURN jsonb_build_object('error','upload_not_allowed'); END IF;
  SELECT * INTO v_row FROM public.cinema_uploads WHERE content_id=p_content_id;
  RETURN jsonb_build_object('upload',CASE WHEN FOUND THEN to_jsonb(v_row) ELSE NULL END);
END $$;

CREATE OR REPLACE FUNCTION public.observe_cinema_upload(p_uid TEXT,p_state TEXT,p_observed_at TIMESTAMPTZ,p_duration NUMERIC,p_width INTEGER,p_height INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row public.cinema_uploads%ROWTYPE;
BEGIN
  IF p_uid IS NULL OR p_state IS NULL OR p_state NOT IN ('processing','ready','error') OR p_observed_at IS NULL
    OR p_observed_at>now()+interval '5 seconds' THEN RETURN jsonb_build_object('error','invalid_observation'); END IF;
  IF p_state='ready' AND (p_duration IS NULL OR p_duration NOT BETWEEN 0.1 AND 600 OR p_width IS NULL OR p_width<1 OR p_height IS NULL OR p_height<1) THEN RETURN jsonb_build_object('error','invalid_observation'); END IF;
  SELECT * INTO v_row FROM public.cinema_uploads WHERE stream_uid=p_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ignored',true); END IF;
  IF v_row.state IN ('ready','error') OR (v_row.observed_at IS NOT NULL AND v_row.observed_at>=p_observed_at) THEN RETURN jsonb_build_object('ok',true,'idempotent',true); END IF;
  UPDATE public.cinema_uploads SET state=p_state,observed_at=p_observed_at,duration_seconds=p_duration,width=p_width,height=p_height,
    upload_url=CASE WHEN p_state IN ('ready','error') THEN NULL ELSE upload_url END WHERE id=v_row.id;
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.reserve_cinema_upload(TEXT,UUID,UUID,BIGINT,TEXT),public.attach_cinema_upload(UUID,TEXT,TEXT),public.read_cinema_upload(TEXT,UUID),public.observe_cinema_upload(TEXT,TEXT,TIMESTAMPTZ,NUMERIC,INTEGER,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_cinema_upload(TEXT,UUID,UUID,BIGINT,TEXT),public.attach_cinema_upload(UUID,TEXT,TEXT),public.read_cinema_upload(TEXT,UUID),public.observe_cinema_upload(TEXT,TEXT,TIMESTAMPTZ,NUMERIC,INTEGER,INTEGER) TO service_role;
