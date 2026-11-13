-- Private, handle-addressed Music workspace collaboration. Shared workspaces
-- are read-only for collaborators in this increment; owners alone invite and
-- retain all song/workspace mutations.

CREATE TABLE IF NOT EXISTS public.music_collaboration_profiles (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE RESTRICT,
    handle TEXT NOT NULL UNIQUE CHECK (handle ~ '^[a-z][a-z0-9_]{2,29}$'),
    display_name TEXT NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.music_workspace_members (
    workspace_id UUID NOT NULL REFERENCES public.music_workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    role TEXT NOT NULL CHECK (role IN ('owner','collaborator')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','left')),
    invited_by UUID REFERENCES public.users(id) ON DELETE RESTRICT,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,user_id)
);
CREATE TABLE IF NOT EXISTS public.music_workspace_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.music_workspaces(id) ON DELETE CASCADE,
    inviter_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    invitee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    invitee_handle TEXT NOT NULL CHECK (invitee_handle ~ '^[a-z][a-z0-9_]{2,29}$'),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','revoked')),
    idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._-]{8,120}$'),
    response_key TEXT CHECK (response_key IS NULL OR response_key ~ '^[A-Za-z0-9._-]{8,120}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), responded_at TIMESTAMPTZ,
    UNIQUE(inviter_id,idempotency_key), UNIQUE(invitee_id,response_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS music_workspace_one_pending_invite
 ON public.music_workspace_invitations(workspace_id,invitee_id) WHERE status='pending';

DO $$ DECLARE t TEXT; BEGIN FOREACH t IN ARRAY ARRAY[
 'music_collaboration_profiles','music_workspace_members','music_workspace_invitations'
] LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.%I TO service_role',t);
END LOOP; END $$;

INSERT INTO public.music_workspace_members(workspace_id,user_id,role)
SELECT id,user_id,'owner' FROM public.music_workspaces ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION private.music_workspace_owner_member()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 INSERT INTO public.music_workspace_members(workspace_id,user_id,role)
 VALUES(NEW.id,NEW.user_id,'owner') ON CONFLICT DO NOTHING; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION private.music_workspace_owner_member() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS music_workspace_owner_member ON public.music_workspaces;
CREATE TRIGGER music_workspace_owner_member AFTER INSERT ON public.music_workspaces
FOR EACH ROW EXECUTE FUNCTION private.music_workspace_owner_member();

CREATE OR REPLACE FUNCTION public.music_set_collaboration_profile(p_auth_id TEXT,p_handle TEXT,p_display_name TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; BEGIN
 IF p_handle !~ '^[a-z][a-z0-9_]{2,29}$' OR char_length(btrim(p_display_name)) NOT BETWEEN 1 AND 80
 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 INSERT INTO public.music_collaboration_profiles(user_id,handle,display_name) VALUES(v_user,p_handle,btrim(p_display_name))
 ON CONFLICT(user_id) DO UPDATE SET handle=EXCLUDED.handle,display_name=EXCLUDED.display_name,updated_at=now();
 RETURN jsonb_build_object('ok',true,'profile',jsonb_build_object('handle',p_handle,'display_name',btrim(p_display_name)));
EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'code','HANDLE_TAKEN'); END $$;

CREATE OR REPLACE FUNCTION public.music_invite_workspace(p_auth_id TEXT,p_workspace_id UUID,p_handle TEXT,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner UUID; v_invitee UUID; v_existing public.music_workspace_invitations%ROWTYPE; v_id UUID; BEGIN
 SELECT id INTO v_owner FROM public.users WHERE auth_id=p_auth_id;
 SELECT user_id INTO v_invitee FROM public.music_collaboration_profiles WHERE handle=p_handle;
 IF v_owner IS NULL OR v_invitee IS NULL THEN RETURN jsonb_build_object('ok',false,'code','HANDLE_NOT_FOUND'); END IF;
 IF v_owner=v_invitee THEN RETURN jsonb_build_object('ok',false,'code','SELF_INVITE'); END IF;
 PERFORM id FROM public.music_workspaces WHERE id=p_workspace_id AND user_id=v_owner AND status='active' AND NOT is_default FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 SELECT * INTO v_existing FROM public.music_workspace_invitations WHERE inviter_id=v_owner AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF v_existing.workspace_id<>p_workspace_id OR v_existing.invitee_id<>v_invitee THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  RETURN jsonb_build_object('ok',true,'idempotent',true,'invitation_id',v_existing.id);
 END IF;
 IF EXISTS(SELECT 1 FROM public.music_workspace_members WHERE workspace_id=p_workspace_id AND user_id=v_invitee AND status='active')
 THEN RETURN jsonb_build_object('ok',false,'code','ALREADY_MEMBER'); END IF;
 IF (SELECT count(*) FROM public.music_workspace_members WHERE workspace_id=p_workspace_id AND status='active')>=10
 THEN RETURN jsonb_build_object('ok',false,'code','LIMIT_REACHED'); END IF;
 INSERT INTO public.music_workspace_invitations(workspace_id,inviter_id,invitee_id,invitee_handle,idempotency_key)
 VALUES(p_workspace_id,v_owner,v_invitee,p_handle,p_idempotency_key) RETURNING id INTO v_id;
 RETURN jsonb_build_object('ok',true,'idempotent',false,'invitation_id',v_id);
EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'code','INVITE_PENDING'); END $$;

CREATE OR REPLACE FUNCTION public.music_respond_workspace_invite(p_auth_id TEXT,p_invitation_id UUID,p_decision TEXT,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_i public.music_workspace_invitations%ROWTYPE; v_target TEXT; BEGIN
 IF p_decision NOT IN ('accept','decline') THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 SELECT * INTO v_i FROM public.music_workspace_invitations WHERE id=p_invitation_id AND invitee_id=v_user FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 v_target:=CASE p_decision WHEN 'accept' THEN 'accepted' ELSE 'declined' END;
 IF v_i.status<>'pending' THEN RETURN CASE WHEN v_i.status=v_target THEN jsonb_build_object('ok',true,'idempotent',true,'status',v_i.status)
  ELSE jsonb_build_object('ok',false,'code','INVITATION_CLOSED') END; END IF;
 PERFORM id FROM public.music_workspaces WHERE id=v_i.workspace_id FOR UPDATE;
 IF p_decision='accept' THEN
  IF (SELECT count(*) FROM public.music_workspace_members WHERE workspace_id=v_i.workspace_id AND status='active')>=10
  THEN RETURN jsonb_build_object('ok',false,'code','LIMIT_REACHED'); END IF;
  INSERT INTO public.music_workspace_members(workspace_id,user_id,role,invited_by)
  VALUES(v_i.workspace_id,v_user,'collaborator',v_i.inviter_id)
  ON CONFLICT(workspace_id,user_id) DO UPDATE SET role='collaborator',status='active',invited_by=EXCLUDED.invited_by,joined_at=now();
 END IF;
 UPDATE public.music_workspace_invitations SET status=v_target,response_key=p_idempotency_key,responded_at=now() WHERE id=v_i.id;
 RETURN jsonb_build_object('ok',true,'idempotent',false,'status',v_target);
END $$;

CREATE OR REPLACE FUNCTION public.music_read_collaboration(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_profile JSONB; v_invites JSONB; v_spaces JSONB; BEGIN
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 SELECT jsonb_build_object('handle',handle,'display_name',display_name) INTO v_profile FROM public.music_collaboration_profiles WHERE user_id=v_user;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',i.id,'workspace_id',w.id,'workspace_name',w.name,
  'inviter_handle',COALESCE(p.handle,'owner'),'inviter_name',COALESCE(p.display_name,'Workspace owner'),'created_at',i.created_at)
  ORDER BY i.created_at DESC),'[]'::jsonb) INTO v_invites
 FROM public.music_workspace_invitations i JOIN public.music_workspaces w ON w.id=i.workspace_id
 LEFT JOIN public.music_collaboration_profiles p ON p.user_id=i.inviter_id WHERE i.invitee_id=v_user AND i.status='pending';
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'role',m.role,'is_default',w.is_default,
  'member_count',(SELECT count(*) FROM public.music_workspace_members x WHERE x.workspace_id=w.id AND x.status='active'),
  'members',(SELECT COALESCE(jsonb_agg(jsonb_build_object('handle',COALESCE(cp.handle,'owner'),'display_name',COALESCE(cp.display_name,'Workspace owner'),'role',mm.role) ORDER BY mm.role DESC,cp.handle),'[]'::jsonb) FROM public.music_workspace_members mm LEFT JOIN public.music_collaboration_profiles cp ON cp.user_id=mm.user_id WHERE mm.workspace_id=w.id AND mm.status='active'),
  'songs',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'audio_url','/api/v1/jobs/'||v.job_id||'/asset') ORDER BY s.created_at DESC),'[]'::jsonb) FROM public.music_songs s JOIN public.music_song_versions v ON v.id=s.current_version_id WHERE s.workspace_id=w.id AND s.user_id=w.user_id AND s.status='active')) ORDER BY w.updated_at DESC),'[]'::jsonb) INTO v_spaces
 FROM public.music_workspace_members m JOIN public.music_workspaces w ON w.id=m.workspace_id AND w.status='active'
 WHERE m.user_id=v_user AND m.status='active' AND NOT w.is_default;
 RETURN jsonb_build_object('ok',true,'profile',COALESCE(v_profile,'null'::jsonb),'invitations',v_invites,'workspaces',v_spaces);
END $$;

DO $$ DECLARE fn TEXT; BEGIN FOREACH fn IN ARRAY ARRAY[
 'public.music_set_collaboration_profile(TEXT,TEXT,TEXT)','public.music_invite_workspace(TEXT,UUID,TEXT,TEXT)',
 'public.music_respond_workspace_invite(TEXT,UUID,TEXT,TEXT)','public.music_read_collaboration(TEXT)'
] LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',fn);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn); END LOOP; END $$;
