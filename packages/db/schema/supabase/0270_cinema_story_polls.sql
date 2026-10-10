-- 0270: episode story choices; separate from competition scores and payments.
BEGIN;
CREATE TABLE IF NOT EXISTS public.cinema_story_polls (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 content_id UUID NOT NULL REFERENCES public.cinema_content(id) ON DELETE CASCADE,
 question TEXT NOT NULL CHECK(length(btrim(question)) BETWEEN 1 AND 240),
 opens_at TIMESTAMPTZ NOT NULL, closes_at TIMESTAMPTZ NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
 created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(closes_at>opens_at AND closes_at<=opens_at+interval '31 days')
);
CREATE INDEX IF NOT EXISTS cinema_story_polls_content_idx ON public.cinema_story_polls(content_id,opens_at DESC,id);
CREATE INDEX IF NOT EXISTS cinema_story_polls_creator_idx ON public.cinema_story_polls(created_by);
CREATE INDEX IF NOT EXISTS cinema_story_polls_window_idx ON public.cinema_story_polls(status,closes_at,opens_at);
CREATE TABLE IF NOT EXISTS public.cinema_story_poll_options (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 poll_id UUID NOT NULL REFERENCES public.cinema_story_polls(id) ON DELETE CASCADE,
 label TEXT NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 120),
 position SMALLINT NOT NULL CHECK(position BETWEEN 1 AND 6),
 UNIQUE(poll_id,id), UNIQUE(poll_id,position)
);
CREATE UNIQUE INDEX IF NOT EXISTS cinema_story_poll_options_label_idx ON public.cinema_story_poll_options(poll_id,lower(btrim(label)));
CREATE TABLE IF NOT EXISTS public.cinema_story_poll_votes (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 poll_id UUID NOT NULL REFERENCES public.cinema_story_polls(id) ON DELETE CASCADE,
 option_id UUID NOT NULL,
 voter_id UUID NOT NULL REFERENCES public.cinema_profiles(user_id) ON DELETE CASCADE,
 idempotency_key UUID NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('qualified','under_review','rejected')),
 risk_reason TEXT CHECK(risk_reason IS NULL OR risk_reason='velocity'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(poll_id,option_id) REFERENCES public.cinema_story_poll_options(poll_id,id) ON DELETE CASCADE,
 UNIQUE(poll_id,voter_id), UNIQUE(voter_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS cinema_story_poll_votes_option_idx ON public.cinema_story_poll_votes(poll_id,option_id,status);
CREATE INDEX IF NOT EXISTS cinema_story_poll_votes_velocity_idx ON public.cinema_story_poll_votes(voter_id,created_at);
CREATE INDEX IF NOT EXISTS cinema_story_poll_votes_review_idx ON public.cinema_story_poll_votes(created_at,id) WHERE status='under_review';
ALTER TABLE public.cinema_story_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_story_polls FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_story_poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_story_poll_options FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_story_poll_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_story_poll_votes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_story_polls,public.cinema_story_poll_options,public.cinema_story_poll_votes FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.cast_cinema_story_choice(p_auth_id TEXT,p_idempotency_key UUID,p_poll_id UUID,p_option_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_root UUID; v_poll public.cinema_story_polls%ROWTYPE;
 v_vote public.cinema_story_poll_votes%ROWTYPE; v_now TIMESTAMPTZ; v_status TEXT;
BEGIN
 v_user:=public.cinema_community_actor(p_auth_id);
 IF v_user IS NULL THEN RETURN jsonb_build_object('error','profile_required'); END IF;
 IF p_idempotency_key IS NULL OR p_poll_id IS NULL OR p_option_id IS NULL THEN RETURN jsonb_build_object('error','invalid_choice'); END IF;
 PERFORM 1 FROM public.cinema_memberships WHERE user_id=v_user AND account_status='active' FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','account_not_active'); END IF;
 PERFORM pg_advisory_xact_lock(270,hashtext(v_user::text));
 IF public.cinema_community_actor(p_auth_id) IS DISTINCT FROM v_user THEN RETURN jsonb_build_object('error','account_not_active'); END IF;
 SELECT * INTO v_vote FROM public.cinema_story_poll_votes WHERE voter_id=v_user AND idempotency_key=p_idempotency_key;
 IF FOUND AND (v_vote.poll_id<>p_poll_id OR v_vote.option_id<>p_option_id) THEN RETURN jsonb_build_object('error','idempotency_conflict'); END IF;
 SELECT * INTO v_poll FROM public.cinema_story_polls WHERE id=p_poll_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','poll_not_found'); END IF;
 v_root:=public.cinema_community_root(v_poll.content_id);
 IF v_root IS NULL THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
 PERFORM 1 FROM public.cinema_content WHERE id=v_root FOR SHARE;
 IF public.cinema_community_root(v_poll.content_id) IS NULL THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
 SELECT * INTO v_poll FROM public.cinema_story_polls WHERE id=p_poll_id FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','poll_not_found'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cinema_story_poll_options WHERE id=p_option_id AND poll_id=p_poll_id) THEN RETURN jsonb_build_object('error','invalid_choice'); END IF;
 SELECT * INTO v_vote FROM public.cinema_story_poll_votes WHERE poll_id=p_poll_id AND voter_id=v_user;
 IF FOUND THEN
  IF v_vote.option_id<>p_option_id THEN RETURN jsonb_build_object('error','choice_already_recorded'); END IF;
  RETURN jsonb_build_object('id',v_vote.id,'status',v_vote.status,'idempotent',true);
 END IF;
 v_now:=clock_timestamp();
 IF public.cinema_community_actor(p_auth_id) IS DISTINCT FROM v_user THEN RETURN jsonb_build_object('error','account_not_active'); END IF;
 IF v_poll.status<>'open' OR v_now<v_poll.opens_at OR v_now>=v_poll.closes_at THEN RETURN jsonb_build_object('error','poll_closed'); END IF;
 IF (SELECT count(*) FROM public.cinema_story_poll_votes WHERE voter_id=v_user AND created_at>v_now-interval '1 hour')>=60 THEN RETURN jsonb_build_object('error','rate_limited'); END IF;
 v_status:=CASE WHEN (SELECT count(*) FROM public.cinema_story_poll_votes WHERE voter_id=v_user AND created_at>v_now-interval '1 minute')>=10 THEN 'under_review' ELSE 'qualified' END;
 INSERT INTO public.cinema_story_poll_votes(poll_id,option_id,voter_id,idempotency_key,status,risk_reason,created_at)
 VALUES(p_poll_id,p_option_id,v_user,p_idempotency_key,v_status,CASE WHEN v_status='under_review' THEN 'velocity' END,v_now) RETURNING * INTO v_vote;
 RETURN jsonb_build_object('id',v_vote.id,'status',v_status,'idempotent',false);
END $$;
CREATE OR REPLACE FUNCTION public.read_cinema_story_polls(p_auth_id TEXT,p_content_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_result JSONB;
BEGIN
 IF public.cinema_community_root(p_content_id) IS NULL THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
 IF p_auth_id IS NOT NULL THEN
  v_user:=public.cinema_community_actor(p_auth_id);
  IF v_user IS NULL THEN RETURN jsonb_build_object('error','profile_required'); END IF;
 END IF;
 SELECT coalesce(jsonb_agg(item ORDER BY opens_at DESC,id),'[]'::jsonb) INTO v_result FROM (
  SELECT p.opens_at,p.id,jsonb_build_object('id',p.id,'question',p.question,'opens_at',p.opens_at,'closes_at',p.closes_at,
   'is_open',p.status='open' AND p.closes_at>now(),
   'options',(SELECT jsonb_agg(jsonb_build_object('id',o.id,'label',o.label,'votes',(
    SELECT count(*) FROM public.cinema_story_poll_votes v JOIN public.users u ON u.id=v.voter_id
    JOIN auth.users a ON a.id::text=u.auth_id JOIN public.cinema_memberships m ON m.user_id=u.id
    WHERE v.poll_id=p.id AND v.option_id=o.id AND v.status='qualified' AND m.account_status='active' AND u.frozen_at IS NULL
   )) ORDER BY o.position) FROM public.cinema_story_poll_options o WHERE o.poll_id=p.id),
   'my_choice',(SELECT jsonb_build_object('id',v.id,'option_id',v.option_id,'status',v.status)
    FROM public.cinema_story_poll_votes v WHERE v.poll_id=p.id AND v.voter_id=v_user)) AS item
  FROM public.cinema_story_polls p WHERE p.content_id=p_content_id AND p.opens_at<=now()
  ORDER BY p.opens_at DESC,p.id LIMIT 5
 ) x;
 RETURN jsonb_build_object('polls',v_result);
END $$;
CREATE OR REPLACE FUNCTION public.manage_cinema_story_polls(p_auth_id TEXT,p_aal TEXT,p_mfa_at BIGINT,p_idempotency_key UUID,p_payload JSONB,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor UUID; v_action TEXT; v_target UUID; v_content UUID; v_root UUID; v_prior TEXT; v_new TEXT;
 v_start TIMESTAMPTZ; v_end TIMESTAMPTZ; v_result JSONB; v_old public.cinema_community_actions%ROWTYPE;
 v_vote public.cinema_story_poll_votes%ROWTYPE; v_poll public.cinema_story_polls%ROWTYPE;
BEGIN
 v_actor:=public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at);
 IF v_actor IS NULL THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
 PERFORM 1 FROM public.cinema_memberships WHERE user_id=v_actor AND role='administrator' AND account_status='active' FOR SHARE;
 IF NOT FOUND OR public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at) IS DISTINCT FROM v_actor THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
 IF p_idempotency_key IS NULL OR p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
 OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' OR length(btrim(p_payload->>'reason')) NOT BETWEEN 3 AND 500
 THEN RETURN jsonb_build_object('error','invalid_action'); END IF;
 v_action:=p_payload->>'action';
 -- Share the administrator idempotency lock with other community audit writers.
 PERFORM pg_advisory_xact_lock(266,hashtext(v_actor::text));
 IF public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at) IS DISTINCT FROM v_actor THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
 SELECT * INTO v_old FROM public.cinema_community_actions WHERE actor_id=v_actor AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF v_old.payload IS DISTINCT FROM p_payload THEN RETURN jsonb_build_object('error','idempotency_conflict'); END IF;
  RETURN v_old.result||jsonb_build_object('idempotent',true);
 END IF;
 IF v_action='create_story_poll' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','content_id','question','options','opens_at','closes_at','reason'))
   OR coalesce(p_payload->>'content_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR jsonb_typeof(p_payload->'question') IS DISTINCT FROM 'string' OR length(btrim(p_payload->>'question')) NOT BETWEEN 1 AND 240
   OR jsonb_typeof(p_payload->'options') IS DISTINCT FROM 'array'
   OR jsonb_typeof(p_payload->'opens_at') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'closes_at') IS DISTINCT FROM 'string'
   THEN RETURN jsonb_build_object('error','invalid_poll'); END IF;
  IF jsonb_array_length(p_payload->'options') NOT BETWEEN 2 AND 6
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'options') o WHERE jsonb_typeof(o)<>'string' OR length(btrim(o#>>'{}')) NOT BETWEEN 1 AND 120)
   OR (SELECT count(DISTINCT lower(btrim(o))) FROM jsonb_array_elements_text(p_payload->'options') o)<>jsonb_array_length(p_payload->'options')
   THEN RETURN jsonb_build_object('error','invalid_poll'); END IF;
  BEGIN v_start:=(p_payload->>'opens_at')::timestamptz; v_end:=(p_payload->>'closes_at')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN jsonb_build_object('error','invalid_poll'); END;
  IF NOT isfinite(v_start) OR NOT isfinite(v_end) OR v_end<=v_start OR v_end>v_start+interval '31 days' OR v_end<=clock_timestamp()
   THEN RETURN jsonb_build_object('error','invalid_poll'); END IF;
  v_content:=(p_payload->>'content_id')::uuid;
  v_root:=public.cinema_community_root(v_content);
  IF v_root IS NULL OR NOT EXISTS(SELECT 1 FROM public.cinema_content WHERE id=v_content AND content_type='EPISODE') THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
  PERFORM 1 FROM public.cinema_content WHERE id=v_root FOR SHARE;
  PERFORM pg_advisory_xact_lock(270,0);
  IF public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at) IS DISTINCT FROM v_actor THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
  IF public.cinema_community_root(v_content) IS NULL THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
  IF v_end<=clock_timestamp() THEN RETURN jsonb_build_object('error','invalid_poll'); END IF;
  IF EXISTS(SELECT 1 FROM public.cinema_story_polls WHERE content_id=v_content AND status='open' AND opens_at<v_end AND closes_at>v_start) THEN RETURN jsonb_build_object('error','poll_overlap'); END IF;
  IF (SELECT count(*) FROM public.cinema_story_polls WHERE status='open' AND closes_at>clock_timestamp())>=100 THEN RETURN jsonb_build_object('error','poll_capacity'); END IF;
  INSERT INTO public.cinema_story_polls(content_id,question,opens_at,closes_at,created_by)
  VALUES(v_content,btrim(p_payload->>'question'),v_start,v_end,v_actor) RETURNING id INTO v_target;
  INSERT INTO public.cinema_story_poll_options(poll_id,label,position)
  SELECT v_target,btrim(o.label),o.position FROM jsonb_array_elements_text(p_payload->'options') WITH ORDINALITY AS o(label,position);
  v_new:='open';
 ELSIF v_action IN ('close_story_poll','review_story_choice') THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','id','decision','reason'))
   OR coalesce(p_payload->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN jsonb_build_object('error','invalid_action'); END IF;
  v_target:=(p_payload->>'id')::uuid;
  IF v_action='close_story_poll' THEN
   IF p_payload ? 'decision' THEN RETURN jsonb_build_object('error','invalid_action'); END IF;
   SELECT * INTO v_poll FROM public.cinema_story_polls WHERE id=v_target FOR UPDATE;
   IF NOT FOUND THEN RETURN jsonb_build_object('error','poll_not_found'); END IF;
   IF public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at) IS DISTINCT FROM v_actor THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
   v_prior:=v_poll.status; v_new:='closed'; UPDATE public.cinema_story_polls SET status='closed' WHERE id=v_target;
  ELSE
   v_new:=p_payload->>'decision';
   IF v_new IS NULL OR v_new NOT IN ('qualified','under_review','rejected') THEN RETURN jsonb_build_object('error','invalid_action'); END IF;
   SELECT * INTO v_vote FROM public.cinema_story_poll_votes WHERE id=v_target FOR UPDATE;
   IF NOT FOUND THEN RETURN jsonb_build_object('error','choice_not_found'); END IF;
   IF public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at) IS DISTINCT FROM v_actor THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
   SELECT * INTO v_poll FROM public.cinema_story_polls WHERE id=v_vote.poll_id;
   IF v_vote.voter_id=v_actor OR EXISTS(SELECT 1 FROM public.cinema_content WHERE id=v_poll.content_id AND creator_id=v_actor) THEN RETURN jsonb_build_object('error','self_review_forbidden'); END IF;
   IF v_new='qualified' AND (public.cinema_community_root(v_poll.content_id) IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.users u JOIN auth.users a ON a.id::text=u.auth_id JOIN public.cinema_memberships m ON m.user_id=u.id
    WHERE u.id=v_vote.voter_id AND u.frozen_at IS NULL AND m.account_status='active')) THEN RETURN jsonb_build_object('error','account_not_active'); END IF;
   v_prior:=v_vote.status; UPDATE public.cinema_story_poll_votes SET status=v_new WHERE id=v_target;
  END IF;
 ELSE RETURN jsonb_build_object('error','invalid_action'); END IF;
 v_result:=jsonb_build_object('id',v_target,'status',v_new,'idempotent',false);
 INSERT INTO public.cinema_community_actions(actor_id,idempotency_key,action,target_id,reason,prior_status,new_status,payload,result,request_id)
 VALUES(v_actor,p_idempotency_key,v_action,v_target,btrim(p_payload->>'reason'),v_prior,v_new,p_payload,v_result,p_request_id);
 RETURN v_result;
