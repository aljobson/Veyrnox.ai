-- Persistent YouTube/SoundCloud references. Platform media bytes remain at the
-- provider; Veyrnox stores only official URLs and minimal oEmbed metadata.

-- Extend the telemetry allowlist without copying the large immutable route
-- inventory from 0455. Renaming preserves that function's revoked ACL; the
-- wrapper admits this migration's one new normalized route.
DO $$
BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0493(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(TEXT)
            RENAME TO telemetry_path_allowed_pre_0493;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT p_path = '/api/v1/music/reference-links'
        OR public.telemetry_path_allowed_pre_0493(p_path)
$$;

REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT)
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.music_reference_links (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('youtube', 'soundcloud')),
    external_id TEXT NOT NULL CHECK (char_length(external_id) BETWEEN 1 AND 201),
    canonical_url TEXT NOT NULL CHECK (char_length(canonical_url) BETWEEN 12 AND 1000 AND canonical_url LIKE 'https://%'),
    title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
    creator TEXT NOT NULL CHECK (char_length(btrim(creator)) BETWEEN 1 AND 120),
    thumbnail_url TEXT CHECK (thumbnail_url IS NULL OR (
        char_length(thumbnail_url) BETWEEN 12 AND 1000
        AND (thumbnail_url LIKE 'https://i.ytimg.com/%' OR thumbnail_url LIKE 'https://i1.sndcdn.com/%')
    )),
    embed_url TEXT NOT NULL CHECK (
        char_length(embed_url) BETWEEN 12 AND 1000
        AND ((provider = 'youtube' AND embed_url LIKE 'https://www.youtube-nocookie.com/embed/%')
          OR (provider = 'soundcloud' AND embed_url LIKE 'https://w.soundcloud.com/player/%'))
    ),
    rights_mode TEXT NOT NULL CHECK (rights_mode IN ('inspiration', 'owned_or_licensed')),
    idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._-]{8,120}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, user_id),
    UNIQUE (user_id, provider, external_id),
    UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS music_reference_links_user_created_idx
    ON public.music_reference_links(user_id, created_at DESC);

ALTER TABLE public.music_reference_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_reference_links FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.music_reference_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.music_reference_links TO service_role;

-- Reference links are lightweight, erasable preferences rather than generated
-- Music content. They cascade with the user and must not make account deletion
-- ineligible under the generic Music-content guard introduced in 0490.
CREATE OR REPLACE FUNCTION private.account_deletion_blockers(p_user_id UUID, p_auth_id TEXT)
RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
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
       AND r.relname <> 'music_reference_links'
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

REVOKE ALL ON FUNCTION private.account_deletion_blockers(UUID,TEXT) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.music_reference_links_forget_erased_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        DELETE FROM public.music_reference_links WHERE user_id = NEW.id;
    END IF;
    RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION private.music_reference_links_forget_erased_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.music_reference_links_forget_erased_user() TO service_role;
DROP TRIGGER IF EXISTS users_music_reference_links_forget_erased ON public.users;
CREATE TRIGGER users_music_reference_links_forget_erased
    AFTER UPDATE OF deleted_at ON public.users
    FOR EACH ROW EXECUTE FUNCTION private.music_reference_links_forget_erased_user();

CREATE OR REPLACE FUNCTION public.music_list_reference_links(p_auth_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_user UUID; v_links JSONB;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', r.id,
        'provider', r.provider,
        'external_id', r.external_id,
        'canonical_url', r.canonical_url,
        'title', r.title,
        'creator', r.creator,
        'thumbnail_url', r.thumbnail_url,
        'embed_url', r.embed_url,
        'rights_mode', r.rights_mode,
        'created_at', r.created_at
    ) ORDER BY r.created_at DESC), '[]'::jsonb)
    INTO v_links
    FROM (
        SELECT * FROM public.music_reference_links
         WHERE user_id = v_user
         ORDER BY created_at DESC, id DESC
         LIMIT 200
    ) r;
    RETURN jsonb_build_object('ok', true, 'links', v_links);
