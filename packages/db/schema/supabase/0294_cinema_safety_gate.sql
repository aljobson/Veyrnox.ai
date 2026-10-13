BEGIN;

-- A submission records the creator's audience guidance and the exact policy
-- wording they accepted. None of these declarations is itself a safety pass.
ALTER TABLE public.cinema_content ADD COLUMN IF NOT EXISTS audience_rating TEXT NULL
  CHECK (audience_rating IS NULL OR audience_rating IN ('ALL','PG','12','15','18'));
ALTER TABLE public.cinema_content ADD COLUMN IF NOT EXISTS content_warnings TEXT[] NOT NULL DEFAULT '{}'
  CHECK (content_warnings <@ ARRAY['violence','graphic_violence','strong_language','sex_references','drugs','horror','self_harm','discrimination','flashing_images']::TEXT[]
    AND cardinality(content_warnings) <= 9);
ALTER TABLE public.cinema_submissions ADD COLUMN IF NOT EXISTS policy_version TEXT NULL
  CHECK (policy_version IS NULL OR policy_version ~ '^[A-Za-z0-9._-]{1,48}$');
ALTER TABLE public.cinema_submissions ADD COLUMN IF NOT EXISTS audience_rating TEXT NULL
  CHECK (audience_rating IS NULL OR audience_rating IN ('ALL','PG','12','15','18'));
ALTER TABLE public.cinema_submissions ADD COLUMN IF NOT EXISTS content_warnings TEXT[] NOT NULL DEFAULT '{}'
  CHECK (content_warnings <@ ARRAY['violence','graphic_violence','strong_language','sex_references','drugs','horror','self_harm','discrimination','flashing_images']::TEXT[]
    AND cardinality(content_warnings) <= 9);
ALTER TABLE public.cinema_submissions ADD COLUMN IF NOT EXISTS safety_attested_at TIMESTAMPTZ NULL;
ALTER TABLE public.cinema_submissions ADD COLUMN IF NOT EXISTS malware_attested_at TIMESTAMPTZ NULL;

-- Current aggregate used by the publication lock. Providers write through the
-- service-only RPC below, which also appends an immutable event.
CREATE TABLE IF NOT EXISTS public.cinema_safety_checks (
  submission_id       UUID PRIMARY KEY REFERENCES public.cinema_submissions(id) ON DELETE RESTRICT,
  content_status      TEXT NOT NULL DEFAULT 'pending' CHECK (content_status IN ('pending','passed','flagged','unavailable')),
  child_safety_status TEXT NOT NULL DEFAULT 'pending' CHECK (child_safety_status IN ('pending','passed','flagged','unavailable')),
  malware_status      TEXT NOT NULL DEFAULT 'pending' CHECK (malware_status IN ('pending','passed','flagged','unavailable')),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cinema_safety_checks_pending_idx ON public.cinema_safety_checks(updated_at, submission_id)
  WHERE content_status = 'pending' OR child_safety_status = 'pending' OR malware_status = 'pending';
ALTER TABLE public.cinema_safety_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_safety_checks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_safety_checks FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.cinema_safety_check_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   UUID NOT NULL REFERENCES public.cinema_submissions(id) ON DELETE RESTRICT,
  check_kind      TEXT NOT NULL CHECK (check_kind IN ('content','child_safety','malware')),
  verdict         TEXT NOT NULL CHECK (verdict IN ('passed','flagged','unavailable')),
  provider        TEXT NOT NULL CHECK (length(btrim(provider)) BETWEEN 1 AND 80),
  model           TEXT NULL CHECK (model IS NULL OR length(model) <= 120),
  evidence_sha256 TEXT NULL CHECK (evidence_sha256 IS NULL OR evidence_sha256 ~ '^[a-f0-9]{64}$'),
  details         JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(details) = 'object' AND octet_length(details::TEXT) <= 8192),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cinema_safety_check_events_submission_idx ON public.cinema_safety_check_events(submission_id, created_at, id);
