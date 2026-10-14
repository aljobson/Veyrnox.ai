-- 0304: paid external approval workflows for Publish drafts.
-- Review links are signed by the Worker; the database sees only the opaque
-- reviewer UUID. Drafts stay inert until the selected approval policy passes.
BEGIN;

CREATE TABLE IF NOT EXISTS public.social_approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES public.social_brands(id) ON DELETE CASCADE,
    post_id UUID NOT NULL UNIQUE REFERENCES public.social_posts(id) ON DELETE CASCADE,
    draft_batch_id UUID NOT NULL UNIQUE,
    requester_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    policy TEXT NOT NULL CHECK (policy IN ('any', 'all')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'canceled')),
    resolved_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_approval_requests_brand_created_idx
    ON public.social_approval_requests(brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS social_approval_requests_requester_idx
    ON public.social_approval_requests(requester_user_id);
ALTER TABLE public.social_approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_approval_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_approval_requests FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.social_approval_reviewers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES public.social_approval_requests(id) ON DELETE CASCADE,
    email TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
    decision TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'approved', 'rejected')),
    comment TEXT NULL CHECK (comment IS NULL OR char_length(comment) <= 2000),
    decided_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT social_approval_reviewers_request_email UNIQUE(request_id, email)
);
CREATE INDEX IF NOT EXISTS social_approval_reviewers_request_idx
    ON public.social_approval_reviewers(request_id);
ALTER TABLE public.social_approval_reviewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_approval_reviewers FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_approval_reviewers FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.social_approval_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES public.social_approval_requests(id) ON DELETE RESTRICT,
    reviewer_id UUID NULL REFERENCES public.social_approval_reviewers(id) ON DELETE SET NULL,
    actor_user_id UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL CHECK (action IN ('requested', 'approved', 'rejected', 'canceled')),
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_approval_events_request_created_idx
    ON public.social_approval_events(request_id, created_at);
CREATE INDEX IF NOT EXISTS social_approval_events_reviewer_idx
    ON public.social_approval_events(reviewer_id);
CREATE INDEX IF NOT EXISTS social_approval_events_actor_idx
    ON public.social_approval_events(actor_user_id);
ALTER TABLE public.social_approval_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_approval_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_approval_events FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.social_approval_events_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'social_approval_events is append-only (attempted %)', TG_OP; END $$;
DROP TRIGGER IF EXISTS social_approval_events_append_only ON public.social_approval_events;
CREATE TRIGGER social_approval_events_append_only BEFORE UPDATE OR DELETE ON public.social_approval_events
FOR EACH ROW EXECUTE FUNCTION public.social_approval_events_append_only();
DROP TRIGGER IF EXISTS social_approval_events_no_truncate ON public.social_approval_events;
CREATE TRIGGER social_approval_events_no_truncate BEFORE TRUNCATE ON public.social_approval_events
FOR EACH STATEMENT EXECUTE FUNCTION public.social_approval_events_append_only();

