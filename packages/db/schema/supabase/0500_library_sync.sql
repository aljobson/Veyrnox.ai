-- ADR-0340 (proposed): Library favourites and the unsent Create draft follow the account, on web and in the mobile app.
--
-- Until now a starred creation lived in one browser's localStorage or one phone's cache, and an unsent Create prompt in
-- one tab or one phone. Two small per-account stores fix that. Neither touches credits, the ledger, prices or access.
--
--   library_favourites  one row per starred creation: (user, job). The job must be the caller's own, so one account can
--                       never star, learn of or list another account's creation. At most 200 per account (the cap both
--                       clients already apply).
--   create_drafts       at most one unsent Create draft per account: words and settings only (no file, no idempotency
--                       key, so restoring never re-sends or re-charges anything), last write wins, 24 h life on read.
--
-- Reached only through SECURITY DEFINER functions the Worker calls with the service role (the browser roles hold no grant):
--   get_library_sync(auth_id)                  favourites (newest first) and the draft, in one read
--   set_library_favourite(auth_id, job, bool)  star or unstar; replaying either changes nothing
--   put_create_draft(auth_id, draft)           validate + replace
--   clear_create_draft(auth_id)                remove
--
-- Account deletion (ADR-0111): the trigger at the bottom removes both tables' rows in the transaction that sets
-- users.deleted_at. The privacy export (ADR-0250) gains `library_favourites` and `create_draft` in the `profile` section
-- through one more wrapper over the existing function. Idempotent: IF NOT EXISTS, OR REPLACE, DROP TRIGGER IF EXISTS,
-- REVOKE/GRANT re-run, the renames are guarded.

