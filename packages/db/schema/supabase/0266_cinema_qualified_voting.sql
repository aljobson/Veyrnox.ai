-- 0266: competition-backed Cinema votes; no rankings, awards, Credits or money.
-- New routes remain gated by VOTING_ENABLED and the existing viewing/profile gates.
BEGIN;
CREATE TABLE IF NOT EXISTS public.cinema_competitions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
 starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
 target_types TEXT[] NOT NULL CHECK (cardinality(target_types) BETWEEN 1 AND 5 AND target_types <@ ARRAY['FILM','SHORT','TRAILER','SERIES','EPISODE']::TEXT[]),
 status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
 created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '31 days')
);
CREATE INDEX IF NOT EXISTS cinema_competitions_creator_idx ON public.cinema_competitions(created_by);
CREATE INDEX IF NOT EXISTS cinema_competitions_window_idx ON public.cinema_competitions(status,ends_at,starts_at);
CREATE TABLE IF NOT EXISTS public.cinema_votes (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 voter_id UUID NOT NULL REFERENCES public.cinema_profiles(user_id) ON DELETE CASCADE,
 content_id UUID NOT NULL REFERENCES public.cinema_content(id) ON DELETE CASCADE,
 competition_id UUID NOT NULL REFERENCES public.cinema_competitions(id) ON DELETE RESTRICT,
 idempotency_key UUID NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('qualified','under_review','rejected')),
 risk_reason TEXT NULL CHECK (risk_reason IS NULL OR risk_reason = 'velocity'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(voter_id,content_id,competition_id), UNIQUE(voter_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS cinema_votes_target_idx ON public.cinema_votes(content_id,competition_id,status);
CREATE INDEX IF NOT EXISTS cinema_votes_competition_idx ON public.cinema_votes(competition_id);
CREATE INDEX IF NOT EXISTS cinema_votes_velocity_idx ON public.cinema_votes(voter_id,created_at);
CREATE INDEX IF NOT EXISTS cinema_votes_review_idx ON public.cinema_votes(created_at,id) WHERE status='under_review';
CREATE TABLE IF NOT EXISTS public.cinema_community_actions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), actor_id UUID NOT NULL,
 idempotency_key UUID NOT NULL, action TEXT NOT NULL, target_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
 prior_status TEXT NULL, new_status TEXT NOT NULL,
 payload JSONB NOT NULL, result JSONB NOT NULL, request_id UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(actor_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS cinema_community_actions_target_idx ON public.cinema_community_actions(target_id,created_at);
ALTER TABLE public.cinema_competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_competitions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_votes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_community_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_community_actions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_competitions,public.cinema_votes,public.cinema_community_actions FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS cinema_community_actions_immutable ON public.cinema_community_actions;
CREATE TRIGGER cinema_community_actions_immutable BEFORE UPDATE OR DELETE ON public.cinema_community_actions
 FOR EACH ROW EXECUTE FUNCTION public.cinema_publication_append_only();
DROP TRIGGER IF EXISTS cinema_community_actions_no_truncate ON public.cinema_community_actions;
CREATE TRIGGER cinema_community_actions_no_truncate BEFORE TRUNCATE ON public.cinema_community_actions
 FOR EACH STATEMENT EXECUTE FUNCTION public.cinema_publication_append_only();

CREATE OR REPLACE FUNCTION public.cinema_community_actor(p_auth_id TEXT)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT u.id FROM public.users u JOIN auth.users a ON a.id::text=u.auth_id
 JOIN public.cinema_profiles p ON p.user_id=u.id
 JOIN public.cinema_memberships m ON m.user_id=u.id
 WHERE u.auth_id=p_auth_id AND m.account_status='active' AND u.frozen_at IS NULL;
$$;
CREATE OR REPLACE FUNCTION public.cinema_community_admin(p_auth_id TEXT,p_aal TEXT,p_mfa_at BIGINT)
RETURNS UUID LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT u.id FROM public.users u JOIN auth.users a ON a.id::text=u.auth_id
 JOIN public.cinema_memberships m ON m.user_id=u.id
 WHERE u.auth_id=p_auth_id AND m.role='administrator' AND m.account_status='active'
 AND u.frozen_at IS NULL AND p_aal='aal2' AND p_mfa_at BETWEEN extract(epoch FROM clock_timestamp())-300 AND extract(epoch FROM clock_timestamp())+5;
$$;
-- All ancestors must remain published/public; a hidden series cannot leak its episodes.
CREATE OR REPLACE FUNCTION public.cinema_community_root(p_content_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH RECURSIVE tree AS (
  SELECT c.*,0 AS depth FROM public.cinema_content c WHERE c.id=p_content_id
  UNION ALL SELECT c.*,t.depth+1 FROM public.cinema_content c JOIN tree t ON c.id=t.parent_id WHERE t.depth<2
 ) SELECT t.id FROM tree t WHERE t.parent_id IS NULL
 AND EXISTS(SELECT 1 FROM tree x WHERE x.id=p_content_id AND x.content_type IN ('FILM','SHORT','TRAILER','SERIES','EPISODE'))
 AND NOT EXISTS(SELECT 1 FROM tree x WHERE x.lifecycle_status<>'PUBLISHED' OR x.visibility<>'PUBLIC' OR x.creator_id<>t.creator_id)
 AND EXISTS(SELECT 1 FROM public.cinema_memberships m JOIN public.users u ON u.id=m.user_id
 JOIN auth.users a ON a.id::text=u.auth_id WHERE m.user_id=t.creator_id AND m.role='creator' AND m.account_status='active' AND u.frozen_at IS NULL);
$$;
CREATE OR REPLACE FUNCTION public.cast_cinema_vote(p_auth_id TEXT,p_idempotency_key UUID,p_content_id UUID,p_competition_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_root UUID; v_type TEXT; v_comp public.cinema_competitions%ROWTYPE;
 v_vote public.cinema_votes%ROWTYPE; v_status TEXT; v_recent BIGINT; v_now TIMESTAMPTZ;
BEGIN
 v_user:=public.cinema_community_actor(p_auth_id);
 IF v_user IS NULL THEN RETURN jsonb_build_object('error','profile_required'); END IF;
 IF p_idempotency_key IS NULL OR p_content_id IS NULL OR p_competition_id IS NULL THEN RETURN jsonb_build_object('error','invalid_vote'); END IF;
 PERFORM 1 FROM public.cinema_memberships WHERE user_id=v_user AND account_status='active' FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','account_not_active'); END IF;
 PERFORM pg_advisory_xact_lock(266,hashtext(v_user::text));
 IF public.cinema_community_actor(p_auth_id) IS DISTINCT FROM v_user THEN RETURN jsonb_build_object('error','account_not_active'); END IF;
 SELECT * INTO v_vote FROM public.cinema_votes WHERE voter_id=v_user AND idempotency_key=p_idempotency_key;
 IF FOUND AND (v_vote.content_id<>p_content_id OR v_vote.competition_id<>p_competition_id) THEN RETURN jsonb_build_object('error','idempotency_conflict'); END IF;
 v_root:=public.cinema_community_root(p_content_id);
 IF v_root IS NULL THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
 PERFORM 1 FROM public.cinema_content WHERE id=v_root FOR SHARE;
 IF public.cinema_community_root(p_content_id) IS NULL THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
 SELECT content_type INTO v_type FROM public.cinema_content WHERE id=p_content_id;
 SELECT * INTO v_comp FROM public.cinema_competitions WHERE id=p_competition_id FOR SHARE;
 IF NOT FOUND OR NOT (v_type=ANY(v_comp.target_types)) THEN RETURN jsonb_build_object('error','competition_not_found'); END IF;
 -- An existing ballot remains a replay after closure; no new ballot is created.
 SELECT * INTO v_vote FROM public.cinema_votes WHERE voter_id=v_user AND content_id=p_content_id AND competition_id=p_competition_id;
 IF FOUND THEN RETURN jsonb_build_object('id',v_vote.id,'status',v_vote.status,'idempotent',true); END IF;
 v_now:=clock_timestamp();
 IF public.cinema_community_actor(p_auth_id) IS DISTINCT FROM v_user THEN RETURN jsonb_build_object('error','account_not_active'); END IF;
 IF v_comp.status<>'open' OR v_now<v_comp.starts_at OR v_now>=v_comp.ends_at THEN RETURN jsonb_build_object('error','competition_closed'); END IF;
 IF (SELECT count(*) FROM public.cinema_votes WHERE voter_id=v_user AND created_at>v_now-interval '1 hour')>=60 THEN RETURN jsonb_build_object('error','rate_limited'); END IF;
 SELECT count(*) INTO v_recent FROM public.cinema_votes WHERE voter_id=v_user AND created_at>v_now-interval '1 minute';
 v_status:=CASE WHEN v_recent>=10 THEN 'under_review' ELSE 'qualified' END;
 INSERT INTO public.cinema_votes(voter_id,content_id,competition_id,idempotency_key,status,risk_reason,created_at)
 VALUES(v_user,p_content_id,p_competition_id,p_idempotency_key,v_status,CASE WHEN v_status='under_review' THEN 'velocity' END,v_now) RETURNING * INTO v_vote;
 RETURN jsonb_build_object('id',v_vote.id,'status',v_status,'idempotent',false);
END $$;
CREATE OR REPLACE FUNCTION public.read_cinema_voting(p_auth_id TEXT,p_content_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_type TEXT; v_result JSONB;
BEGIN
 IF public.cinema_community_root(p_content_id) IS NULL THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
 IF p_auth_id IS NOT NULL THEN
  v_user:=public.cinema_community_actor(p_auth_id);
  IF v_user IS NULL THEN RETURN jsonb_build_object('error','profile_required'); END IF;
 END IF;
 SELECT content_type INTO v_type FROM public.cinema_content WHERE id=p_content_id;
 SELECT coalesce(jsonb_agg(item ORDER BY starts_at,id),'[]'::jsonb) INTO v_result FROM (
  SELECT c.starts_at,c.id,jsonb_build_object('id',c.id,'name',c.name,'starts_at',c.starts_at,'ends_at',c.ends_at,
  'qualified_votes',(SELECT count(*) FROM public.cinema_votes v JOIN public.users u ON u.id=v.voter_id
    JOIN auth.users a ON a.id::text=u.auth_id JOIN public.cinema_memberships m ON m.user_id=u.id
    WHERE v.content_id=p_content_id AND v.competition_id=c.id AND v.status='qualified' AND m.account_status='active' AND u.frozen_at IS NULL),
  'my_vote',(SELECT jsonb_build_object('id',v.id,'status',v.status) FROM public.cinema_votes v WHERE v.voter_id=v_user AND v.content_id=p_content_id AND v.competition_id=c.id)) AS item
  FROM public.cinema_competitions c WHERE c.status='open' AND c.starts_at<=now() AND c.ends_at>now() AND v_type=ANY(c.target_types)
  ORDER BY c.starts_at,c.id LIMIT 25
 ) x;
 RETURN jsonb_build_object('competitions',v_result);
END $$;
CREATE OR REPLACE FUNCTION public.manage_cinema_voting(p_auth_id TEXT,p_aal TEXT,p_mfa_at BIGINT,p_idempotency_key UUID,p_payload JSONB,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor UUID; v_action TEXT; v_target UUID; v_prior TEXT; v_new TEXT; v_reason TEXT;
 v_start TIMESTAMPTZ; v_end TIMESTAMPTZ; v_types TEXT[]; v_result JSONB; v_old public.cinema_community_actions%ROWTYPE; v_vote public.cinema_votes%ROWTYPE;
BEGIN
 v_actor:=public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at);
 IF v_actor IS NULL THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
 PERFORM 1 FROM public.cinema_memberships WHERE user_id=v_actor AND role='administrator' AND account_status='active' FOR SHARE;
 IF NOT FOUND OR public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at) IS DISTINCT FROM v_actor THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
 IF p_idempotency_key IS NULL OR p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('error','invalid_action'); END IF;
 v_action:=p_payload->>'action'; v_reason:=btrim(p_payload->>'reason');
 IF jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' OR v_reason IS NULL OR length(v_reason) NOT BETWEEN 3 AND 500 THEN RETURN jsonb_build_object('error','invalid_action'); END IF;
 PERFORM pg_advisory_xact_lock(266,hashtext(v_actor::text));
 IF public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at) IS DISTINCT FROM v_actor THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
 SELECT * INTO v_old FROM public.cinema_community_actions WHERE actor_id=v_actor AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF v_old.payload IS DISTINCT FROM p_payload THEN RETURN jsonb_build_object('error','idempotency_conflict'); END IF;
  RETURN v_old.result||jsonb_build_object('idempotent',true);
 END IF;
 IF v_action='create_competition' THEN
  IF jsonb_typeof(p_payload->'target_types') IS DISTINCT FROM 'array' THEN RETURN jsonb_build_object('error','invalid_competition'); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','name','starts_at','ends_at','target_types','reason'))
   OR jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string' OR length(btrim(p_payload->>'name')) NOT BETWEEN 1 AND 80
   OR jsonb_typeof(p_payload->'target_types') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'target_types') NOT BETWEEN 1 AND 5
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'target_types') t WHERE jsonb_typeof(t)<>'string')
   OR jsonb_typeof(p_payload->'starts_at') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'ends_at') IS DISTINCT FROM 'string'
   THEN RETURN jsonb_build_object('error','invalid_competition'); END IF;
  BEGIN v_start:=(p_payload->>'starts_at')::timestamptz; v_end:=(p_payload->>'ends_at')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN jsonb_build_object('error','invalid_competition'); END;
  SELECT array_agg(t ORDER BY t) INTO v_types FROM jsonb_array_elements_text(p_payload->'target_types') t;
  IF v_start IS NULL OR v_end IS NULL OR NOT isfinite(v_start) OR NOT isfinite(v_end) OR v_end<=v_start OR v_end>v_start+interval '31 days' OR v_end<=now()
   OR NOT(v_types <@ ARRAY['FILM','SHORT','TRAILER','SERIES','EPISODE']::TEXT[]) OR cardinality(v_types)<>(SELECT count(DISTINCT t) FROM unnest(v_types) t)
   THEN RETURN jsonb_build_object('error','invalid_competition'); END IF;
  -- Serialise the global bounded active competition inventory.
  PERFORM pg_advisory_xact_lock(266,0);
 IF public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at) IS DISTINCT FROM v_actor THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
  IF (SELECT count(*) FROM public.cinema_competitions WHERE status='open' AND ends_at>now())>=25 THEN RETURN jsonb_build_object('error','competition_capacity'); END IF;
  INSERT INTO public.cinema_competitions(name,starts_at,ends_at,target_types,created_by)
   VALUES(btrim(p_payload->>'name'),v_start,v_end,v_types,v_actor) RETURNING id INTO v_target;
  v_new:='open';
 ELSIF v_action IN ('close_competition','review_vote') THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','id','decision','reason'))
   OR coalesce(p_payload->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN jsonb_build_object('error','invalid_action'); END IF;
  v_target:=(p_payload->>'id')::uuid;
  IF v_action='close_competition' THEN
   IF p_payload ? 'decision' THEN RETURN jsonb_build_object('error','invalid_action'); END IF;
   SELECT status INTO v_prior FROM public.cinema_competitions WHERE id=v_target FOR UPDATE;
 IF public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at) IS DISTINCT FROM v_actor THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
   IF NOT FOUND THEN RETURN jsonb_build_object('error','competition_not_found'); END IF;
   UPDATE public.cinema_competitions SET status='closed' WHERE id=v_target; v_new:='closed';
  ELSE
   v_new:=p_payload->>'decision';
   IF v_new IS NULL OR v_new NOT IN ('qualified','under_review','rejected') THEN RETURN jsonb_build_object('error','invalid_action'); END IF;
   SELECT * INTO v_vote FROM public.cinema_votes WHERE id=v_target FOR UPDATE;
 IF public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at) IS DISTINCT FROM v_actor THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
   IF NOT FOUND THEN RETURN jsonb_build_object('error','vote_not_found'); END IF;
   IF v_vote.voter_id=v_actor OR EXISTS(SELECT 1 FROM public.cinema_content WHERE id=v_vote.content_id AND creator_id=v_actor) THEN RETURN jsonb_build_object('error','self_review_forbidden'); END IF;
   IF v_new='qualified' AND (public.cinema_community_root(v_vote.content_id) IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.users u JOIN auth.users a ON a.id::text=u.auth_id JOIN public.cinema_memberships m ON m.user_id=u.id
    WHERE u.id=v_vote.voter_id AND u.frozen_at IS NULL AND m.account_status='active')) THEN RETURN jsonb_build_object('error','account_not_active'); END IF;
   v_prior:=v_vote.status; UPDATE public.cinema_votes SET status=v_new WHERE id=v_target;
  END IF;
 ELSE RETURN jsonb_build_object('error','invalid_action'); END IF;
 v_result:=jsonb_build_object('id',v_target,'status',v_new,'idempotent',false);
 INSERT INTO public.cinema_community_actions(actor_id,idempotency_key,action,target_id,reason,prior_status,new_status,payload,result,request_id)
  VALUES(v_actor,p_idempotency_key,v_action,v_target,v_reason,v_prior,v_new,p_payload,v_result,p_request_id);
 RETURN v_result;
