-- 0148_cinema_categories.sql — ADR-0059 addendum: title Categories.
--
-- A title carries one or two Categories from a fixed list, chosen by the
-- creator on the draft and required before submission. The catalogue can be
-- read by Category. The list lives in cinema_categories so it can grow by
-- migration; the app layer never invents one. Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.cinema_categories (
    slug       TEXT        PRIMARY KEY CHECK (slug ~ '^[a-z][a-z0-9-]{1,31}$'),
    label      TEXT        NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 40),
    position   INTEGER     NOT NULL UNIQUE CHECK (position BETWEEN 1 AND 1000),
    active     BOOLEAN     NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cinema_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_categories FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_categories FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO public.cinema_categories (slug, label, position) VALUES
    ('romance', 'Romance', 10), ('drama', 'Drama', 20), ('thriller', 'Thriller', 30), ('comedy', 'Comedy', 40),
    ('horror', 'Horror', 50), ('sci-fi', 'Sci-Fi', 60), ('fantasy', 'Fantasy', 70), ('action', 'Action', 80),
    ('mystery', 'Mystery', 90), ('documentary', 'Documentary', 100), ('animation', 'Animation', 110), ('kids', 'Kids', 120)
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE public.cinema_content ADD COLUMN IF NOT EXISTS categories TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.cinema_content DROP CONSTRAINT IF EXISTS cinema_content_categories_check;
ALTER TABLE public.cinema_content ADD CONSTRAINT cinema_content_categories_check
    CHECK (cardinality(categories) <= 2 AND (parent_id IS NULL OR cardinality(categories) = 0));
CREATE INDEX IF NOT EXISTS cinema_content_categories_idx ON public.cinema_content USING GIN (categories)
    WHERE lifecycle_status = 'PUBLISHED' AND parent_id IS NULL;

-- ── list_cinema_categories: the public list, in display order ─────────────
CREATE OR REPLACE FUNCTION public.list_cinema_categories()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object('slug', c.slug, 'label', c.label) ORDER BY c.position), '[]'::jsonb)
    FROM public.cinema_categories c WHERE c.active;
$$;

