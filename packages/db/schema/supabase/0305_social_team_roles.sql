-- 0305: paid Publish brand teams, scoped roles, invitations and immutable audit.
BEGIN;

CREATE TABLE IF NOT EXISTS public.social_brand_members (
    brand_id UUID NOT NULL REFERENCES public.social_brands(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('manager','editor','reviewer','analyst','viewer')),
    invited_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (brand_id,user_id)
);
CREATE INDEX IF NOT EXISTS social_brand_members_user_idx ON public.social_brand_members(user_id,brand_id);
CREATE INDEX IF NOT EXISTS social_brand_members_inviter_idx ON public.social_brand_members(invited_by);
ALTER TABLE public.social_brand_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_brand_members FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_brand_members FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.social_brand_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES public.social_brands(id) ON DELETE CASCADE,
    email TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
    role TEXT NOT NULL CHECK (role IN ('manager','editor','reviewer','analyst','viewer')),
    invited_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired')),
    accepted_by UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS social_brand_invitations_pending_email_idx
    ON public.social_brand_invitations(brand_id,lower(email)) WHERE status='pending';
CREATE INDEX IF NOT EXISTS social_brand_invitations_brand_created_idx ON public.social_brand_invitations(brand_id,created_at DESC);
CREATE INDEX IF NOT EXISTS social_brand_invitations_inviter_idx ON public.social_brand_invitations(invited_by);
CREATE INDEX IF NOT EXISTS social_brand_invitations_acceptor_idx ON public.social_brand_invitations(accepted_by);
ALTER TABLE public.social_brand_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_brand_invitations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_brand_invitations FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.social_team_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES public.social_brands(id) ON DELETE RESTRICT,
    actor_user_id UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
    member_user_id UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
    invitation_id UUID NULL REFERENCES public.social_brand_invitations(id) ON DELETE SET NULL,
    action TEXT NOT NULL CHECK (action IN ('invited','accepted','role_changed','removed','invite_revoked')),
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_team_events_brand_created_idx ON public.social_team_events(brand_id,created_at DESC);
CREATE INDEX IF NOT EXISTS social_team_events_actor_idx ON public.social_team_events(actor_user_id);
CREATE INDEX IF NOT EXISTS social_team_events_member_idx ON public.social_team_events(member_user_id);
CREATE INDEX IF NOT EXISTS social_team_events_invitation_idx ON public.social_team_events(invitation_id);
ALTER TABLE public.social_team_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_team_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_team_events FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.social_team_events_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'social_team_events is append-only (attempted %)',TG_OP; END $$;
DROP TRIGGER IF EXISTS social_team_events_append_only ON public.social_team_events;
CREATE TRIGGER social_team_events_append_only BEFORE UPDATE OR DELETE ON public.social_team_events
FOR EACH ROW EXECUTE FUNCTION public.social_team_events_append_only();
DROP TRIGGER IF EXISTS social_team_events_no_truncate ON public.social_team_events;
CREATE TRIGGER social_team_events_no_truncate BEFORE TRUNCATE ON public.social_team_events
FOR EACH STATEMENT EXECUTE FUNCTION public.social_team_events_append_only();