CREATE TABLE IF NOT EXISTS public.library_favourites (
    user_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    job_id     UUID        NOT NULL REFERENCES public.jobs(id)  ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, job_id)
);
CREATE INDEX IF NOT EXISTS library_favourites_user_idx ON public.library_favourites (user_id, created_at DESC);
ALTER TABLE public.library_favourites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_favourites FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.library_favourites FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.create_drafts (
    user_id    UUID        PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    draft      JSONB       NOT NULL CHECK (jsonb_typeof(draft) = 'object'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.create_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.create_drafts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.create_drafts FROM PUBLIC, anon, authenticated, service_role;

-- ── Read ─────────────────────────────────────────────────────────────────────
-- Favourites of a creation that has since been deleted by its owner (jobs.deleted_at, ADR-0116) are left out.
CREATE OR REPLACE FUNCTION public.get_library_sync(p_auth_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_ids     JSONB;
    v_draft   public.create_drafts%ROWTYPE;
BEGIN
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'account_not_found'); END IF;

    SELECT COALESCE(jsonb_agg(f.job_id ORDER BY f.created_at DESC, f.job_id), '[]'::jsonb) INTO v_ids
      FROM public.library_favourites f
      JOIN public.jobs j ON j.id = f.job_id AND j.user_id = v_user_id AND j.deleted_at IS NULL
     WHERE f.user_id = v_user_id;

    SELECT * INTO v_draft FROM public.create_drafts WHERE user_id = v_user_id AND updated_at > now() - interval '24 hours';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', true, 'favourites', v_ids, 'draft', NULL, 'draft_updated_at', NULL);
    END IF;
    RETURN jsonb_build_object('ok', true, 'favourites', v_ids, 'draft', v_draft.draft, 'draft_updated_at', v_draft.updated_at);
END $$;
REVOKE ALL ON FUNCTION public.get_library_sync(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_library_sync(TEXT) TO service_role;

-- ── Star / unstar ────────────────────────────────────────────────────────────
-- Starring a creation that is not the caller's, or that was deleted, answers job_not_found (the same word for both, so a
-- caller cannot tell another account's job from a missing one). The 201st star is refused with too_many_favourites.
CREATE OR REPLACE FUNCTION public.set_library_favourite(p_auth_id TEXT, p_job_id UUID, p_starred BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_count   INTEGER;
    v_changed BOOLEAN;
BEGIN
    IF p_job_id IS NULL OR p_starred IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_favourite');
    END IF;

    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'account_not_found'); END IF;

    IF NOT p_starred THEN
        DELETE FROM public.library_favourites WHERE user_id = v_user_id AND job_id = p_job_id;
        GET DIAGNOSTICS v_count = ROW_COUNT;
        RETURN jsonb_build_object('ok', true, 'changed', v_count > 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = p_job_id AND user_id = v_user_id AND deleted_at IS NULL) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'job_not_found');
    END IF;
    IF EXISTS (SELECT 1 FROM public.library_favourites WHERE user_id = v_user_id AND job_id = p_job_id) THEN
        RETURN jsonb_build_object('ok', true, 'changed', false);
    END IF;
    -- A star on a creation the owner has since deleted does not count against the 200.
    SELECT count(*) INTO v_count FROM public.library_favourites f
      JOIN public.jobs j ON j.id = f.job_id AND j.user_id = v_user_id AND j.deleted_at IS NULL
     WHERE f.user_id = v_user_id;
    IF v_count >= 200 THEN RETURN jsonb_build_object('ok', false, 'error', 'too_many_favourites'); END IF;
    INSERT INTO public.library_favourites (user_id, job_id) VALUES (v_user_id, p_job_id) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_changed := v_count > 0;
    RETURN jsonb_build_object('ok', true, 'changed', v_changed);
END $$;
REVOKE ALL ON FUNCTION public.set_library_favourite(TEXT, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_library_favourite(TEXT, UUID, BOOLEAN) TO service_role;

-- ── Create draft ─────────────────────────────────────────────────────────────
-- The shape is checked by the route too; here only what keeps the row small and honest: one JSON object, version 1, a
-- model id, a prompt no longer than the generation limit, and under 40 000 characters in all.
CREATE OR REPLACE FUNCTION public.put_create_draft(p_auth_id TEXT, p_draft JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    IF p_draft IS NULL OR jsonb_typeof(p_draft) <> 'object'
       OR p_draft->>'v' IS DISTINCT FROM '1'
       OR p_draft->>'modelId' !~ '^[A-Za-z0-9_.-]{1,100}$'
       OR jsonb_typeof(p_draft->'prompt') IS DISTINCT FROM 'string'
       OR length(p_draft->>'prompt') > 30000
       OR length(p_draft::text) > 40000 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_draft');
    END IF;

    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'account_not_found'); END IF;

    INSERT INTO public.create_drafts (user_id, draft) VALUES (v_user_id, p_draft)
    ON CONFLICT (user_id) DO UPDATE SET draft = EXCLUDED.draft, updated_at = now()
        WHERE public.create_drafts.draft IS DISTINCT FROM EXCLUDED.draft;
    RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.put_create_draft(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.put_create_draft(TEXT, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.clear_create_draft(p_auth_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'account_not_found'); END IF;
    DELETE FROM public.create_drafts WHERE user_id = v_user_id;
    RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.clear_create_draft(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_create_draft(TEXT) TO service_role;

-- ── Account deletion hook (ADR-0111) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.library_sync_forget_erased_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        DELETE FROM public.library_favourites WHERE user_id = NEW.id;
        DELETE FROM public.create_drafts WHERE user_id = NEW.id;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.library_sync_forget_erased_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS users_library_sync_forget_erased ON public.users;
CREATE TRIGGER users_library_sync_forget_erased
    AFTER UPDATE OF deleted_at ON public.users
    FOR EACH ROW EXECUTE FUNCTION private.library_sync_forget_erased_user();

-- ── Admin telemetry allowlist ────────────────────────────────────────────────
-- Same wrapper pattern as 0493 to 0498; apply after 0498.
DO $$
BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0498(text)') IS NULL THEN
        RAISE EXCEPTION 'telemetry_path_allowed_pre_0498 missing: apply 0498 first';
    END IF;
    IF to_regprocedure('public.telemetry_path_allowed_pre_0500(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(TEXT)
            RENAME TO telemetry_path_allowed_pre_0500;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT p_path IN ('/api/v1/library-sync', '/api/v1/library-sync/favourites', '/api/v1/library-sync/draft')
        OR public.telemetry_path_allowed_pre_0500(p_path)
$$;

REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT)
    FROM PUBLIC, anon, authenticated, service_role;

-- ── Privacy export (ADR-0250) ────────────────────────────────────────────────
-- The wrapper 0499 left in front of the helper is renamed to a second private helper and a new thin wrapper adds the two
-- keys to the `profile` row, bounded by the request's as_of like every other key.
DO $$
BEGIN
    IF to_regprocedure('private.read_privacy_export_page_without_library_sync(text,text,uuid,text,uuid,text,text,integer)') IS NULL THEN
        ALTER FUNCTION public.read_privacy_export_page(TEXT,TEXT,UUID,TEXT,UUID,TEXT,TEXT,INTEGER)
            SET SCHEMA private;
        ALTER FUNCTION private.read_privacy_export_page(TEXT,TEXT,UUID,TEXT,UUID,TEXT,TEXT,INTEGER)
            RENAME TO read_privacy_export_page_without_library_sync;
    END IF;
END $$;
REVOKE ALL ON FUNCTION private.read_privacy_export_page_without_library_sync(TEXT,TEXT,UUID,TEXT,UUID,TEXT,TEXT,INTEGER)
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.read_privacy_export_page(
    p_auth_id TEXT, p_aal TEXT, p_export_id UUID, p_section TEXT,
    p_thread_id UUID, p_after TEXT, p_key TEXT, p_page_size INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    result JSONB;
    favs   JSONB;
    draft  JSONB;
BEGIN
    result := private.read_privacy_export_page_without_library_sync(
        p_auth_id, p_aal, p_export_id, p_section, p_thread_id, p_after, p_key, p_page_size);
    IF p_section = 'profile' AND result->>'ok' = 'true' THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object('job_id', f.job_id, 'created_at', f.created_at) ORDER BY f.created_at, f.job_id), '[]'::jsonb) INTO favs
          FROM public.library_favourites f
          JOIN public.users u ON u.id = f.user_id AND u.auth_id = p_auth_id AND u.deleted_at IS NULL
          JOIN public.privacy_export_requests r ON r.id = p_export_id AND r.user_id = u.id
         WHERE f.created_at <= r.as_of;
        SELECT jsonb_build_object('draft', d.draft, 'updated_at', d.updated_at) INTO draft
          FROM public.create_drafts d
          JOIN public.users u ON u.id = d.user_id AND u.auth_id = p_auth_id AND u.deleted_at IS NULL
          JOIN public.privacy_export_requests r ON r.id = p_export_id AND r.user_id = u.id
         WHERE d.updated_at <= r.as_of;
        result := jsonb_set(result, '{rows,0,library_favourites}', favs, true);
        result := jsonb_set(result, '{rows,0,create_draft}', COALESCE(draft, 'null'::jsonb), true);
    END IF;
    RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_privacy_export_page(TEXT,TEXT,UUID,TEXT,UUID,TEXT,TEXT,INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_privacy_export_page(TEXT,TEXT,UUID,TEXT,UUID,TEXT,TEXT,INTEGER)
    TO service_role;