-- ── save_cinema_draft: 0134 body plus an optional `categories` key ────────
-- Zero to two active slugs on a FILM, SHORT, TRAILER or SERIES; none on a
-- SEASON or EPISODE. Submission (below) is where at least one becomes required.
CREATE OR REPLACE FUNCTION public.save_cinema_draft(p_auth_id TEXT,p_idempotency_key UUID,p_content_id UUID,p_revision INTEGER,p_draft JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_user UUID; v_member public.cinema_memberships%ROWTYPE;
  v_row public.cinema_content%ROWTYPE; v_parent public.cinema_content%ROWTYPE;
  v_old public.cinema_content_mutations%ROWTYPE;
  v_payload JSONB; v_result JSONB; v_parent_id UUID; v_position INTEGER; v_ai TEXT[]; v_cats TEXT[] := '{}';
BEGIN
  IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN jsonb_build_object('error','creator_required'); END IF;
  SELECT u.id INTO v_user FROM public.users u JOIN auth.users a ON a.id=p_auth_id::UUID WHERE u.auth_id=p_auth_id;
  SELECT * INTO v_member FROM public.cinema_memberships WHERE user_id=v_user FOR UPDATE;
  IF NOT FOUND OR v_member.role<>'creator' THEN RETURN jsonb_build_object('error','creator_required'); END IF;
  IF v_member.account_status<>'active' THEN RETURN jsonb_build_object('error','account_not_active'); END IF;
  IF p_idempotency_key IS NULL OR p_revision IS NULL OR p_revision<0
    OR p_draft IS NULL OR jsonb_typeof(p_draft)<>'object' THEN RETURN jsonb_build_object('error','invalid_draft'); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_draft) k WHERE k NOT IN ('content_type','parent_id','position','title','synopsis','language','ai_disclosures','categories'))
    OR jsonb_typeof(p_draft->'content_type') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_draft->'title') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_draft->'synopsis') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_draft->'language') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_draft->'ai_disclosures') IS DISTINCT FROM 'array'
    OR NOT (p_draft ?& ARRAY['parent_id','position']) THEN RETURN jsonb_build_object('error','invalid_draft'); END IF;
  IF p_draft->>'content_type' NOT IN ('FILM','SHORT','TRAILER','SERIES','SEASON','EPISODE')
    OR length(btrim(p_draft->>'title')) NOT BETWEEN 1 AND 160 OR length(p_draft->>'synopsis')>2000
    OR p_draft->>'language' !~ '^[a-z]{2,3}(-[A-Z]{2})?$'
    OR jsonb_array_length(p_draft->'ai_disclosures')>8 THEN RETURN jsonb_build_object('error','invalid_draft'); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_draft->'ai_disclosures') x WHERE jsonb_typeof(x)<>'string') THEN RETURN jsonb_build_object('error','invalid_draft'); END IF;
  SELECT coalesce(array_agg(x ORDER BY x),'{}') INTO v_ai FROM jsonb_array_elements_text(p_draft->'ai_disclosures') x;
  IF NOT (v_ai <@ ARRAY['generated_video','generated_voice','generated_music','synthetic_people','face_replacement','cloned_voice','generated_script','manipulated_real_world_footage']::TEXT[])
    OR cardinality(v_ai)<>(SELECT count(DISTINCT x) FROM unnest(v_ai) x) THEN RETURN jsonb_build_object('error','invalid_draft'); END IF;
  -- Categories: an optional array of at most two distinct active slugs, only on a root.
  IF p_draft ? 'categories' THEN
    IF jsonb_typeof(p_draft->'categories') IS DISTINCT FROM 'array' OR jsonb_array_length(p_draft->'categories')>2
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_draft->'categories') x WHERE jsonb_typeof(x)<>'string') THEN RETURN jsonb_build_object('error','invalid_draft'); END IF;
    SELECT coalesce(array_agg(x ORDER BY x),'{}') INTO v_cats FROM jsonb_array_elements_text(p_draft->'categories') x;
    IF cardinality(v_cats)<>(SELECT count(DISTINCT x) FROM unnest(v_cats) x)
      OR (SELECT count(*) FROM public.cinema_categories c WHERE c.active AND c.slug=ANY(v_cats))<>cardinality(v_cats) THEN RETURN jsonb_build_object('error','invalid_category'); END IF;
    IF cardinality(v_cats)>0 AND p_draft->>'content_type' IN ('SEASON','EPISODE') THEN RETURN jsonb_build_object('error','invalid_draft'); END IF;
  END IF;
  IF p_draft->>'content_type' IN ('SEASON','EPISODE') THEN
    IF jsonb_typeof(p_draft->'parent_id') IS DISTINCT FROM 'string' OR p_draft->>'parent_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR jsonb_typeof(p_draft->'position') IS DISTINCT FROM 'number' OR p_draft->>'position' !~ '^[1-9][0-9]{0,4}$' THEN RETURN jsonb_build_object('error','invalid_draft'); END IF;
    v_parent_id := (p_draft->>'parent_id')::UUID; v_position := (p_draft->>'position')::INTEGER;
    IF v_position>10000 THEN RETURN jsonb_build_object('error','invalid_draft'); END IF;
  ELSIF p_draft->'parent_id'<>'null'::JSONB OR p_draft->'position'<>'null'::JSONB THEN RETURN jsonb_build_object('error','invalid_draft'); END IF;
  v_payload := jsonb_build_object('id',p_content_id,'revision',p_revision,'draft',p_draft);
  SELECT * INTO v_old FROM public.cinema_content_mutations WHERE creator_id=v_user AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_old.payload<>v_payload THEN RETURN jsonb_build_object('error','idempotency_conflict'); END IF;
    RETURN v_old.result || jsonb_build_object('idempotent',true);
  END IF;
  IF v_parent_id IS NOT NULL THEN
    SELECT * INTO v_parent FROM public.cinema_content WHERE id=v_parent_id AND creator_id=v_user FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
    IF v_parent.lifecycle_status<>'DRAFT' OR v_parent.content_type<>(CASE WHEN p_draft->>'content_type'='SEASON' THEN 'SERIES' ELSE 'SEASON' END) THEN
      RETURN jsonb_build_object('error','invalid_parent'); END IF;
  END IF;
  IF p_content_id IS NULL THEN
    IF p_revision<>0 THEN RETURN jsonb_build_object('error','invalid_draft'); END IF;
    IF (SELECT count(*) FROM public.cinema_content WHERE creator_id=v_user)>=1000
      OR (SELECT count(*) FROM public.cinema_content WHERE creator_id=v_user AND parent_id IS NOT DISTINCT FROM v_parent_id)>=100 THEN
      RETURN jsonb_build_object('error','draft_limit_reached'); END IF;
    BEGIN
      INSERT INTO public.cinema_content(creator_id,content_type,parent_id,position,title,synopsis,language,ai_disclosures,categories)
      VALUES(v_user,p_draft->>'content_type',v_parent_id,v_position,btrim(p_draft->>'title'),p_draft->>'synopsis',p_draft->>'language',v_ai,v_cats) RETURNING * INTO v_row;
    EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('error','position_taken'); END;
  ELSE
    SELECT * INTO v_row FROM public.cinema_content WHERE id=p_content_id AND creator_id=v_user FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
    IF v_row.lifecycle_status<>'DRAFT' THEN RETURN jsonb_build_object('error','draft_locked'); END IF;
    IF v_row.revision<>p_revision THEN RETURN jsonb_build_object('error','revision_conflict'); END IF;
    IF v_row.content_type<>p_draft->>'content_type' OR v_row.parent_id IS DISTINCT FROM v_parent_id OR v_row.position IS DISTINCT FROM v_position THEN
      RETURN jsonb_build_object('error','structure_locked'); END IF;
    UPDATE public.cinema_content SET title=btrim(p_draft->>'title'),synopsis=p_draft->>'synopsis',language=p_draft->>'language',ai_disclosures=v_ai,
      categories=CASE WHEN p_draft ? 'categories' THEN v_cats ELSE categories END,revision=revision+1,updated_at=now()
      WHERE id=p_content_id RETURNING * INTO v_row;
  END IF;
  v_result := jsonb_build_object('id',v_row.id,'revision',v_row.revision,'idempotent',false);
  INSERT INTO public.cinema_content_mutations(creator_id,idempotency_key,payload,result) VALUES(v_user,p_idempotency_key,v_payload,v_result);
  RETURN v_result;