CREATE OR REPLACE FUNCTION public.create_social_post_approval(
    p_auth_id TEXT, p_brand_id UUID, p_batch_id UUID, p_scheduled_at TIMESTAMPTZ,
    p_global_text TEXT, p_idempotency_key TEXT, p_account_ids UUID[], p_media JSONB,
    p_policy TEXT, p_reviewer_emails JSONB, p_youtube_visibility TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID; v_post JSONB; v_post_id UUID; v_request UUID; v_email TEXT;
    v_count INTEGER; v_distinct INTEGER;
BEGIN
    v_user := public.social_inbox_paid_user(p_auth_id);
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','PLAN_REQUIRED'); END IF;
    IF NOT EXISTS(SELECT 1 FROM public.social_brands b WHERE b.id=p_brand_id AND b.owner_user_id=v_user) THEN
        RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND'); END IF;
    IF p_batch_id IS NULL OR p_policy IS NULL OR p_policy NOT IN ('any','all') OR p_reviewer_emails IS NULL OR jsonb_typeof(p_reviewer_emails)<>'array'
      OR jsonb_array_length(p_reviewer_emails) NOT BETWEEN 1 AND 10 THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_APPROVAL'); END IF;
    IF p_youtube_visibility IS NOT NULL AND p_youtube_visibility NOT IN ('private','unlisted','public') THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_YOUTUBE_VISIBILITY'); END IF;
    SELECT count(*), count(DISTINCT lower(btrim(value))) INTO v_count,v_distinct
      FROM jsonb_array_elements_text(p_reviewer_emails);
    IF v_count<>v_distinct OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_reviewer_emails) e(value)
      WHERE char_length(btrim(value)) NOT BETWEEN 3 AND 254
        OR btrim(value) !~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$') THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_REVIEWERS'); END IF;

    v_post := public.create_social_post_draft(p_auth_id,p_brand_id,p_batch_id,p_scheduled_at,
      p_global_text,p_idempotency_key,p_account_ids,p_media);
    IF NOT coalesce((v_post->>'ok')::boolean,false) THEN RETURN v_post; END IF;
    v_post_id := (v_post->>'post_id')::uuid;

    IF NOT coalesce((v_post->>'idempotent')::boolean,false) AND p_youtube_visibility IS NOT NULL THEN
      UPDATE public.social_post_targets SET provider_state=coalesce(provider_state,'{}'::jsonb)
        || jsonb_build_object('youtube_visibility',p_youtube_visibility)
        WHERE post_id=v_post_id AND network='youtube';
    END IF;

    SELECT r.id INTO v_request FROM public.social_approval_requests r WHERE r.post_id=v_post_id;
    IF v_request IS NOT NULL THEN
      RETURN jsonb_build_object('ok',true,'idempotent',true,'request_id',v_request,'post_id',v_post_id,
        'reviewers',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',rv.id,'email',rv.email) ORDER BY rv.created_at),'[]'::jsonb)
          FROM public.social_approval_reviewers rv WHERE rv.request_id=v_request));
    END IF;
    IF coalesce((v_post->>'idempotent')::boolean,false) THEN
      RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;

    INSERT INTO public.social_approval_requests(brand_id,post_id,draft_batch_id,requester_user_id,policy)
      VALUES(p_brand_id,v_post_id,p_batch_id,v_user,p_policy) RETURNING id INTO v_request;
    FOR v_email IN SELECT DISTINCT lower(btrim(value)) FROM jsonb_array_elements_text(p_reviewer_emails) LOOP
      INSERT INTO public.social_approval_reviewers(request_id,email) VALUES(v_request,v_email);
    END LOOP;
    INSERT INTO public.social_approval_events(request_id,actor_user_id,action,detail)
      VALUES(v_request,v_user,'requested',jsonb_build_object('policy',p_policy,'reviewers',v_count));
    RETURN jsonb_build_object('ok',true,'idempotent',false,'request_id',v_request,'post_id',v_post_id,
      'reviewers',(SELECT jsonb_agg(jsonb_build_object('id',rv.id,'email',rv.email) ORDER BY rv.created_at)
        FROM public.social_approval_reviewers rv WHERE rv.request_id=v_request));
END $$;

CREATE OR REPLACE FUNCTION public.list_social_approvals(p_auth_id TEXT,p_brand_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID;
BEGIN
  v_user:=public.social_inbox_paid_user(p_auth_id);
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','PLAN_REQUIRED'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.social_brands b WHERE b.id=p_brand_id AND b.owner_user_id=v_user) THEN
    RETURN jsonb_build_object('ok',false,'code','BRAND_NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok',true,'requests',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',r.id,'post_id',r.post_id,'policy',r.policy,'status',r.status,'scheduled_at',p.scheduled_at,
    'global_text',p.global_text,'created_at',r.created_at,'reviewers',(SELECT jsonb_agg(jsonb_build_object(
      'id',rv.id,'email',rv.email,'decision',rv.decision,'comment',rv.comment,'decided_at',rv.decided_at)
      ORDER BY rv.created_at) FROM public.social_approval_reviewers rv WHERE rv.request_id=r.id)) ORDER BY r.created_at DESC)
    FROM public.social_approval_requests r JOIN public.social_posts p ON p.id=r.post_id WHERE r.brand_id=p_brand_id),'[]'::jsonb));
END $$;