END $$;
CREATE OR REPLACE FUNCTION public.list_cinema_voting_review(p_auth_id TEXT,p_aal TEXT,p_mfa_at BIGINT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at) IS NULL THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
 RETURN jsonb_build_object('competitions',coalesce((SELECT jsonb_agg(x ORDER BY created_at DESC,id) FROM (
  SELECT id,name,starts_at,ends_at,target_types,status,created_at FROM public.cinema_competitions ORDER BY created_at DESC,id LIMIT 50) x),'[]'::jsonb),
 'votes',coalesce((SELECT jsonb_agg(x ORDER BY created_at,id) FROM (
  SELECT v.id,v.content_id,v.competition_id,v.status,v.risk_reason,v.created_at,c.title,p.username,p.display_name
  FROM public.cinema_votes v JOIN public.cinema_content c ON c.id=v.content_id JOIN public.cinema_profiles p ON p.user_id=v.voter_id
  WHERE v.status='under_review' ORDER BY v.created_at,v.id LIMIT 100) x),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.cinema_community_actor(TEXT),public.cinema_community_admin(TEXT,TEXT,BIGINT),public.cinema_community_root(UUID),
 public.cast_cinema_vote(TEXT,UUID,UUID,UUID),public.read_cinema_voting(TEXT,UUID),
 public.manage_cinema_voting(TEXT,TEXT,BIGINT,UUID,JSONB,UUID),public.list_cinema_voting_review(TEXT,TEXT,BIGINT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cinema_community_actor(TEXT),public.cinema_community_admin(TEXT,TEXT,BIGINT),public.cinema_community_root(UUID),
 public.cast_cinema_vote(TEXT,UUID,UUID,UUID),public.read_cinema_voting(TEXT,UUID),
 public.manage_cinema_voting(TEXT,TEXT,BIGINT,UUID,JSONB,UUID),public.list_cinema_voting_review(TEXT,TEXT,BIGINT) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