END $$;

-- ── submit_cinema_title: 0147 body plus "at least one Category" ──────────
CREATE OR REPLACE FUNCTION public.submit_cinema_title(p_auth_id TEXT, p_idempotency_key UUID, p_content_id UUID, p_rights_version TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user    UUID;
    v_member  public.cinema_memberships%ROWTYPE;
    v_root    public.cinema_content%ROWTYPE;
    v_old     public.cinema_submissions%ROWTYPE;
    v_eps     INTEGER;
    v_missing INTEGER;
    v_id      UUID;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('error', 'creator_required');
    END IF;
    SELECT u.id INTO v_user FROM public.users u JOIN auth.users a ON a.id = p_auth_id::UUID WHERE u.auth_id = p_auth_id;
    SELECT * INTO v_member FROM public.cinema_memberships WHERE user_id = v_user FOR UPDATE;
    IF NOT FOUND OR v_member.role <> 'creator' THEN RETURN jsonb_build_object('error', 'creator_required'); END IF;
    IF v_member.account_status <> 'active' THEN RETURN jsonb_build_object('error', 'account_not_active'); END IF;
    IF p_idempotency_key IS NULL OR p_content_id IS NULL OR p_rights_version IS NULL OR p_rights_version !~ '^[A-Za-z0-9._-]{1,32}$' THEN
        RETURN jsonb_build_object('error', 'invalid_submission');
    END IF;

    SELECT * INTO v_old FROM public.cinema_submissions WHERE creator_id = v_user AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_old.content_id <> p_content_id OR v_old.rights_version <> p_rights_version THEN
            RETURN jsonb_build_object('error', 'idempotency_conflict');
        END IF;
        RETURN jsonb_build_object('id', v_old.id, 'content_id', v_old.content_id, 'status', v_old.status, 'idempotent', true);
    END IF;

    SELECT * INTO v_root FROM public.cinema_content WHERE id = p_content_id AND creator_id = v_user FOR UPDATE;
    IF NOT FOUND OR v_root.parent_id IS NOT NULL OR v_root.content_type NOT IN ('FILM', 'SHORT', 'TRAILER', 'SERIES') THEN
        RETURN jsonb_build_object('error', 'content_not_found');
    END IF;
    IF v_root.lifecycle_status = 'UNDER_REVIEW' THEN RETURN jsonb_build_object('error', 'already_submitted'); END IF;
    IF v_root.lifecycle_status = 'PUBLISHED' THEN RETURN jsonb_build_object('error', 'already_published'); END IF;
    IF v_root.lifecycle_status = 'SUSPENDED' THEN RETURN jsonb_build_object('error', 'suspended'); END IF;
    -- A title reaches viewers through its Category, so it needs one before review.
    IF cardinality(v_root.categories) = 0
       OR (SELECT count(*) FROM public.cinema_categories c WHERE c.active AND c.slug = ANY(v_root.categories)) <> cardinality(v_root.categories) THEN
        RETURN jsonb_build_object('error', 'category_required');
    END IF;

    IF v_root.content_type = 'SERIES' THEN
        SELECT count(*), count(*) FILTER (WHERE NOT EXISTS (
            SELECT 1 FROM public.cinema_uploads x WHERE x.content_id = e.id AND x.state = 'ready'))
        INTO v_eps, v_missing
        FROM public.cinema_content e JOIN public.cinema_content s ON s.id = e.parent_id
        WHERE s.parent_id = v_root.id AND e.content_type = 'EPISODE';
        IF v_eps = 0 THEN RETURN jsonb_build_object('error', 'no_episodes'); END IF;
        IF v_missing > 0 THEN RETURN jsonb_build_object('error', 'video_not_ready', 'missing', v_missing); END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM public.cinema_uploads x WHERE x.content_id = v_root.id AND x.state = 'ready') THEN
        RETURN jsonb_build_object('error', 'video_not_ready', 'missing', 1);
    END IF;

    UPDATE public.cinema_content SET lifecycle_status = 'UNDER_REVIEW', visibility = 'PRIVATE',
        rights_version = p_rights_version, rights_at = now(), submitted_at = now(), review_note = NULL, updated_at = now()
    WHERE id IN (SELECT public.cinema_title_rows(v_root.id));

    INSERT INTO public.cinema_submissions (content_id, creator_id, idempotency_key, rights_version)
    VALUES (v_root.id, v_user, p_idempotency_key, p_rights_version)
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('id', v_id, 'content_id', v_root.id, 'status', 'pending', 'idempotent', false);
END $$;

