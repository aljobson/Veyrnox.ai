-- 0267: comments publish only after Cinema administrator approval (owner policy).
-- COMMENTS_ENABLED stays off until acceptance, operational ownership and clean checks.
BEGIN;
CREATE TABLE IF NOT EXISTS public.cinema_comments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), author_id UUID NOT NULL REFERENCES public.cinema_profiles(user_id) ON DELETE CASCADE,
 content_id UUID NOT NULL REFERENCES public.cinema_content(id) ON DELETE CASCADE,
 body TEXT NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 2000),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','removed','withdrawn')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cinema_comments_content_idx ON public.cinema_comments(content_id,status,created_at DESC,id);
CREATE INDEX IF NOT EXISTS cinema_comments_author_idx ON public.cinema_comments(author_id,created_at);
CREATE INDEX IF NOT EXISTS cinema_comments_pending_idx ON public.cinema_comments(created_at,id) WHERE status='pending';
CREATE TABLE IF NOT EXISTS public.cinema_comment_reports (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id UUID NOT NULL REFERENCES public.cinema_profiles(user_id) ON DELETE CASCADE,
 comment_id UUID NOT NULL REFERENCES public.cinema_comments(id) ON DELETE CASCADE,
 category TEXT NOT NULL CHECK(category IN ('spam','abuse','privacy','rights','other')),
 details TEXT NOT NULL CHECK(length(btrim(details)) BETWEEN 3 AND 500),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(reporter_id,comment_id)
);
CREATE INDEX IF NOT EXISTS cinema_comment_reports_comment_idx ON public.cinema_comment_reports(comment_id);
CREATE INDEX IF NOT EXISTS cinema_comment_reports_reporter_idx ON public.cinema_comment_reports(reporter_id,created_at);
CREATE INDEX IF NOT EXISTS cinema_comment_reports_open_idx ON public.cinema_comment_reports(created_at,id) WHERE status='open';
CREATE TABLE IF NOT EXISTS public.cinema_comment_mutations (
 actor_id UUID NOT NULL REFERENCES public.cinema_profiles(user_id) ON DELETE CASCADE,
 idempotency_key UUID NOT NULL, payload JSONB NOT NULL, result JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,idempotency_key)
);
ALTER TABLE public.cinema_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_comments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_comment_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_comment_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_comment_mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_comment_mutations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_comments,public.cinema_comment_reports,public.cinema_comment_mutations FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.mutate_cinema_comments(p_auth_id TEXT,p_idempotency_key UUID,p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor UUID; v_action TEXT; v_id UUID; v_content UUID; v_report_status TEXT; v_result JSONB; v_old public.cinema_comment_mutations%ROWTYPE; v_comment public.cinema_comments%ROWTYPE;
BEGIN
 v_actor:=public.cinema_community_actor(p_auth_id);
 IF v_actor IS NULL THEN RETURN jsonb_build_object('error','profile_required'); END IF;
 PERFORM 1 FROM public.cinema_memberships WHERE user_id=v_actor AND account_status='active' FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','account_not_active'); END IF;
 IF p_idempotency_key IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('error','invalid_comment'); END IF;
 v_action:=p_payload->>'action';
 IF v_action IS NULL OR v_action NOT IN ('submit','withdraw','report') THEN RETURN jsonb_build_object('error','invalid_comment'); END IF;
 IF v_action='submit' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','content_id','body'))
   OR coalesce(p_payload->>'content_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR jsonb_typeof(p_payload->'body') IS DISTINCT FROM 'string' OR length(btrim(p_payload->>'body')) NOT BETWEEN 1 AND 2000 THEN RETURN jsonb_build_object('error','invalid_comment'); END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','comment_id','category','details'))
   OR coalesce(p_payload->>'comment_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN jsonb_build_object('error','invalid_comment'); END IF;
  IF v_action='withdraw' AND (p_payload ? 'category' OR p_payload ? 'details') THEN RETURN jsonb_build_object('error','invalid_comment'); END IF;
  IF v_action='report' AND (coalesce(p_payload->>'category','') NOT IN ('spam','abuse','privacy','rights','other') OR jsonb_typeof(p_payload->'details') IS DISTINCT FROM 'string' OR length(btrim(p_payload->>'details')) NOT BETWEEN 3 AND 500) THEN RETURN jsonb_build_object('error','invalid_report'); END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(267,hashtext(v_actor::text));
 IF public.cinema_community_actor(p_auth_id) IS DISTINCT FROM v_actor THEN RETURN jsonb_build_object('error','account_not_active'); END IF;
 SELECT * INTO v_old FROM public.cinema_comment_mutations WHERE actor_id=v_actor AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF v_old.payload IS DISTINCT FROM p_payload THEN RETURN jsonb_build_object('error','idempotency_conflict'); END IF;
  RETURN v_old.result||jsonb_build_object('idempotent',true);
 END IF;
 IF v_action='submit' THEN
  v_content:=(p_payload->>'content_id')::uuid;
  v_id:=public.cinema_community_root(v_content);
  IF v_id IS NULL THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
  PERFORM 1 FROM public.cinema_content WHERE id=v_id FOR SHARE;
  IF public.cinema_community_root(v_content) IS NULL THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
  IF (SELECT count(*) FROM public.cinema_comments WHERE author_id=v_actor AND status='pending')>=5 THEN RETURN jsonb_build_object('error','pending_limit'); END IF;
  IF EXISTS(SELECT 1 FROM public.cinema_comments WHERE author_id=v_actor AND created_at>now()-interval '1 minute')
   OR (SELECT count(*) FROM public.cinema_comments WHERE author_id=v_actor AND created_at>now()-interval '24 hours')>=20 THEN RETURN jsonb_build_object('error','rate_limited'); END IF;
  INSERT INTO public.cinema_comments(author_id,content_id,body) VALUES(v_actor,v_content,btrim(p_payload->>'body')) RETURNING id INTO v_id;
  v_result:=jsonb_build_object('id',v_id,'status','pending','idempotent',false);
 ELSE
  SELECT * INTO v_comment FROM public.cinema_comments WHERE id=(p_payload->>'comment_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','comment_not_found'); END IF;
  IF v_action='withdraw' THEN
   IF v_comment.author_id<>v_actor THEN RETURN jsonb_build_object('error','comment_not_found'); END IF;
   UPDATE public.cinema_comments SET status='withdrawn',updated_at=now() WHERE id=v_comment.id;
   v_result:=jsonb_build_object('id',v_comment.id,'status','withdrawn','idempotent',v_comment.status='withdrawn');
  ELSE
   IF v_comment.author_id=v_actor THEN RETURN jsonb_build_object('error','self_report_forbidden'); END IF;
   SELECT id,status INTO v_id,v_report_status FROM public.cinema_comment_reports WHERE reporter_id=v_actor AND comment_id=v_comment.id;
   IF FOUND THEN v_result:=jsonb_build_object('id',v_id,'status',v_report_status,'idempotent',true);
   ELSE
   IF v_comment.status<>'approved' OR public.cinema_community_root(v_comment.content_id) IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.users u JOIN auth.users a ON a.id::text=u.auth_id JOIN public.cinema_memberships m ON m.user_id=u.id
    WHERE u.id=v_comment.author_id AND u.frozen_at IS NULL AND m.account_status='active') THEN RETURN jsonb_build_object('error','comment_not_found'); END IF;
    IF (SELECT count(*) FROM public.cinema_comment_reports WHERE reporter_id=v_actor AND created_at>now()-interval '24 hours')>=20 THEN RETURN jsonb_build_object('error','rate_limited'); END IF;
    INSERT INTO public.cinema_comment_reports(reporter_id,comment_id,category,details) VALUES(v_actor,v_comment.id,p_payload->>'category',btrim(p_payload->>'details')) RETURNING id INTO v_id;
    v_result:=jsonb_build_object('id',v_id,'status','open','idempotent',false);
   END IF;
  END IF;
 END IF;
 INSERT INTO public.cinema_comment_mutations(actor_id,idempotency_key,payload,result) VALUES(v_actor,p_idempotency_key,p_payload,v_result);
 RETURN v_result;
