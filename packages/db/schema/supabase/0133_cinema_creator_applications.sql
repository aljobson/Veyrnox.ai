-- Cinema creator applications; no monetisation, payout or publishing privileges.
CREATE TABLE IF NOT EXISTS public.cinema_creator_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  statement TEXT NOT NULL CHECK (length(btrim(statement)) BETWEEN 20 AND 1000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  create_key UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS public.cinema_creator_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  idempotency_key UUID NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(actor_id,idempotency_key),
  UNIQUE(application_id)
);
-- Reviews intentionally retain opaque IDs after account deletion. No profile,
-- contact data or financial data is copied into the audit record.
CREATE INDEX IF NOT EXISTS cinema_creator_pending_idx ON public.cinema_creator_applications(created_at,id) WHERE status='pending';
ALTER TABLE public.cinema_creator_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_creator_applications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_creator_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_creator_reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_creator_applications,public.cinema_creator_reviews FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.cinema_creator_review_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'creator review is append only'; END $$;
REVOKE ALL ON FUNCTION public.cinema_creator_review_immutable() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS cinema_creator_review_immutable ON public.cinema_creator_reviews;
CREATE TRIGGER cinema_creator_review_immutable BEFORE UPDATE OR DELETE ON public.cinema_creator_reviews
FOR EACH ROW EXECUTE FUNCTION public.cinema_creator_review_immutable();