-- ── Reads now carry categories; the catalogue can be filtered by one ──────
DROP FUNCTION IF EXISTS public.list_public_cinema_titles(INTEGER, TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION public.list_public_cinema_titles(p_limit INTEGER, p_before TIMESTAMPTZ, p_category TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
        SELECT c.id, c.content_type, c.title, c.synopsis, c.language, c.ai_disclosures, c.categories, c.published_at,
               p.username, p.display_name,
               (SELECT count(*)::int FROM public.cinema_content e JOIN public.cinema_content s ON s.id = e.parent_id
                WHERE s.parent_id = c.id AND e.content_type = 'EPISODE' AND e.lifecycle_status = 'PUBLISHED') AS episode_count,
               (SELECT x.duration_seconds::int FROM public.cinema_uploads x WHERE x.content_id = c.id AND x.state = 'ready') AS duration_seconds
        FROM public.cinema_content c
        JOIN public.cinema_profiles p ON p.user_id = c.creator_id
        JOIN public.cinema_memberships m ON m.user_id = c.creator_id
        WHERE c.parent_id IS NULL AND c.lifecycle_status = 'PUBLISHED' AND c.visibility = 'PUBLIC'
          AND c.published_at IS NOT NULL AND m.account_status = 'active'
          AND (p_before IS NULL OR c.published_at < p_before)
          AND (p_category IS NULL OR p_category = ANY(c.categories))
        ORDER BY c.published_at DESC, c.id DESC
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 50)
    ) t;