END $$;
CREATE OR REPLACE FUNCTION public.list_cinema_story_polls_review(p_auth_id TEXT,p_aal TEXT,p_mfa_at BIGINT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at) IS NULL THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
 RETURN jsonb_build_object('polls',coalesce((SELECT jsonb_agg(x ORDER BY created_at DESC,id) FROM (
  SELECT p.id,p.content_id,p.question,p.opens_at,p.closes_at,p.status,p.created_at,c.title,
   (SELECT jsonb_agg(jsonb_build_object('id',o.id,'label',o.label) ORDER BY o.position) FROM public.cinema_story_poll_options o WHERE o.poll_id=p.id) AS options
  FROM public.cinema_story_polls p JOIN public.cinema_content c ON c.id=p.content_id ORDER BY p.created_at DESC,p.id LIMIT 50) x),'[]'::jsonb),
 'choices',coalesce((SELECT jsonb_agg(x ORDER BY created_at,id) FROM (
  SELECT v.id,v.poll_id,v.status,v.created_at,p.question,o.label,c.title,profile.username,profile.display_name
  FROM public.cinema_story_poll_votes v JOIN public.cinema_story_polls p ON p.id=v.poll_id
  JOIN public.cinema_story_poll_options o ON o.id=v.option_id JOIN public.cinema_content c ON c.id=p.content_id
  JOIN public.cinema_profiles profile ON profile.user_id=v.voter_id WHERE v.status='under_review' ORDER BY v.created_at,v.id LIMIT 100) x),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.cast_cinema_story_choice(TEXT,UUID,UUID,UUID),public.read_cinema_story_polls(TEXT,UUID),
 public.manage_cinema_story_polls(TEXT,TEXT,BIGINT,UUID,JSONB,UUID),public.list_cinema_story_polls_review(TEXT,TEXT,BIGINT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cast_cinema_story_choice(TEXT,UUID,UUID,UUID),public.read_cinema_story_polls(TEXT,UUID),
 public.manage_cinema_story_polls(TEXT,TEXT,BIGINT,UUID,JSONB,UUID),public.list_cinema_story_polls_review(TEXT,TEXT,BIGINT) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