END $$;

CREATE OR REPLACE FUNCTION public.music_create_reference_link(
    p_auth_id TEXT,
    p_id UUID,
    p_provider TEXT,
    p_external_id TEXT,
    p_canonical_url TEXT,
    p_title TEXT,
    p_creator TEXT,
    p_thumbnail_url TEXT,
    p_embed_url TEXT,
    p_rights_mode TEXT,
    p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_user UUID; v_link public.music_reference_links%ROWTYPE;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id FOR UPDATE;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;

    SELECT * INTO v_link FROM public.music_reference_links
      WHERE user_id = v_user AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_link.provider IS DISTINCT FROM p_provider
           OR v_link.external_id IS DISTINCT FROM p_external_id
           OR v_link.rights_mode IS DISTINCT FROM p_rights_mode THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
        END IF;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'link', jsonb_build_object(
            'id', v_link.id, 'provider', v_link.provider, 'external_id', v_link.external_id,
            'canonical_url', v_link.canonical_url, 'title', v_link.title, 'creator', v_link.creator,
            'thumbnail_url', v_link.thumbnail_url, 'embed_url', v_link.embed_url,
            'rights_mode', v_link.rights_mode, 'created_at', v_link.created_at));
    END IF;

    IF EXISTS (SELECT 1 FROM public.music_reference_links
               WHERE user_id = v_user AND provider = p_provider AND external_id = p_external_id) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_SAVED');
    END IF;
    IF (SELECT count(*) FROM public.music_reference_links WHERE user_id = v_user) >= 200 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'REFERENCE_LIMIT_REACHED');
    END IF;

    INSERT INTO public.music_reference_links(
        id, user_id, provider, external_id, canonical_url, title, creator,
        thumbnail_url, embed_url, rights_mode, idempotency_key
    ) VALUES (
        p_id, v_user, p_provider, p_external_id, p_canonical_url, btrim(p_title), btrim(p_creator),
        p_thumbnail_url, p_embed_url, p_rights_mode, p_idempotency_key
    ) RETURNING * INTO v_link;

    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'link', jsonb_build_object(
        'id', v_link.id, 'provider', v_link.provider, 'external_id', v_link.external_id,
        'canonical_url', v_link.canonical_url, 'title', v_link.title, 'creator', v_link.creator,
        'thumbnail_url', v_link.thumbnail_url, 'embed_url', v_link.embed_url,
        'rights_mode', v_link.rights_mode, 'created_at', v_link.created_at));
END $$;

CREATE OR REPLACE FUNCTION public.music_get_reference_link_by_idempotency(p_auth_id TEXT, p_idempotency_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_user UUID; v_link public.music_reference_links%ROWTYPE;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    SELECT * INTO v_link FROM public.music_reference_links
      WHERE user_id = v_user AND idempotency_key = p_idempotency_key;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'found', false); END IF;
    RETURN jsonb_build_object('ok', true, 'found', true, 'link', jsonb_build_object(
        'id', v_link.id, 'provider', v_link.provider, 'external_id', v_link.external_id,
        'canonical_url', v_link.canonical_url, 'title', v_link.title, 'creator', v_link.creator,
        'thumbnail_url', v_link.thumbnail_url, 'embed_url', v_link.embed_url,
        'rights_mode', v_link.rights_mode, 'created_at', v_link.created_at));
END $$;

CREATE OR REPLACE FUNCTION public.music_delete_reference_link(p_auth_id TEXT, p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_user UUID; v_deleted UUID;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    DELETE FROM public.music_reference_links WHERE id = p_id AND user_id = v_user RETURNING id INTO v_deleted;
    IF v_deleted IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.music_list_reference_links(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.music_create_reference_link(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.music_get_reference_link_by_idempotency(TEXT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.music_delete_reference_link(TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_list_reference_links(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_create_reference_link(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_get_reference_link_by_idempotency(TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_delete_reference_link(TEXT,UUID) TO service_role;
