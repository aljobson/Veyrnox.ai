-- 0403: team changes and invite revocation refuse callers who are not on the brand.
--
-- 0305 checked the caller's role with `IF v_role NOT IN ('owner','manager')`.
-- social_brand_role() returns NULL for someone with no role on the brand, and
-- `NULL NOT IN (...)` is NULL, so the FORBIDDEN branch never ran: a non-member
-- could change members' roles, remove members, or revoke pending invites on any
-- brand. The bodies below are 0305's with one change each: a missing role now
-- returns BRAND_NOT_FOUND first, the same answer list_social_team and
-- invite_social_team_member already give, so a non-member also cannot learn
-- whether the brand exists.
BEGIN;

CREATE OR REPLACE FUNCTION public.change_social_team_member(p_auth_id TEXT,p_brand_id UUID,p_member_user_id UUID,p_action TEXT,p_role TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor UUID;v_actor_role TEXT;v_member public.social_brand_members%ROWTYPE;
BEGIN
  SELECT id INTO v_actor FROM public.users WHERE auth_id=p_auth_id;
  v_actor_role:=public.social_brand_role(p_auth_id,p_brand_id);
  IF v_actor_role IS NULL THEN RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND'); END IF;
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
  IF v_role IS NULL THEN RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND'); END IF;
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
  'public.change_social_team_member(text,uuid,uuid,text,text)','public.revoke_social_team_invite(text,uuid,uuid)'
] LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||fn||' FROM PUBLIC,anon,authenticated';EXECUTE 'GRANT EXECUTE ON FUNCTION '||fn||' TO service_role';END LOOP;END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