$$;

CREATE OR REPLACE FUNCTION public.read_public_cinema_title(p_auth_id TEXT, p_content_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_root public.cinema_content%ROWTYPE;
    v_head JSONB;
BEGIN
    SELECT * INTO v_root FROM public.cinema_content c WHERE c.id = p_content_id AND c.parent_id IS NULL
      AND c.lifecycle_status = 'PUBLISHED' AND c.visibility = 'PUBLIC'
      AND EXISTS (SELECT 1 FROM public.cinema_memberships m WHERE m.user_id = c.creator_id AND m.account_status = 'active');
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'title_not_found'); END IF;
    SELECT jsonb_build_object('id', v_root.id, 'content_type', v_root.content_type, 'title', v_root.title, 'synopsis', v_root.synopsis,
        'language', v_root.language, 'ai_disclosures', to_jsonb(v_root.ai_disclosures), 'categories', to_jsonb(v_root.categories),
        'published_at', v_root.published_at,
        'creator', jsonb_build_object('username', p.username, 'display_name', p.display_name))
    INTO v_head FROM public.cinema_profiles p WHERE p.user_id = v_root.creator_id;
    IF v_root.content_type = 'SERIES' THEN
        RETURN v_head || jsonb_build_object('seasons', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', s.id, 'position', s.position, 'title', s.title, 'episodes', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('id', e.id, 'position', e.position, 'title', e.title, 'synopsis', e.synopsis,
                    'duration_seconds', (SELECT x.duration_seconds::int FROM public.cinema_uploads x WHERE x.content_id = e.id AND x.state = 'ready'))
                    || public.cinema_entitlement(p_auth_id, e.id) ORDER BY e.position)
                FROM public.cinema_content e WHERE e.parent_id = s.id AND e.content_type = 'EPISODE' AND e.lifecycle_status = 'PUBLISHED'), '[]'::jsonb))
                ORDER BY s.position)
            FROM public.cinema_content s WHERE s.parent_id = v_root.id AND s.content_type = 'SEASON' AND s.lifecycle_status = 'PUBLISHED'), '[]'::jsonb));
    END IF;
    RETURN v_head || jsonb_build_object('duration_seconds',
        (SELECT x.duration_seconds::int FROM public.cinema_uploads x WHERE x.content_id = v_root.id AND x.state = 'ready'))
        || public.cinema_entitlement(p_auth_id, v_root.id);
END $$;