ALTER TABLE public.cinema_safety_check_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_safety_check_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_safety_check_events FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS cinema_safety_check_events_append_only ON public.cinema_safety_check_events;
CREATE TRIGGER cinema_safety_check_events_append_only BEFORE UPDATE OR DELETE ON public.cinema_safety_check_events
  FOR EACH ROW EXECUTE FUNCTION public.cinema_publication_append_only();
DROP TRIGGER IF EXISTS cinema_safety_check_events_no_truncate ON public.cinema_safety_check_events;
CREATE TRIGGER cinema_safety_check_events_no_truncate BEFORE TRUNCATE ON public.cinema_safety_check_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_no_truncate();

CREATE OR REPLACE FUNCTION public.submit_cinema_title_safe(
  p_auth_id TEXT, p_idempotency_key UUID, p_content_id UUID, p_rights_version TEXT,
  p_policy_version TEXT, p_audience_rating TEXT, p_content_warnings TEXT[],
  p_safety_confirmed BOOLEAN, p_malware_confirmed BOOLEAN
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user UUID; v_member public.cinema_memberships%ROWTYPE; v_root public.cinema_content%ROWTYPE;
  v_old public.cinema_submissions%ROWTYPE; v_eps INTEGER; v_missing INTEGER; v_id UUID; v_warnings TEXT[];
BEGIN
  IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN jsonb_build_object('error','creator_required'); END IF;
  SELECT u.id INTO v_user FROM public.users u JOIN auth.users a ON a.id=p_auth_id::UUID WHERE u.auth_id=p_auth_id;
  SELECT * INTO v_member FROM public.cinema_memberships WHERE user_id=v_user FOR UPDATE;
  IF NOT FOUND OR v_member.role <> 'creator' THEN RETURN jsonb_build_object('error','creator_required'); END IF;
  IF v_member.account_status <> 'active' THEN RETURN jsonb_build_object('error','account_not_active'); END IF;
  IF p_idempotency_key IS NULL OR p_content_id IS NULL OR p_rights_version IS DISTINCT FROM 'rights-2026-10-13'
    OR p_policy_version IS DISTINCT FROM 'cinema-safety-2026-10-13' OR p_audience_rating IS NULL OR p_audience_rating NOT IN ('ALL','PG','12','15','18')
    OR p_safety_confirmed IS DISTINCT FROM true OR p_malware_confirmed IS DISTINCT FROM true OR p_content_warnings IS NULL
    OR NOT (p_content_warnings <@ ARRAY['violence','graphic_violence','strong_language','sex_references','drugs','horror','self_harm','discrimination','flashing_images']::TEXT[])
    OR cardinality(p_content_warnings) > 9 THEN RETURN jsonb_build_object('error','invalid_submission'); END IF;
  SELECT coalesce(array_agg(x ORDER BY x),'{}') INTO v_warnings FROM unnest(p_content_warnings) x;
  IF cardinality(v_warnings) <> (SELECT count(DISTINCT x) FROM unnest(v_warnings) x) THEN RETURN jsonb_build_object('error','invalid_submission'); END IF;

  SELECT * INTO v_old FROM public.cinema_submissions WHERE creator_id=v_user AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_old.content_id <> p_content_id OR v_old.rights_version <> p_rights_version OR v_old.policy_version <> p_policy_version
      OR v_old.audience_rating <> p_audience_rating OR v_old.content_warnings <> v_warnings THEN RETURN jsonb_build_object('error','idempotency_conflict'); END IF;
    RETURN jsonb_build_object('id',v_old.id,'content_id',v_old.content_id,'status',v_old.status,'idempotent',true);
  END IF;

  SELECT * INTO v_root FROM public.cinema_content WHERE id=p_content_id AND creator_id=v_user FOR UPDATE;
  IF NOT FOUND OR v_root.parent_id IS NOT NULL OR v_root.content_type NOT IN ('FILM','SHORT','TRAILER','SERIES') THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
  IF v_root.lifecycle_status='UNDER_REVIEW' THEN RETURN jsonb_build_object('error','already_submitted'); END IF;
  IF v_root.lifecycle_status='PUBLISHED' THEN RETURN jsonb_build_object('error','already_published'); END IF;
  IF v_root.lifecycle_status='SUSPENDED' THEN RETURN jsonb_build_object('error','suspended'); END IF;
  IF cardinality(v_root.categories)=0 OR (SELECT count(*) FROM public.cinema_categories c WHERE c.active AND c.slug=ANY(v_root.categories)) <> cardinality(v_root.categories) THEN RETURN jsonb_build_object('error','category_required'); END IF;

  IF v_root.content_type='SERIES' THEN
    SELECT count(*), count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.cinema_uploads x WHERE x.content_id=e.id AND x.state='ready')) INTO v_eps,v_missing
    FROM public.cinema_content e JOIN public.cinema_content s ON s.id=e.parent_id WHERE s.parent_id=v_root.id AND e.content_type='EPISODE';
    IF v_eps=0 THEN RETURN jsonb_build_object('error','no_episodes'); END IF;
    IF v_missing>0 THEN RETURN jsonb_build_object('error','video_not_ready','missing',v_missing); END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.cinema_uploads x WHERE x.content_id=v_root.id AND x.state='ready') THEN
    RETURN jsonb_build_object('error','video_not_ready','missing',1);
  END IF;

  UPDATE public.cinema_content SET lifecycle_status='UNDER_REVIEW', visibility='PRIVATE', rights_version=p_rights_version,
    rights_at=now(), submitted_at=now(), review_note=NULL, updated_at=now() WHERE id IN (SELECT public.cinema_title_rows(v_root.id));
  UPDATE public.cinema_content SET audience_rating=p_audience_rating, content_warnings=v_warnings WHERE id=v_root.id;
  INSERT INTO public.cinema_submissions(content_id,creator_id,idempotency_key,rights_version,policy_version,audience_rating,content_warnings,safety_attested_at,malware_attested_at)
  VALUES(v_root.id,v_user,p_idempotency_key,p_rights_version,p_policy_version,p_audience_rating,v_warnings,now(),now()) RETURNING id INTO v_id;
  INSERT INTO public.cinema_safety_checks(submission_id) VALUES(v_id);
  RETURN jsonb_build_object('id',v_id,'content_id',v_root.id,'status','pending','idempotent',false);