CREATE OR REPLACE FUNCTION public.social_brand_role(p_auth_id TEXT,p_brand_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT CASE WHEN b.owner_user_id=u.id THEN 'owner' ELSE m.role END
  FROM public.users u JOIN auth.users a ON a.id=CASE WHEN p_auth_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN p_auth_id::UUID ELSE NULL END AND u.auth_id=p_auth_id
  JOIN public.social_brands b ON b.id=p_brand_id
  LEFT JOIN public.social_brand_members m ON m.brand_id=b.id AND m.user_id=u.id
  WHERE p_auth_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (b.owner_user_id=u.id OR m.user_id IS NOT NULL)
$$;

CREATE OR REPLACE FUNCTION public.list_social_team(p_auth_id TEXT,p_brand_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_role TEXT;
BEGIN
  v_role:=public.social_brand_role(p_auth_id,p_brand_id);
  IF v_role IS NULL THEN RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND'); END IF;
  IF v_role NOT IN ('owner','manager') THEN RETURN jsonb_build_object('ok',false,'code','FORBIDDEN'); END IF;
  RETURN jsonb_build_object('ok',true,'brand_id',p_brand_id,'brand_name',(SELECT label FROM public.social_brands WHERE id=p_brand_id),'actor_role',v_role,
    'members',coalesce((SELECT jsonb_agg(x ORDER BY CASE x->>'role' WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END,x->>'email') FROM (
      SELECT jsonb_build_object('user_id',u.id,'email',u.email,'role','owner','joined_at',b.created_at) x FROM public.social_brands b JOIN public.users u ON u.id=b.owner_user_id WHERE b.id=p_brand_id
      UNION ALL
      SELECT jsonb_build_object('user_id',u.id,'email',u.email,'role',m.role,'joined_at',m.joined_at) x FROM public.social_brand_members m JOIN public.users u ON u.id=m.user_id WHERE m.brand_id=p_brand_id
    ) q),'[]'::jsonb),
    'invitations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'role',i.role,'status',i.status,'expires_at',i.expires_at,'created_at',i.created_at) ORDER BY i.created_at DESC)
      FROM public.social_brand_invitations i WHERE i.brand_id=p_brand_id AND i.status='pending'),'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.invite_social_team_member(p_auth_id TEXT,p_brand_id UUID,p_email TEXT,p_role TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor UUID;v_actor_role TEXT;v_invite public.social_brand_invitations%ROWTYPE;
BEGIN
  SELECT id INTO v_actor FROM public.users WHERE auth_id=p_auth_id;
  v_actor_role:=public.social_brand_role(p_auth_id,p_brand_id);
  IF v_actor_role IS NULL THEN RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND'); END IF;
  IF v_actor_role NOT IN ('owner','manager') OR v_actor_role='manager' AND p_role='manager' THEN RETURN jsonb_build_object('ok',false,'code','FORBIDDEN'); END IF;
  IF p_role NOT IN ('manager','editor','reviewer','analyst','viewer') OR p_email IS NULL OR char_length(btrim(p_email)) NOT BETWEEN 3 AND 254
    OR btrim(p_email) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INVITE'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_publish_subscriptions s JOIN public.social_brands b ON b.owner_user_id=s.user_id
    WHERE b.id=p_brand_id AND s.status IN ('active','past_due') AND s.current_period_end>now()) THEN RETURN jsonb_build_object('ok',false,'code','PLAN_REQUIRED'); END IF;
  IF (SELECT count(*) FROM public.social_brand_members WHERE brand_id=p_brand_id)>=24 THEN RETURN jsonb_build_object('ok',false,'code','TEAM_LIMIT'); END IF;
  IF EXISTS(SELECT 1 FROM public.users u JOIN public.social_brands b ON b.owner_user_id=u.id WHERE b.id=p_brand_id AND lower(u.email)=lower(btrim(p_email)))
    OR EXISTS(SELECT 1 FROM public.social_brand_members m JOIN public.users u ON u.id=m.user_id WHERE m.brand_id=p_brand_id AND lower(u.email)=lower(btrim(p_email)))
    THEN RETURN jsonb_build_object('ok',false,'code','MEMBER_EXISTS'); END IF;
  IF (SELECT count(*) FROM public.social_team_events WHERE actor_user_id=v_actor AND created_at>now()-interval '1 minute')>=20 THEN RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED'); END IF;
  UPDATE public.social_brand_invitations SET status='expired',updated_at=now() WHERE brand_id=p_brand_id AND status='pending' AND expires_at<=now();
  SELECT * INTO v_invite FROM public.social_brand_invitations WHERE brand_id=p_brand_id AND lower(email)=lower(btrim(p_email)) AND status='pending' FOR UPDATE;
  IF FOUND THEN
    IF v_invite.role<>p_role THEN RETURN jsonb_build_object('ok',false,'code','INVITE_EXISTS'); END IF;
    RETURN jsonb_build_object('ok',true,'idempotent',true,'invite_id',v_invite.id,'email',v_invite.email,'role',v_invite.role,'expires_at',v_invite.expires_at);
  END IF;
  INSERT INTO public.social_brand_invitations(brand_id,email,role,invited_by,expires_at)
    VALUES(p_brand_id,lower(btrim(p_email)),p_role,v_actor,now()+interval '7 days') RETURNING * INTO v_invite;
  INSERT INTO public.social_team_events(brand_id,actor_user_id,invitation_id,action,detail)
    VALUES(p_brand_id,v_actor,v_invite.id,'invited',jsonb_build_object('email',v_invite.email,'role',p_role));
  RETURN jsonb_build_object('ok',true,'idempotent',false,'invite_id',v_invite.id,'email',v_invite.email,'role',v_invite.role,'expires_at',v_invite.expires_at);
END $$;

CREATE OR REPLACE FUNCTION public.get_social_team_invite(p_invite_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce((SELECT jsonb_build_object('ok',true,'invite_id',i.id,'email',i.email,'role',i.role,'status',
    CASE WHEN i.status='pending' AND i.expires_at<=now() THEN 'expired' ELSE i.status END,'expires_at',i.expires_at,'brand_id',b.id,'brand_name',b.label)
    FROM public.social_brand_invitations i JOIN public.social_brands b ON b.id=i.brand_id WHERE i.id=p_invite_id),jsonb_build_object('ok',false,'code','INVITE_NOT_FOUND'))
$$;

CREATE OR REPLACE FUNCTION public.accept_social_team_invite(p_auth_id TEXT,p_invite_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user public.users%ROWTYPE;v_invite public.social_brand_invitations%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE auth_id=p_auth_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
  SELECT * INTO v_invite FROM public.social_brand_invitations WHERE id=p_invite_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','INVITE_NOT_FOUND'); END IF;
  IF v_invite.status='accepted' AND v_invite.accepted_by=v_user.id THEN RETURN jsonb_build_object('ok',true,'idempotent',true,'brand_id',v_invite.brand_id,'role',v_invite.role); END IF;
  IF v_invite.status<>'pending' OR v_invite.expires_at<=now() THEN RETURN jsonb_build_object('ok',false,'code','INVITE_UNAVAILABLE'); END IF;
  IF lower(v_user.email)<>lower(v_invite.email) THEN RETURN jsonb_build_object('ok',false,'code','EMAIL_MISMATCH'); END IF;
  INSERT INTO public.social_brand_members(brand_id,user_id,role,invited_by) VALUES(v_invite.brand_id,v_user.id,v_invite.role,v_invite.invited_by)
    ON CONFLICT(brand_id,user_id) DO UPDATE SET role=EXCLUDED.role,updated_at=now();
  UPDATE public.social_brand_invitations SET status='accepted',accepted_by=v_user.id,updated_at=now() WHERE id=v_invite.id;
  INSERT INTO public.social_team_events(brand_id,actor_user_id,member_user_id,invitation_id,action,detail)
    VALUES(v_invite.brand_id,v_user.id,v_user.id,v_invite.id,'accepted',jsonb_build_object('role',v_invite.role));
  RETURN jsonb_build_object('ok',true,'idempotent',false,'brand_id',v_invite.brand_id,'role',v_invite.role);
END $$;

CREATE OR REPLACE FUNCTION public.change_social_team_member(p_auth_id TEXT,p_brand_id UUID,p_member_user_id UUID,p_action TEXT,p_role TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor UUID;v_actor_role TEXT;v_member public.social_brand_members%ROWTYPE;
BEGIN
  SELECT id INTO v_actor FROM public.users WHERE auth_id=p_auth_id;
  v_actor_role:=public.social_brand_role(p_auth_id,p_brand_id);
  IF v_actor_role NOT IN ('owner','manager') THEN RETURN jsonb_build_object('ok',false,'code','FORBIDDEN'); END IF;
  SELECT * INTO v_member FROM public.social_brand_members WHERE brand_id=p_brand_id AND user_id=p_member_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','MEMBER_NOT_FOUND'); END IF;
  IF v_actor_role='manager' AND (v_member.role='manager' OR p_role='manager') THEN RETURN jsonb_build_object('ok',false,'code','FORBIDDEN'); END IF;
  IF p_action='role' THEN
    IF p_role NOT IN ('manager','editor','reviewer','analyst','viewer') THEN RETURN jsonb_build_object('ok',false,'code','INVALID_ROLE'); END IF;
    UPDATE public.social_brand_members SET role=p_role,updated_at=now() WHERE brand_id=p_brand_id AND user_id=p_member_user_id;
    INSERT INTO public.social_team_events(brand_id,actor_user_id,member_user_id,action,detail) VALUES(p_brand_id,v_actor,p_member_user_id,'role_changed',jsonb_build_object('from',v_member.role,'to',p_role));
  ELSIF p_action='remove' THEN
    DELETE FROM public.social_brand_members WHERE brand_id=p_brand_id AND user_id=p_member_user_id;
    INSERT INTO public.social_team_events(brand_id,actor_user_id,member_user_id,action,detail) VALUES(p_brand_id,v_actor,p_member_user_id,'removed',jsonb_build_object('role',v_member.role));
  ELSE RETURN jsonb_build_object('ok',false,'code','INVALID_ACTION'); END IF;
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.revoke_social_team_invite(p_auth_id TEXT,p_brand_id UUID,p_invite_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor UUID;v_role TEXT;v_invite public.social_brand_invitations%ROWTYPE;
BEGIN
  SELECT id INTO v_actor FROM public.users WHERE auth_id=p_auth_id;v_role:=public.social_brand_role(p_auth_id,p_brand_id);
  IF v_role NOT IN ('owner','manager') THEN RETURN jsonb_build_object('ok',false,'code','FORBIDDEN'); END IF;
  SELECT * INTO v_invite FROM public.social_brand_invitations WHERE id=p_invite_id AND brand_id=p_brand_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','INVITE_NOT_FOUND'); END IF;
  IF v_role='manager' AND v_invite.role='manager' THEN RETURN jsonb_build_object('ok',false,'code','FORBIDDEN'); END IF;
  IF v_invite.status<>'pending' THEN RETURN jsonb_build_object('ok',true,'idempotent',true); END IF;
  UPDATE public.social_brand_invitations SET status='revoked',updated_at=now() WHERE id=p_invite_id;
  INSERT INTO public.social_team_events(brand_id,actor_user_id,invitation_id,action,detail) VALUES(p_brand_id,v_actor,p_invite_id,'invite_revoked',jsonb_build_object('email',v_invite.email));
  RETURN jsonb_build_object('ok',true,'idempotent',false);
END $$;

DO $$ DECLARE fn TEXT;BEGIN FOREACH fn IN ARRAY ARRAY[
  'public.social_brand_role(text,uuid)','public.list_social_team(text,uuid)','public.invite_social_team_member(text,uuid,text,text)',
  'public.get_social_team_invite(uuid)','public.accept_social_team_invite(text,uuid)',
  'public.change_social_team_member(text,uuid,uuid,text,text)','public.revoke_social_team_invite(text,uuid,uuid)'
] LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||fn||' FROM PUBLIC,anon,authenticated';EXECUTE 'GRANT EXECUTE ON FUNCTION '||fn||' TO service_role';END LOOP;END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