END $$;
CREATE OR REPLACE FUNCTION public.read_cinema_comments(p_auth_id TEXT,p_content_id UUID,p_before_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor UUID; v_before TIMESTAMPTZ; v_items JSONB; v_own JSONB; v_next UUID;
BEGIN
 IF public.cinema_community_root(p_content_id) IS NULL THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
 IF p_auth_id IS NOT NULL THEN v_actor:=public.cinema_community_actor(p_auth_id); IF v_actor IS NULL THEN RETURN jsonb_build_object('error','profile_required'); END IF; END IF;
 IF p_before_id IS NOT NULL THEN
  SELECT created_at INTO v_before FROM public.cinema_comments WHERE id=p_before_id AND content_id=p_content_id AND status='approved';
  IF NOT FOUND THEN RETURN jsonb_build_object('error','invalid_cursor'); END IF;
 END IF;
 SELECT coalesce(jsonb_agg(item ORDER BY created_at DESC,id DESC),'[]') INTO v_items FROM (
  SELECT c.created_at,c.id,jsonb_build_object('id',c.id,'body',c.body,'created_at',c.created_at,'username',p.username,'display_name',p.display_name,'own',c.author_id=v_actor) AS item
  FROM public.cinema_comments c JOIN public.cinema_profiles p ON p.user_id=c.author_id JOIN public.users u ON u.id=c.author_id
  JOIN auth.users a ON a.id::text=u.auth_id JOIN public.cinema_memberships m ON m.user_id=u.id
  WHERE c.content_id=p_content_id AND c.status='approved' AND m.account_status='active' AND u.frozen_at IS NULL
   AND (v_before IS NULL OR (c.created_at,c.id)<(v_before,p_before_id)) ORDER BY c.created_at DESC,c.id DESC LIMIT 26
 ) x;
 IF jsonb_array_length(v_items)>25 THEN v_next:=(v_items->24->>'id')::uuid; v_items:=v_items-25; END IF;
 SELECT coalesce(jsonb_agg(x ORDER BY created_at DESC,id DESC),'[]') INTO v_own FROM (
  SELECT id,body,status,created_at FROM public.cinema_comments WHERE author_id=v_actor AND content_id=p_content_id AND status<>'approved' ORDER BY created_at DESC,id DESC LIMIT 25
 ) x;
 RETURN jsonb_build_object('comments',v_items,'own_comments',v_own,'next_cursor',v_next);
END $$;
CREATE OR REPLACE FUNCTION public.manage_cinema_comments(p_auth_id TEXT,p_aal TEXT,p_mfa_at BIGINT,p_idempotency_key UUID,p_payload JSONB,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor UUID; v_action TEXT; v_id UUID; v_prior TEXT; v_new TEXT; v_result JSONB; v_old public.cinema_community_actions%ROWTYPE; v_comment public.cinema_comments%ROWTYPE;
BEGIN
 v_actor:=public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at);
 IF v_actor IS NULL THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
 PERFORM 1 FROM public.cinema_memberships WHERE user_id=v_actor AND role='administrator' AND account_status='active' FOR SHARE;
 IF NOT FOUND OR public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at) IS DISTINCT FROM v_actor THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
 IF p_idempotency_key IS NULL OR p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('error','invalid_action'); END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','id','decision','reason'))
  OR coalesce(p_payload->>'action','') NOT IN ('review_comment','resolve_report')
  OR coalesce(p_payload->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' OR length(btrim(p_payload->>'reason')) NOT BETWEEN 3 AND 500 THEN RETURN jsonb_build_object('error','invalid_action'); END IF;
 v_action:=p_payload->>'action'; v_id:=(p_payload->>'id')::uuid;
 IF (v_action='review_comment' AND coalesce(p_payload->>'decision','') NOT IN ('approved','rejected','removed')) OR (v_action='resolve_report' AND p_payload ? 'decision') THEN RETURN jsonb_build_object('error','invalid_action'); END IF;
 PERFORM pg_advisory_xact_lock(266,hashtext(v_actor::text));
 IF public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at) IS DISTINCT FROM v_actor THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
 SELECT * INTO v_old FROM public.cinema_community_actions WHERE actor_id=v_actor AND idempotency_key=p_idempotency_key;
 IF FOUND THEN IF v_old.payload IS DISTINCT FROM p_payload THEN RETURN jsonb_build_object('error','idempotency_conflict'); END IF; RETURN v_old.result||jsonb_build_object('idempotent',true); END IF;
 IF v_action='review_comment' THEN
  SELECT * INTO v_comment FROM public.cinema_comments WHERE id=v_id FOR UPDATE;
 IF public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at) IS DISTINCT FROM v_actor THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','comment_not_found'); END IF;
  IF v_comment.author_id=v_actor OR EXISTS(SELECT 1 FROM public.cinema_content WHERE id=v_comment.content_id AND creator_id=v_actor) THEN RETURN jsonb_build_object('error','self_review_forbidden'); END IF;
  v_new:=p_payload->>'decision'; v_prior:=v_comment.status;
  IF (v_new IN ('approved','rejected') AND v_prior<>'pending') OR (v_new='removed' AND v_prior<>'approved') THEN RETURN jsonb_build_object('error','already_reviewed'); END IF;
  IF v_new='approved' AND (public.cinema_community_root(v_comment.content_id) IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.users u JOIN auth.users a ON a.id::text=u.auth_id JOIN public.cinema_memberships m ON m.user_id=u.id
    WHERE u.id=v_comment.author_id AND u.frozen_at IS NULL AND m.account_status='active')) THEN RETURN jsonb_build_object('error','account_not_active'); END IF;
  UPDATE public.cinema_comments SET status=v_new,updated_at=now() WHERE id=v_id;
 ELSE
  SELECT status INTO v_prior FROM public.cinema_comment_reports WHERE id=v_id FOR UPDATE;
 IF public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at) IS DISTINCT FROM v_actor THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','report_not_found'); END IF;
  IF EXISTS(SELECT 1 FROM public.cinema_comment_reports WHERE id=v_id AND reporter_id=v_actor) THEN RETURN jsonb_build_object('error','self_review_forbidden'); END IF;
  IF v_prior<>'open' THEN RETURN jsonb_build_object('error','already_reviewed'); END IF;
  v_new:='resolved'; UPDATE public.cinema_comment_reports SET status=v_new WHERE id=v_id;
 END IF;
 v_result:=jsonb_build_object('id',v_id,'status',v_new,'idempotent',false);
 INSERT INTO public.cinema_community_actions(actor_id,idempotency_key,action,target_id,reason,prior_status,new_status,payload,result,request_id)
 VALUES(v_actor,p_idempotency_key,v_action,v_id,btrim(p_payload->>'reason'),v_prior,v_new,p_payload,v_result,p_request_id);
 RETURN v_result;