END $$;

CREATE OR REPLACE FUNCTION public.record_cinema_safety_check(
  p_submission_id UUID, p_check_kind TEXT, p_verdict TEXT, p_provider TEXT,
  p_model TEXT, p_evidence_sha256 TEXT, p_details JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.cinema_safety_checks%ROWTYPE;
BEGIN
  IF p_submission_id IS NULL OR p_check_kind IS NULL OR p_check_kind NOT IN ('content','child_safety','malware')
    OR p_verdict IS NULL OR p_verdict NOT IN ('passed','flagged','unavailable') OR p_provider IS NULL OR length(btrim(p_provider)) NOT BETWEEN 1 AND 80
    OR (p_model IS NOT NULL AND length(p_model)>120)
    OR (p_evidence_sha256 IS NOT NULL AND p_evidence_sha256 !~ '^[a-f0-9]{64}$')
    OR p_details IS NULL OR jsonb_typeof(p_details)<>'object' OR octet_length(p_details::TEXT)>8192 THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_RESULT');
  END IF;
  SELECT * INTO v FROM public.cinema_safety_checks WHERE submission_id=p_submission_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','SUBMISSION_NOT_FOUND'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cinema_submissions s WHERE s.id=p_submission_id AND s.status='pending') THEN
    RETURN jsonb_build_object('ok',false,'code','SUBMISSION_CLOSED');
  END IF;
  INSERT INTO public.cinema_safety_check_events(submission_id,check_kind,verdict,provider,model,evidence_sha256,details)
  VALUES(p_submission_id,p_check_kind,p_verdict,btrim(p_provider),NULLIF(btrim(coalesce(p_model,'')),''),p_evidence_sha256,p_details);
  UPDATE public.cinema_safety_checks SET
    content_status=CASE WHEN p_check_kind='content' THEN p_verdict ELSE content_status END,
    child_safety_status=CASE WHEN p_check_kind='child_safety' THEN p_verdict ELSE child_safety_status END,
    malware_status=CASE WHEN p_check_kind='malware' THEN p_verdict ELSE malware_status END,
    updated_at=now() WHERE submission_id=p_submission_id;
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.list_cinema_submissions(p_auth_id TEXT,p_aal TEXT,p_mfa_at BIGINT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_aal IS DISTINCT FROM 'aal2' OR p_mfa_at IS NULL OR p_mfa_at < extract(epoch FROM now())-300 OR p_mfa_at > extract(epoch FROM now())+5
    OR NOT EXISTS(SELECT 1 FROM public.users u JOIN public.cinema_memberships m ON m.user_id=u.id WHERE u.auth_id=p_auth_id AND m.role='administrator' AND m.account_status='active')
  THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
  RETURN jsonb_build_object('submissions',coalesce((SELECT jsonb_agg(row_to_json(q)) FROM (
    SELECT sub.id,sub.content_id,sub.rights_version,sub.policy_version,sub.audience_rating,sub.content_warnings,sub.created_at,
      c.title,c.content_type,c.synopsis,c.language,c.ai_disclosures,c.categories,p.username,p.display_name,
      sc.content_status,sc.child_safety_status,sc.malware_status,sc.updated_at AS safety_updated_at,
      (SELECT count(*)::int FROM public.cinema_content e JOIN public.cinema_content se ON se.id=e.parent_id WHERE se.parent_id=c.id AND e.content_type='EPISODE') AS episode_count,
      (SELECT coalesce(sum(x.duration_seconds),0)::int FROM public.cinema_uploads x WHERE x.state='ready' AND x.content_id IN (SELECT public.cinema_title_rows(c.id))) AS duration_seconds,
      (SELECT count(*)::int FROM public.cinema_moderation_actions a WHERE a.content_id=c.id) AS prior_actions
    FROM public.cinema_submissions sub JOIN public.cinema_content c ON c.id=sub.content_id
    JOIN public.cinema_profiles p ON p.user_id=sub.creator_id JOIN public.cinema_memberships m ON m.user_id=sub.creator_id
    LEFT JOIN public.cinema_safety_checks sc ON sc.submission_id=sub.id
    WHERE sub.status='pending' AND m.account_status='active' ORDER BY sub.created_at,sub.id LIMIT 50
  ) q),'[]'::JSONB));
END $$;

CREATE OR REPLACE FUNCTION public.review_cinema_submission_safe(
  p_auth_id TEXT,p_aal TEXT,p_mfa_at BIGINT,p_idempotency_key UUID,p_submission_id UUID,
  p_decision TEXT,p_reason TEXT,p_creator_note TEXT,p_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor UUID; v_sub public.cinema_submissions%ROWTYPE; v_review public.cinema_submission_reviews%ROWTYPE;
  v_member public.cinema_memberships%ROWTYPE; v_checks public.cinema_safety_checks%ROWTYPE;
BEGIN
  IF p_aal IS DISTINCT FROM 'aal2' OR p_mfa_at IS NULL OR p_mfa_at < extract(epoch FROM now())-300 OR p_mfa_at > extract(epoch FROM now())+5 THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
  SELECT u.id INTO v_actor FROM public.users u JOIN public.cinema_memberships m ON m.user_id=u.id
    WHERE u.auth_id=p_auth_id AND m.role='administrator' AND m.account_status='active' FOR UPDATE OF m;
  IF v_actor IS NULL THEN RETURN jsonb_build_object('error','not_authorized'); END IF;
  IF p_request_id IS NULL OR p_idempotency_key IS NULL OR p_submission_id IS NULL OR p_decision IS NULL OR p_decision NOT IN ('approved','rejected')
    OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 OR (p_creator_note IS NOT NULL AND length(p_creator_note)>500)
  THEN RETURN jsonb_build_object('error','invalid_review'); END IF;
  SELECT * INTO v_review FROM public.cinema_submission_reviews WHERE actor_id=v_actor AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_review.submission_id=p_submission_id AND v_review.decision=p_decision AND v_review.reason=btrim(p_reason) THEN RETURN jsonb_build_object('id',p_submission_id,'status',v_review.decision,'idempotent',true); END IF;
    RETURN jsonb_build_object('error','idempotency_conflict');
  END IF;
  SELECT * INTO v_sub FROM public.cinema_submissions WHERE id=p_submission_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','submission_not_found'); END IF;
  IF v_sub.creator_id=v_actor THEN RETURN jsonb_build_object('error','self_review_forbidden'); END IF;
  IF v_sub.status<>'pending' THEN RETURN jsonb_build_object('error','already_reviewed'); END IF;
  SELECT * INTO v_member FROM public.cinema_memberships WHERE user_id=v_sub.creator_id FOR UPDATE;
  IF NOT FOUND OR v_member.account_status<>'active' THEN RETURN jsonb_build_object('error','account_not_active'); END IF;
  PERFORM 1 FROM public.cinema_content WHERE id=v_sub.content_id FOR UPDATE;
  SELECT * INTO v_checks FROM public.cinema_safety_checks WHERE submission_id=p_submission_id FOR UPDATE;
  IF p_decision='approved' THEN
    IF NOT FOUND OR 'pending'=ANY(ARRAY[v_checks.content_status,v_checks.child_safety_status,v_checks.malware_status]) THEN RETURN jsonb_build_object('error','safety_checks_pending'); END IF;
    IF ARRAY[v_checks.content_status,v_checks.child_safety_status,v_checks.malware_status] <> ARRAY['passed','passed','passed']::TEXT[] THEN RETURN jsonb_build_object('error','safety_checks_failed'); END IF;
    UPDATE public.cinema_content SET lifecycle_status='PUBLISHED',visibility='PUBLIC',published_at=now(),closed_at=NULL,review_note=NULL,updated_at=now()
      WHERE id IN (SELECT public.cinema_title_rows(v_sub.content_id));
  ELSE
    UPDATE public.cinema_content SET lifecycle_status='DRAFT',visibility='PRIVATE',
      review_note=CASE WHEN id=v_sub.content_id THEN NULLIF(btrim(coalesce(p_creator_note,'')),'') ELSE review_note END,updated_at=now()
      WHERE id IN (SELECT public.cinema_title_rows(v_sub.content_id));
  END IF;
  UPDATE public.cinema_submissions SET status=p_decision,decided_at=now() WHERE id=p_submission_id;
  INSERT INTO public.cinema_submission_reviews(submission_id,actor_id,idempotency_key,decision,reason,creator_note,request_id)
    VALUES(p_submission_id,v_actor,p_idempotency_key,p_decision,btrim(p_reason),NULLIF(btrim(coalesce(p_creator_note,'')),''),p_request_id);
  RETURN jsonb_build_object('id',p_submission_id,'content_id',v_sub.content_id,'status',p_decision,'idempotent',false);
END $$;

DO $$ DECLARE fn TEXT; BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.submit_cinema_title_safe(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT[],BOOLEAN,BOOLEAN)',
    'public.record_cinema_safety_check(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB)',
    'public.list_cinema_submissions(TEXT,TEXT,BIGINT)',
    'public.review_cinema_submission_safe(TEXT,TEXT,BIGINT,UUID,UUID,TEXT,TEXT,TEXT,UUID)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn);
  END LOOP;
END $$;

COMMIT;
