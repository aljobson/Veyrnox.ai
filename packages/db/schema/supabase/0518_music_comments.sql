-- 0518: comments on public Music tracks (song page parity, slice 3).
-- docs/product/music-song-page-plan-2026-11-14.md.
--
-- Owner decision (2026-11-14): every comment waits for administrator approval
-- before anyone else sees it, as in Cinema (0267). A track takes comments only
-- when its publication has allow_comments = true. Text only, 1-1000 characters,
-- an optional moment in the song, one level of replies. Listeners can report an
-- approved comment; administrators review both queues. Rows are erased with the
-- account, so the Music deletion guard skips these three tables. Nothing here
-- spends or grants credits. Off until MUSIC_RUNTIME_FLAGS comments is true.

CREATE TABLE IF NOT EXISTS public.music_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    publication_id UUID NOT NULL REFERENCES public.music_publications(id) ON DELETE CASCADE,
    parent_id UUID NULL REFERENCES public.music_comments(id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
    at_seconds NUMERIC(6,1) NULL CHECK (at_seconds IS NULL OR at_seconds BETWEEN 0 AND 600),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'removed', 'withdrawn')),
    reviewed_by UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ NULL,
    review_reason TEXT NULL CHECK (review_reason IS NULL OR char_length(review_reason) BETWEEN 3 AND 500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS music_comments_publication_idx ON public.music_comments(publication_id, status, created_at DESC, id);
CREATE INDEX IF NOT EXISTS music_comments_author_idx ON public.music_comments(author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS music_comments_pending_idx ON public.music_comments(created_at, id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.music_comment_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    comment_id UUID NOT NULL REFERENCES public.music_comments(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('spam', 'abuse', 'privacy', 'rights', 'other')),
    details TEXT NOT NULL CHECK (char_length(btrim(details)) BETWEEN 3 AND 500),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (reporter_id, comment_id)
);
CREATE INDEX IF NOT EXISTS music_comment_reports_open_idx ON public.music_comment_reports(created_at, id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS music_comment_reports_comment_idx ON public.music_comment_reports(comment_id);

CREATE TABLE IF NOT EXISTS public.music_comment_mutations (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._-]{8,120}$'),
    payload JSONB NOT NULL,
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, idempotency_key)
);

DO $$ DECLARE t TEXT; BEGIN
    FOREACH t IN ARRAY ARRAY['music_comments', 'music_comment_reports', 'music_comment_mutations'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', t);
    END LOOP;
END $$;

-- A commenter's public name: their Music creator name if they have one.
CREATE OR REPLACE FUNCTION private.music_commenter_name(p_user UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT coalesce((SELECT display_name FROM public.music_creator_profiles WHERE user_id = p_user), 'Listener');
$$;

-- Listener actions: submit, withdraw (own), report (someone else's approved comment).
CREATE OR REPLACE FUNCTION public.music_comment_mutate(p_auth_id TEXT, p_idempotency_key TEXT, p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_action TEXT; v_pub public.music_publications%ROWTYPE; v_parent public.music_comments%ROWTYPE;
        v_comment public.music_comments%ROWTYPE; v_old public.music_comment_mutations%ROWTYPE; v_id UUID; v_result JSONB;
BEGIN
    IF p_auth_id IS NULL OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$'
       OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL AND frozen_at IS NULL;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    v_action := p_payload->>'action';
    IF v_action = 'submit' THEN
        IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action', 'slug', 'body', 'at_seconds', 'parent_id'))
           OR coalesce(p_payload->>'slug', '') !~ '^[a-f0-9]{24}$'
           OR jsonb_typeof(p_payload->'body') IS DISTINCT FROM 'string'
           OR char_length(btrim(p_payload->>'body')) NOT BETWEEN 1 AND 1000
           OR (p_payload ? 'at_seconds' AND (jsonb_typeof(p_payload->'at_seconds') IS DISTINCT FROM 'number' OR (p_payload->>'at_seconds')::NUMERIC NOT BETWEEN 0 AND 600))
           OR (p_payload ? 'parent_id' AND coalesce(p_payload->>'parent_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
            RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
        END IF;
    ELSIF v_action IN ('withdraw', 'report') THEN
        IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action', 'comment_id', 'category', 'details'))
           OR coalesce(p_payload->>'comment_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           OR (v_action = 'withdraw' AND (p_payload ? 'category' OR p_payload ? 'details'))
           OR (v_action = 'report' AND (coalesce(p_payload->>'category', '') NOT IN ('spam', 'abuse', 'privacy', 'rights', 'other')
               OR jsonb_typeof(p_payload->'details') IS DISTINCT FROM 'string' OR char_length(btrim(p_payload->>'details')) NOT BETWEEN 3 AND 500)) THEN
            RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
        END IF;
    ELSE
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;

    PERFORM pg_advisory_xact_lock(518, hashtext(v_user::text));
    SELECT * INTO v_old FROM public.music_comment_mutations WHERE user_id = v_user AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_old.payload IS DISTINCT FROM p_payload THEN RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT'); END IF;
        RETURN v_old.result || jsonb_build_object('idempotent', true);
    END IF;

    IF v_action = 'submit' THEN
        SELECT * INTO v_pub FROM public.music_publications WHERE slug = p_payload->>'slug' AND status = 'published' FOR SHARE;
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
        IF NOT v_pub.allow_comments THEN RETURN jsonb_build_object('ok', false, 'code', 'COMMENTS_CLOSED'); END IF;
        IF p_payload ? 'parent_id' THEN
            SELECT * INTO v_parent FROM public.music_comments WHERE id = (p_payload->>'parent_id')::UUID;
            IF NOT FOUND OR v_parent.publication_id <> v_pub.id OR v_parent.status <> 'approved' OR v_parent.parent_id IS NOT NULL THEN
                RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
            END IF;
        END IF;
        IF (SELECT count(*) FROM public.music_comments WHERE author_id = v_user AND status = 'pending') >= 5 THEN
            RETURN jsonb_build_object('ok', false, 'code', 'LIMIT_REACHED');
        END IF;
        IF EXISTS (SELECT 1 FROM public.music_comments WHERE author_id = v_user AND created_at > now() - interval '1 minute')
           OR (SELECT count(*) FROM public.music_comments WHERE author_id = v_user AND created_at > now() - interval '24 hours') >= 20 THEN
            RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
        END IF;
        INSERT INTO public.music_comments(author_id, publication_id, parent_id, body, at_seconds)
        VALUES (v_user, v_pub.id, (p_payload->>'parent_id')::UUID, btrim(p_payload->>'body'), (p_payload->>'at_seconds')::NUMERIC)
        RETURNING id INTO v_id;
        v_result := jsonb_build_object('ok', true, 'id', v_id, 'status', 'pending');
    ELSE
        SELECT * INTO v_comment FROM public.music_comments WHERE id = (p_payload->>'comment_id')::UUID FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
        IF v_action = 'withdraw' THEN
            IF v_comment.author_id <> v_user THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
            UPDATE public.music_comments SET status = 'withdrawn', updated_at = now() WHERE id = v_comment.id;
            v_result := jsonb_build_object('ok', true, 'id', v_comment.id, 'status', 'withdrawn');
        ELSE
            IF v_comment.author_id = v_user OR v_comment.status <> 'approved' THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
            IF EXISTS (SELECT 1 FROM public.music_comment_reports WHERE reporter_id = v_user AND comment_id = v_comment.id) THEN
                v_result := jsonb_build_object('ok', true, 'id', v_comment.id, 'status', 'reported');
            ELSE
                IF (SELECT count(*) FROM public.music_comment_reports WHERE reporter_id = v_user AND created_at > now() - interval '24 hours') >= 20 THEN
                    RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
                END IF;
                INSERT INTO public.music_comment_reports(reporter_id, comment_id, category, details)
                VALUES (v_user, v_comment.id, p_payload->>'category', btrim(p_payload->>'details'));
                v_result := jsonb_build_object('ok', true, 'id', v_comment.id, 'status', 'reported');
            END IF;
        END IF;
    END IF;
    INSERT INTO public.music_comment_mutations(user_id, idempotency_key, payload, result) VALUES (v_user, p_idempotency_key, p_payload, v_result);
    RETURN v_result;
END $$;

-- Approved comments of a public track, newest first, 25 a page. With an auth id,
-- also that person's own comments that are not approved (so they see "waiting").
CREATE OR REPLACE FUNCTION public.music_comments_read(p_slug TEXT, p_auth_id TEXT, p_before_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_pub public.music_publications%ROWTYPE; v_viewer UUID; v_before TIMESTAMPTZ; v_items JSONB; v_own JSONB; v_next UUID;
BEGIN
    IF p_slug IS NULL OR p_slug !~ '^[a-f0-9]{24}$' THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS'); END IF;
    SELECT * INTO v_pub FROM public.music_publications WHERE slug = p_slug AND status = 'published';
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    IF p_auth_id IS NOT NULL THEN SELECT id INTO v_viewer FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL; END IF;
    IF p_before_id IS NOT NULL THEN
        SELECT created_at INTO v_before FROM public.music_comments WHERE id = p_before_id AND publication_id = v_pub.id AND status = 'approved';
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS'); END IF;
    END IF;
    SELECT coalesce(jsonb_agg(item ORDER BY created_at DESC, id DESC), '[]'::jsonb) INTO v_items FROM (
        SELECT c.created_at, c.id, jsonb_build_object(
            'id', c.id, 'parent_id', c.parent_id, 'body', c.body, 'at_seconds', c.at_seconds, 'created_at', c.created_at,
            'author', private.music_commenter_name(c.author_id), 'is_creator', c.author_id = v_pub.user_id,
            'own', v_viewer IS NOT NULL AND c.author_id = v_viewer) AS item
        FROM public.music_comments c JOIN public.users u ON u.id = c.author_id
        WHERE c.publication_id = v_pub.id AND c.status = 'approved' AND u.deleted_at IS NULL AND u.frozen_at IS NULL
          AND (v_before IS NULL OR (c.created_at, c.id) < (v_before, p_before_id))
        ORDER BY c.created_at DESC, c.id DESC LIMIT 26
    ) x;
    IF jsonb_array_length(v_items) > 25 THEN v_next := (v_items->24->>'id')::UUID; v_items := v_items - 25; END IF;
    IF v_viewer IS NOT NULL THEN
        SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'parent_id', parent_id, 'body', body, 'status', status, 'created_at', created_at) ORDER BY created_at DESC), '[]'::jsonb)
        INTO v_own FROM (SELECT * FROM public.music_comments WHERE author_id = v_viewer AND publication_id = v_pub.id AND status IN ('pending', 'rejected') ORDER BY created_at DESC LIMIT 25) o;
    END IF;
    RETURN jsonb_build_object('ok', true, 'allow_comments', v_pub.allow_comments, 'comments', v_items, 'own_comments', coalesce(v_own, '[]'::jsonb), 'next_cursor', v_next);
END $$;

-- Administrator queue: pending comments and open reports, oldest first, 50 each.
CREATE OR REPLACE FUNCTION public.music_comment_review_list(p_auth_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE auth_id = p_auth_id AND is_admin IS TRUE AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object('ok', true,
        'comments', coalesce((SELECT jsonb_agg(x ORDER BY created_at, id) FROM (
            SELECT c.id, c.body, c.at_seconds, c.parent_id, c.created_at, p.slug, s.title, private.music_commenter_name(c.author_id) AS author
            FROM public.music_comments c JOIN public.music_publications p ON p.id = c.publication_id JOIN public.music_songs s ON s.id = p.song_id
            WHERE c.status = 'pending' ORDER BY c.created_at, c.id LIMIT 50) x), '[]'::jsonb),
        'reports', coalesce((SELECT jsonb_agg(x ORDER BY created_at, id) FROM (
            SELECT r.id, r.comment_id, r.category, r.details, r.created_at, c.body, c.status AS comment_status, p.slug, s.title
            FROM public.music_comment_reports r JOIN public.music_comments c ON c.id = r.comment_id
            JOIN public.music_publications p ON p.id = c.publication_id JOIN public.music_songs s ON s.id = p.song_id
            WHERE r.status = 'open' ORDER BY r.created_at, r.id LIMIT 50) x), '[]'::jsonb));
END $$;

-- Administrator decision: approve, reject or remove a comment, or resolve a report.
CREATE OR REPLACE FUNCTION public.music_comment_review(p_auth_id TEXT, p_idempotency_key TEXT, p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_admin UUID; v_action TEXT; v_id UUID; v_decision TEXT; v_comment public.music_comments%ROWTYPE;
        v_old public.music_comment_mutations%ROWTYPE; v_prior TEXT; v_result JSONB; v_pub_owner UUID;
BEGIN
    SELECT id INTO v_admin FROM public.users WHERE auth_id = p_auth_id AND is_admin IS TRUE AND deleted_at IS NULL;
    IF v_admin IS NULL THEN RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501'; END IF;
    IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action', 'id', 'decision', 'reason'))
       OR coalesce(p_payload->>'action', '') NOT IN ('review_comment', 'resolve_report')
       OR coalesce(p_payload->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' OR char_length(btrim(p_payload->>'reason')) NOT BETWEEN 3 AND 500 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    v_action := p_payload->>'action'; v_id := (p_payload->>'id')::UUID; v_decision := p_payload->>'decision';
    IF (v_action = 'review_comment' AND coalesce(v_decision, '') NOT IN ('approved', 'rejected', 'removed'))
       OR (v_action = 'resolve_report' AND p_payload ? 'decision') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    PERFORM pg_advisory_xact_lock(519, hashtext(v_admin::text));
    SELECT * INTO v_old FROM public.music_comment_mutations WHERE user_id = v_admin AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_old.payload IS DISTINCT FROM p_payload THEN RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT'); END IF;
        RETURN v_old.result || jsonb_build_object('idempotent', true);
    END IF;
    IF v_action = 'review_comment' THEN
        SELECT * INTO v_comment FROM public.music_comments WHERE id = v_id FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
        SELECT user_id INTO v_pub_owner FROM public.music_publications WHERE id = v_comment.publication_id;
        -- No one reviews their own comment or comments on their own track.
        IF v_comment.author_id = v_admin OR v_pub_owner = v_admin THEN RETURN jsonb_build_object('ok', false, 'code', 'SELF_REVIEW'); END IF;
        v_prior := v_comment.status;
        IF (v_decision IN ('approved', 'rejected') AND v_prior <> 'pending') OR (v_decision = 'removed' AND v_prior <> 'approved') THEN
            RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_REVIEWED');
        END IF;
        UPDATE public.music_comments SET status = v_decision, reviewed_by = v_admin, reviewed_at = now(),
            review_reason = btrim(p_payload->>'reason'), updated_at = now() WHERE id = v_id;
        v_result := jsonb_build_object('ok', true, 'id', v_id, 'status', v_decision, 'prior_status', v_prior);
    ELSE
        SELECT status INTO v_prior FROM public.music_comment_reports WHERE id = v_id FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
        IF v_prior <> 'open' THEN RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_REVIEWED'); END IF;
        UPDATE public.music_comment_reports SET status = 'resolved' WHERE id = v_id;
        v_result := jsonb_build_object('ok', true, 'id', v_id, 'status', 'resolved', 'prior_status', v_prior);
    END IF;
    INSERT INTO public.music_comment_mutations(user_id, idempotency_key, payload, result) VALUES (v_admin, p_idempotency_key, p_payload, v_result);
    RETURN v_result;
END $$;

-- Erase with the account.
CREATE OR REPLACE FUNCTION private.music_comments_forget_erased_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        DELETE FROM public.music_comments WHERE author_id = NEW.id;
        DELETE FROM public.music_comment_reports WHERE reporter_id = NEW.id;
        DELETE FROM public.music_comment_mutations WHERE user_id = NEW.id;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS users_music_comments_forget_erased ON public.users;
CREATE TRIGGER users_music_comments_forget_erased
    AFTER UPDATE OF deleted_at ON public.users
    FOR EACH ROW EXECUTE FUNCTION private.music_comments_forget_erased_user();

-- 0515's guard, with the three comment tables also skipped.
CREATE OR REPLACE FUNCTION private.account_deletion_blockers(p_user_id UUID, p_auth_id TEXT)
RETURNS TEXT[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_blockers TEXT[]; v_auth UUID; v_ref RECORD; v_music_present BOOLEAN;
BEGIN
  v_blockers := ARRAY[]::TEXT[];
  BEGIN v_auth := p_auth_id::uuid; EXCEPTION WHEN invalid_text_representation THEN v_auth := NULL; END;
  IF EXISTS (SELECT 1 FROM public.users u WHERE u.id=p_user_id AND u.frozen_at IS NOT NULL) THEN v_blockers:=array_append(v_blockers,'account_frozen'); END IF;
  IF EXISTS (SELECT 1 FROM public.evidence_holds h JOIN public.jobs j ON j.id=h.job_id WHERE j.user_id=p_user_id AND h.released_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.assets a JOIN public.jobs j ON j.id=a.job_id WHERE j.user_id=p_user_id AND a.held_at IS NOT NULL) THEN v_blockers:=array_append(v_blockers,'account_on_hold'); END IF;
  IF EXISTS (SELECT 1 FROM public.credit_subscriptions s WHERE s.user_id=p_user_id AND s.status IN ('active','past_due'))
     OR EXISTS (SELECT 1 FROM public.social_publish_subscriptions s WHERE s.user_id=p_user_id AND s.status IN ('active','past_due')) THEN v_blockers:=array_append(v_blockers,'active_subscription'); END IF;
  IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.user_id=p_user_id AND j.state IN ('DEBITED','SUBMITTED','FAILOVER')) THEN v_blockers:=array_append(v_blockers,'generation_in_progress'); END IF;
  IF EXISTS (SELECT 1 FROM public.top_ups t WHERE t.user_id=p_user_id AND t.status='pending' AND t.created_at>now()-interval '2 hours') THEN v_blockers:=array_append(v_blockers,'top_up_in_progress'); END IF;
  IF EXISTS (SELECT 1 FROM public.cinema_content c WHERE c.creator_id=p_user_id)
     OR EXISTS (SELECT 1 FROM public.cinema_uploads c WHERE c.creator_id=p_user_id AND c.deleted_at IS NULL) THEN v_blockers:=array_append(v_blockers,'cinema_content_present'); END IF;
  IF v_auth IS NOT NULL AND EXISTS (SELECT 1 FROM public.projects p WHERE p.owner_id=v_auth AND p.deleted_at IS NULL) THEN v_blockers:=array_append(v_blockers,'projects_present'); END IF;
  IF EXISTS (SELECT 1 FROM public.social_brands b JOIN public.social_brand_members m ON m.brand_id=b.id WHERE b.owner_user_id=p_user_id AND m.user_id<>p_user_id) THEN v_blockers:=array_append(v_blockers,'publish_team_present'); END IF;
  IF EXISTS (SELECT 1 FROM public.voice_profiles v WHERE v.user_id=p_user_id AND v.status<>'revoked') THEN v_blockers:=array_append(v_blockers,'voice_profile_present'); END IF;
  -- Inspect every direct Music foreign key to users, including collaborator and
  -- inviter/invitee columns. This also makes a future Music table fail closed
  -- before the classification tests require an explicit retention decision.
  FOR v_ref IN
    SELECT c.conrelid, a.attname
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class r ON r.oid=c.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
      JOIN LATERAL unnest(c.conkey) k(attnum) ON true
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
     WHERE c.contype='f' AND c.confrelid='public.users'::regclass
       AND n.nspname='public' AND r.relname LIKE 'music!_%' ESCAPE '!'
       AND r.relname NOT IN ('music_reference_links', 'music_song_reactions', 'music_creator_follows', 'music_social_mutations',
                             'music_comments', 'music_comment_reports', 'music_comment_mutations')
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I=$1)', v_ref.conrelid::regclass, v_ref.attname)
       INTO v_music_present USING p_user_id;
    IF v_music_present THEN
      v_blockers:=array_append(v_blockers,'music_content_present');
      EXIT;
    END IF;
  END LOOP;
  RETURN v_blockers;
END $$;

-- Admit the new routes and the admin page in the privacy-safe route telemetry allowlist.
DO $$
BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0518(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(TEXT) RENAME TO telemetry_path_allowed_pre_0518;
    END IF;
END $$;
CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT p_path IN ('/api/v1/music/comments', '/api/v1/admin/music-comments', '/app/admin/music-comments')
        OR public.telemetry_path_allowed_pre_0518(p_path)
$$;
REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.account_deletion_blockers(UUID,TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.music_comments_forget_erased_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.music_comments_forget_erased_user() TO service_role;
REVOKE ALL ON FUNCTION private.music_commenter_name(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.music_commenter_name(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.music_comment_mutate(TEXT,TEXT,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_comment_mutate(TEXT,TEXT,JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.music_comments_read(TEXT,TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_comments_read(TEXT,TEXT,UUID) TO service_role;
REVOKE ALL ON FUNCTION public.music_comment_review_list(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_comment_review_list(TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.music_comment_review(TEXT,TEXT,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_comment_review(TEXT,TEXT,JSONB) TO service_role;