CREATE OR REPLACE FUNCTION public.list_own_cinema_content(p_auth_id TEXT, p_parent_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_member public.cinema_memberships%ROWTYPE;
BEGIN
  IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN jsonb_build_object('error','creator_required'); END IF;
  SELECT u.id INTO v_user FROM public.users u JOIN auth.users a ON a.id=p_auth_id::UUID WHERE u.auth_id=p_auth_id;
  SELECT * INTO v_member FROM public.cinema_memberships WHERE user_id=v_user;
  IF NOT FOUND OR v_member.role<>'creator' THEN RETURN jsonb_build_object('error','creator_required'); END IF;
  IF v_member.account_status<>'active' THEN RETURN jsonb_build_object('error','account_not_active'); END IF;
  IF p_parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.cinema_content WHERE id=p_parent_id AND creator_id=v_user) THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
  RETURN jsonb_build_object('content',coalesce((SELECT jsonb_agg(row_to_json(c) ORDER BY c.position NULLS FIRST,c.created_at,c.id) FROM (
    SELECT id,content_type,parent_id,position,title,synopsis,language,ai_disclosures,categories,lifecycle_status,visibility,revision,created_at,updated_at,
           submitted_at,published_at,closed_at,review_note,rights_version,
           EXISTS(SELECT 1 FROM public.cinema_uploads x WHERE x.content_id=cinema_content.id AND x.state='ready') AS video_ready
    FROM public.cinema_content WHERE creator_id=v_user AND parent_id IS NOT DISTINCT FROM p_parent_id) c),'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.list_cinema_submissions(p_auth_id TEXT, p_aal TEXT, p_mfa_at BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_aal IS DISTINCT FROM 'aal2' OR p_mfa_at IS NULL OR p_mfa_at < extract(epoch FROM now()) - 300 OR p_mfa_at > extract(epoch FROM now()) + 5
       OR NOT EXISTS (SELECT 1 FROM public.users u JOIN public.cinema_memberships m ON m.user_id = u.id
                      WHERE u.auth_id = p_auth_id AND m.role = 'administrator' AND m.account_status = 'active') THEN
        RETURN jsonb_build_object('error', 'not_authorized');
    END IF;
    RETURN jsonb_build_object('submissions', COALESCE((SELECT jsonb_agg(row_to_json(s)) FROM (
        SELECT sub.id, sub.content_id, sub.rights_version, sub.created_at,
               c.title, c.content_type, c.synopsis, c.language, c.ai_disclosures, c.categories,
               p.username, p.display_name,
               (SELECT count(*)::int FROM public.cinema_content e JOIN public.cinema_content se ON se.id = e.parent_id
                WHERE se.parent_id = c.id AND e.content_type = 'EPISODE') AS episode_count,
               (SELECT COALESCE(sum(x.duration_seconds), 0)::int FROM public.cinema_uploads x
                WHERE x.state = 'ready' AND x.content_id IN (SELECT public.cinema_title_rows(c.id))) AS duration_seconds,
               (SELECT count(*)::int FROM public.cinema_moderation_actions a WHERE a.content_id = c.id) AS prior_actions
        FROM public.cinema_submissions sub
        JOIN public.cinema_content c ON c.id = sub.content_id
        JOIN public.cinema_profiles p ON p.user_id = sub.creator_id
        JOIN public.cinema_memberships m ON m.user_id = sub.creator_id
        WHERE sub.status = 'pending' AND m.account_status = 'active'
        ORDER BY sub.created_at, sub.id LIMIT 50
    ) s), '[]'::jsonb));
END $$;

-- ── Grants ────────────────────────────────────────────────────────────────
DO $$
DECLARE fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.list_cinema_categories()',
        'public.save_cinema_draft(TEXT, UUID, UUID, INTEGER, JSONB)',
        'public.submit_cinema_title(TEXT, UUID, UUID, TEXT)',
        'public.list_public_cinema_titles(INTEGER, TIMESTAMPTZ, TEXT)',
        'public.read_public_cinema_title(TEXT, UUID)',
        'public.list_own_cinema_content(TEXT, UUID)',
        'public.list_cinema_submissions(TEXT, TEXT, BIGINT)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END $$;