END $$;
CREATE OR REPLACE FUNCTION public.list_cinema_comment_review(p_auth_id TEXT,p_aal TEXT,p_mfa_at BIGINT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF public.cinema_community_admin(p_auth_id,p_aal,p_mfa_at) IS NULL THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
 RETURN jsonb_build_object('comments',coalesce((SELECT jsonb_agg(x ORDER BY created_at,id) FROM (
 SELECT c.id,c.content_id,c.body,c.status,c.created_at,t.title,p.display_name,p.username FROM public.cinema_comments c JOIN public.cinema_content t ON t.id=c.content_id JOIN public.cinema_profiles p ON p.user_id=c.author_id
 WHERE c.status='pending' ORDER BY c.created_at,c.id LIMIT 50) x),'[]'::jsonb),
 'reports',coalesce((SELECT jsonb_agg(x ORDER BY created_at,id) FROM (
 SELECT r.id,r.comment_id,r.category,r.details,r.status,r.created_at,c.content_id,c.body,c.status AS comment_status,t.title FROM public.cinema_comment_reports r JOIN public.cinema_comments c ON c.id=r.comment_id JOIN public.cinema_content t ON t.id=c.content_id
 WHERE r.status='open' ORDER BY r.created_at,r.id LIMIT 50) x),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.mutate_cinema_comments(TEXT,UUID,JSONB),public.read_cinema_comments(TEXT,UUID,UUID),public.manage_cinema_comments(TEXT,TEXT,BIGINT,UUID,JSONB,UUID),public.list_cinema_comment_review(TEXT,TEXT,BIGINT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_cinema_comments(TEXT,UUID,JSONB),public.read_cinema_comments(TEXT,UUID,UUID),public.manage_cinema_comments(TEXT,TEXT,BIGINT,UUID,JSONB,UUID),public.list_cinema_comment_review(TEXT,TEXT,BIGINT) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