CREATE OR REPLACE FUNCTION public.apply_cinema_creator(p_auth_id TEXT,p_idempotency_key UUID,p_statement TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_member public.cinema_memberships%ROWTYPE; v_row public.cinema_creator_applications%ROWTYPE;
BEGIN
  IF p_idempotency_key IS NULL OR p_statement IS NULL OR length(btrim(p_statement)) NOT BETWEEN 20 AND 1000 THEN
    RETURN jsonb_build_object('error','invalid_application');
  END IF;
  SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id FOR UPDATE;
  SELECT * INTO v_member FROM public.cinema_memberships WHERE user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','profile_required'); END IF;
  IF v_member.account_status<>'active' THEN RETURN jsonb_build_object('error','account_not_active'); END IF;
  SELECT * INTO v_row FROM public.cinema_creator_applications WHERE user_id=v_user;
  IF FOUND THEN
    IF v_row.create_key=p_idempotency_key AND v_row.statement=btrim(p_statement) THEN
      RETURN jsonb_build_object('id',v_row.id,'status',v_row.status,'idempotent',true);
    END IF;
    RETURN jsonb_build_object('error',CASE WHEN v_row.create_key=p_idempotency_key THEN 'idempotency_conflict' ELSE 'application_exists' END);
  END IF;
  IF v_member.role<>'viewer' THEN RETURN jsonb_build_object('error','role_not_eligible'); END IF;
  INSERT INTO public.cinema_creator_applications(user_id,statement,create_key)
    VALUES(v_user,btrim(p_statement),p_idempotency_key) RETURNING * INTO v_row;
  RETURN jsonb_build_object('id',v_row.id,'status',v_row.status,'idempotent',false);
END $$;

CREATE OR REPLACE FUNCTION public.read_own_cinema_application(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_status TEXT; v_app JSONB;
BEGIN
  SELECT u.id,m.account_status INTO v_user,v_status FROM public.users u JOIN public.cinema_memberships m ON m.user_id=u.id WHERE u.auth_id=p_auth_id;
  IF v_user IS NULL THEN RETURN jsonb_build_object('error','profile_required'); END IF;
  IF v_status<>'active' THEN RETURN jsonb_build_object('error','account_not_active'); END IF;
  SELECT jsonb_build_object('id',id,'statement',statement,'status',status,'created_at',created_at,'reviewed_at',reviewed_at)
    INTO v_app FROM public.cinema_creator_applications WHERE user_id=v_user;
  RETURN jsonb_build_object('application',v_app);
END $$;

CREATE OR REPLACE FUNCTION public.list_cinema_creator_applications(p_auth_id TEXT,p_aal TEXT,p_mfa_at BIGINT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_aal IS DISTINCT FROM 'aal2' OR p_mfa_at IS NULL OR p_mfa_at < extract(epoch FROM now())-300 OR p_mfa_at > extract(epoch FROM now())+5
    OR NOT EXISTS(SELECT 1 FROM public.users u JOIN public.cinema_memberships m ON m.user_id=u.id WHERE u.auth_id=p_auth_id AND m.role='administrator' AND m.account_status='active') THEN
    RETURN jsonb_build_object('error','not_authorized');
  END IF;
  RETURN jsonb_build_object('applications',coalesce((SELECT jsonb_agg(row_to_json(a)) FROM (
    SELECT a.id,a.statement,a.created_at,p.username,p.display_name
    FROM public.cinema_creator_applications a JOIN public.cinema_profiles p ON p.user_id=a.user_id
    JOIN public.cinema_memberships m ON m.user_id=a.user_id
    WHERE a.status='pending' AND m.account_status='active'
    ORDER BY a.created_at,a.id LIMIT 50
  ) a),'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.review_cinema_creator(p_auth_id TEXT,p_aal TEXT,p_mfa_at BIGINT,p_idempotency_key UUID,p_application_id UUID,p_decision TEXT,p_reason TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor UUID; v_app public.cinema_creator_applications%ROWTYPE; v_review public.cinema_creator_reviews%ROWTYPE; v_member public.cinema_memberships%ROWTYPE;
BEGIN
  IF p_aal IS DISTINCT FROM 'aal2' OR p_mfa_at IS NULL OR p_mfa_at < extract(epoch FROM now())-300 OR p_mfa_at > extract(epoch FROM now())+5 THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
  SELECT u.id INTO v_actor FROM public.users u JOIN public.cinema_memberships m ON m.user_id=u.id
    WHERE u.auth_id=p_auth_id AND m.role='administrator' AND m.account_status='active' FOR UPDATE OF m;
  IF v_actor IS NULL THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
  IF p_request_id IS NULL OR p_idempotency_key IS NULL OR p_application_id IS NULL OR p_decision IS NULL OR p_decision NOT IN ('approved','rejected')
    OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
    RETURN jsonb_build_object('error','invalid_review');
  END IF;
  SELECT * INTO v_review FROM public.cinema_creator_reviews WHERE actor_id=v_actor AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_review.application_id=p_application_id AND v_review.decision=p_decision AND v_review.reason=btrim(p_reason) THEN
      RETURN jsonb_build_object('id',p_application_id,'status',v_review.decision,'idempotent',true);
    END IF;
    RETURN jsonb_build_object('error','idempotency_conflict');
  END IF;
  SELECT * INTO v_app FROM public.cinema_creator_applications WHERE id=p_application_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','application_not_found'); END IF;
  IF v_app.user_id=v_actor THEN RETURN jsonb_build_object('error','self_review_forbidden'); END IF;
  IF v_app.status<>'pending' THEN RETURN jsonb_build_object('error','already_reviewed'); END IF;
  SELECT * INTO v_member FROM public.cinema_memberships WHERE user_id=v_app.user_id FOR UPDATE;
  IF NOT FOUND OR v_member.account_status<>'active' THEN RETURN jsonb_build_object('error','account_not_active'); END IF;
  IF p_decision='approved' AND v_member.role<>'viewer' THEN RETURN jsonb_build_object('error','role_not_eligible'); END IF;
  IF p_decision='approved' THEN UPDATE public.cinema_memberships SET role='creator' WHERE user_id=v_app.user_id; END IF;
  UPDATE public.cinema_creator_applications SET status=p_decision,reviewed_at=now() WHERE id=p_application_id;
  INSERT INTO public.cinema_creator_reviews(application_id,actor_id,idempotency_key,decision,reason,request_id)
    VALUES(p_application_id,v_actor,p_idempotency_key,p_decision,btrim(p_reason),p_request_id);
  RETURN jsonb_build_object('id',p_application_id,'status',p_decision,'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.apply_cinema_creator(TEXT,UUID,TEXT),public.read_own_cinema_application(TEXT),public.list_cinema_creator_applications(TEXT,TEXT,BIGINT),public.review_cinema_creator(TEXT,TEXT,BIGINT,UUID,UUID,TEXT,TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_cinema_creator(TEXT,UUID,TEXT),public.read_own_cinema_application(TEXT),public.list_cinema_creator_applications(TEXT,TEXT,BIGINT),public.review_cinema_creator(TEXT,TEXT,BIGINT,UUID,UUID,TEXT,TEXT,UUID) TO service_role;

-- G01: restricted, suspended and banned Cinema accounts cannot use profile APIs.
CREATE OR REPLACE FUNCTION public.create_cinema_profile(
    p_auth_id TEXT, p_idempotency_key UUID, p_profile JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user_id UUID;
    v_profile public.cinema_profiles%ROWTYPE;
    v_username TEXT;
    v_display_name TEXT;
    v_bio TEXT;
BEGIN
    IF p_auth_id IS NULL OR p_idempotency_key IS NULL OR p_profile IS NULL
        OR jsonb_typeof(p_profile) <> 'object' THEN
        RETURN jsonb_build_object('error','invalid_profile');
    END IF;
    -- No ownership, privilege, moderation or identity field can be supplied.
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_profile) AS k
               WHERE k NOT IN ('username','display_name','bio'))
        OR jsonb_typeof(p_profile->'username') IS DISTINCT FROM 'string'
        OR jsonb_typeof(p_profile->'display_name') IS DISTINCT FROM 'string'
        OR (p_profile ? 'bio' AND jsonb_typeof(p_profile->'bio') IS DISTINCT FROM 'string') THEN
        RETURN jsonb_build_object('error','invalid_profile');
    END IF;
    v_username := p_profile->>'username';
    v_display_name := btrim(p_profile->>'display_name');
    v_bio := coalesce(p_profile->>'bio','');
    IF v_username !~ '^[a-z][a-z0-9_]{2,29}$'
        OR length(v_display_name) NOT BETWEEN 1 AND 80 OR length(v_bio) > 500 THEN
        RETURN jsonb_build_object('error','invalid_profile');
    END IF;
    -- Serializes creation/replay for this existing identity. Never provisions a user.
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id FOR UPDATE;
    IF v_user_id IS NULL THEN RETURN jsonb_build_object('error','user_not_provisioned'); END IF;
    PERFORM 1 FROM public.cinema_memberships WHERE user_id=v_user_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM public.cinema_memberships WHERE user_id=v_user_id AND account_status<>'active') THEN
        RETURN jsonb_build_object('error','account_not_active');
    END IF;
    SELECT * INTO v_profile FROM public.cinema_profiles WHERE user_id = v_user_id;
    IF FOUND THEN
        IF v_profile.create_key = p_idempotency_key
            AND v_profile.username = v_username AND v_profile.display_name = v_display_name
            AND v_profile.bio = v_bio THEN
            RETURN jsonb_build_object('profile_id',v_profile.id,'idempotent',true);
        END IF;
        RETURN jsonb_build_object('error',CASE WHEN v_profile.create_key = p_idempotency_key
            THEN 'idempotency_conflict' ELSE 'profile_exists' END);
    END IF;
    BEGIN
        INSERT INTO public.cinema_profiles(user_id,username,display_name,bio,create_key)
        VALUES(v_user_id,v_username,v_display_name,v_bio,p_idempotency_key)
        RETURNING * INTO v_profile;
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('error','username_unavailable');
    END;
    -- Role/account state are server-owned and cannot be reset by a replay.
    INSERT INTO public.cinema_memberships(user_id) VALUES(v_user_id) ON CONFLICT DO NOTHING;
    RETURN jsonb_build_object('profile_id',v_profile.id,'idempotent',false);
END $$;


CREATE OR REPLACE FUNCTION public.read_own_cinema_profile(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_profile JSONB;
BEGIN
  IF EXISTS(SELECT 1 FROM public.users u JOIN public.cinema_memberships m ON m.user_id=u.id WHERE u.auth_id=p_auth_id AND m.account_status<>'active') THEN
    RETURN jsonb_build_object('error','account_not_active');
  END IF;
  SELECT jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'bio',p.bio,'role',m.role,'account_status',m.account_status)
  INTO v_profile FROM public.users u JOIN public.cinema_profiles p ON p.user_id=u.id JOIN public.cinema_memberships m ON m.user_id=u.id WHERE u.auth_id=p_auth_id;
  RETURN v_profile;
END $$;
REVOKE ALL ON FUNCTION public.create_cinema_profile(TEXT,UUID,JSONB),public.read_own_cinema_profile(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_cinema_profile(TEXT,UUID,JSONB),public.read_own_cinema_profile(TEXT) TO service_role;