-- Called only after the Worker verifies the reviewer link's HMAC and expiry.
CREATE OR REPLACE FUNCTION public.get_social_approval_review(p_reviewer_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v JSONB;
BEGIN
  SELECT jsonb_build_object('ok',true,'reviewer_id',rv.id,'decision',rv.decision,
    'request_id',r.id,'request_status',r.status,'policy',r.policy,'scheduled_at',p.scheduled_at,
    'global_text',p.global_text,'brand_name',b.label,'networks',(SELECT coalesce(jsonb_agg(t.network ORDER BY t.network),'[]'::jsonb)
      FROM public.social_post_targets t WHERE t.post_id=p.id),
    'media',(SELECT jsonb_strip_nulls(jsonb_build_object('media_type',m.media_type,'r2_key',coalesce(a.r2_key,u.r2_key),'mime_type',coalesce(a.mime_type,u.mime_type)))
      FROM public.social_post_media m LEFT JOIN public.assets a ON a.job_id=m.source_job_id
      LEFT JOIN public.social_uploads u ON u.id=m.source_upload_id WHERE m.post_id=p.id ORDER BY m.position LIMIT 1)) INTO v
  FROM public.social_approval_reviewers rv JOIN public.social_approval_requests r ON r.id=rv.request_id
  JOIN public.social_posts p ON p.id=r.post_id JOIN public.social_brands b ON b.id=r.brand_id
  WHERE rv.id=p_reviewer_id;
  RETURN coalesce(v,jsonb_build_object('ok',false,'code','REVIEW_NOT_FOUND'));
END $$;

CREATE OR REPLACE FUNCTION public.decide_social_approval(p_reviewer_id UUID,p_decision TEXT,p_comment TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_reviewer public.social_approval_reviewers%rowtype; v_request public.social_approval_requests%rowtype;
  v_ready BOOLEAN; v_post UUID;
BEGIN
  IF p_decision NOT IN ('approved','rejected') OR p_comment IS NOT NULL AND char_length(p_comment)>2000 THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_DECISION'); END IF;
  SELECT * INTO v_reviewer FROM public.social_approval_reviewers WHERE id=p_reviewer_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','REVIEW_NOT_FOUND'); END IF;
  SELECT * INTO v_request FROM public.social_approval_requests WHERE id=v_reviewer.request_id FOR UPDATE;
  IF v_reviewer.decision<>'pending' OR v_request.status<>'pending' THEN
    RETURN jsonb_build_object('ok',true,'idempotent',true,'decision',v_reviewer.decision,'request_status',v_request.status); END IF;
  UPDATE public.social_approval_reviewers SET decision=p_decision,comment=nullif(btrim(p_comment),''),decided_at=now()
    WHERE id=p_reviewer_id;
  INSERT INTO public.social_approval_events(request_id,reviewer_id,action,detail)
    VALUES(v_request.id,p_reviewer_id,p_decision,jsonb_build_object('commented',nullif(btrim(p_comment),'') IS NOT NULL));
  IF p_decision='rejected' THEN
    UPDATE public.social_approval_requests SET status='rejected',resolved_at=now(),updated_at=now() WHERE id=v_request.id;
    UPDATE public.social_posts SET status='canceled',updated_at=now() WHERE id=v_request.post_id AND status='draft';
    UPDATE public.social_post_targets SET publish_status='failed',last_error='approval_rejected',claim_key=NULL
      WHERE post_id=v_request.post_id AND publish_status='pending';
    RETURN jsonb_build_object('ok',true,'idempotent',false,'decision','rejected','request_status','rejected');
  END IF;
  v_ready := v_request.policy='any' OR NOT EXISTS(SELECT 1 FROM public.social_approval_reviewers
    WHERE request_id=v_request.id AND decision='pending');
  IF v_ready THEN
    UPDATE public.social_approval_requests SET status='approved',resolved_at=now(),updated_at=now() WHERE id=v_request.id;
    UPDATE public.social_posts SET status='scheduled',scheduled_at=greatest(scheduled_at,now()),updated_at=now()
      WHERE id=v_request.post_id AND status='draft' RETURNING id INTO v_post;
    IF v_post IS NOT NULL THEN PERFORM public.settle_social_post(v_post); END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'idempotent',false,'decision','approved',
    'request_status',CASE WHEN v_ready THEN 'approved' ELSE 'pending' END);
END $$;

DO $$ DECLARE fn TEXT; BEGIN FOREACH fn IN ARRAY ARRAY[
  'public.create_social_post_approval(text,uuid,uuid,timestamptz,text,text,uuid[],jsonb,text,jsonb,text)',
  'public.list_social_approvals(text,uuid)','public.get_social_approval_review(uuid)',
  'public.decide_social_approval(uuid,text,text)'
] LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||fn||' FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION '||fn||' TO service_role'; END LOOP; END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
