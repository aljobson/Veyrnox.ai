-- ADR-0251 (proposed): the Vibe Check, a first-run interview that tunes the product.
--
-- One row per person: `answers` is an allowlisted JSON object of enum answers plus an
-- optional short studio name. It orders templates, picks generation defaults and sets
-- Vey's tone; it never touches credits, the ledger or pricing.
--
-- Reached only through SECURITY DEFINER functions the Worker calls with the service role
-- (the browser roles hold no grant):
--   get_creator_profile(auth_id)            the stored row, or none
--   save_creator_profile(auth_id, answers)  validate + upsert, completes the interview
--   skip_creator_profile(auth_id)           record a skip; never overwrites a completed profile
--   reset_creator_profile(auth_id)          delete the row ("Reset my vibe")
--
-- Validation lives here as well as in the route: the table can only ever hold the
-- allowlisted keys and values below, whatever calls the function.
-- Account deletion (ADR-0111, 0347): erase_account sets users.deleted_at; the trigger at
-- the bottom removes the row in that same transaction.
-- Idempotent: IF NOT EXISTS, OR REPLACE, DROP TRIGGER IF EXISTS, REVOKE/GRANT re-run.

CREATE TABLE IF NOT EXISTS public.creator_profiles (
    user_id      UUID        PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    answers      JSONB       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object'),
    version      INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),
    completed_at TIMESTAMPTZ NULL,
    skipped_at   TIMESTAMPTZ NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Completed means a full answer set; skipped means none. Never both.
    CONSTRAINT creator_profiles_state_ck CHECK (
        (completed_at IS NOT NULL AND skipped_at IS NULL AND answers <> '{}'::jsonb)
        OR (completed_at IS NULL AND skipped_at IS NOT NULL AND answers = '{}'::jsonb)
    )
);
ALTER TABLE public.creator_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_profiles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_profiles FROM PUBLIC, anon, authenticated, service_role;

-- ── Validation ───────────────────────────────────────────────────────────────
-- Returns the cleaned object (only allowlisted keys, studio name trimmed and dropped when
-- empty) or NULL when anything is missing, unknown or out of range.
CREATE OR REPLACE FUNCTION private.creator_profile_clean(p_answers JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    k      TEXT;
    v_name TEXT;
    v_out  JSONB;
BEGIN
    IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'object' THEN RETURN NULL; END IF;
    FOR k IN SELECT jsonb_object_keys(p_answers) LOOP
        IF k <> ALL (ARRAY['look','goal','pace','chaos','destination','audience','voice','studio_name']) THEN
            RETURN NULL;
        END IF;
    END LOOP;
    -- Every enum answer is a JSON string from its list; chaos is an integer 0..4.
    IF jsonb_typeof(p_answers->'look') IS DISTINCT FROM 'string'
       OR (p_answers->>'look') <> ALL (ARRAY['neon_rain','sunlit_kitchen','retro_vhs','dream_anime','glossy_product','doc_grit']) THEN RETURN NULL; END IF;
    IF jsonb_typeof(p_answers->'goal') IS DISTINCT FROM 'string'
       OR (p_answers->>'goal') <> ALL (ARRAY['sell','story','music_video','meme','character','bedtime']) THEN RETURN NULL; END IF;
    IF jsonb_typeof(p_answers->'pace') IS DISTINCT FROM 'string'
       OR (p_answers->>'pace') <> ALL (ARRAY['fox','owl','octopus','jellyfish']) THEN RETURN NULL; END IF;
    IF jsonb_typeof(p_answers->'chaos') IS DISTINCT FROM 'number'
       OR (p_answers->>'chaos') !~ '^[0-4]$' THEN RETURN NULL; END IF;
    IF jsonb_typeof(p_answers->'destination') IS DISTINCT FROM 'string'
       OR (p_answers->>'destination') <> ALL (ARRAY['tiktok','reels','youtube','cinema','roll']) THEN RETURN NULL; END IF;
    IF jsonb_typeof(p_answers->'audience') IS DISTINCT FROM 'string'
       OR (p_answers->>'audience') <> ALL (ARRAY['me','audience','customers','kids','nobody_yet']) THEN RETURN NULL; END IF;
    IF jsonb_typeof(p_answers->'voice') IS DISTINCT FROM 'string'
       OR (p_answers->>'voice') <> ALL (ARRAY['hype','calm','straight']) THEN RETURN NULL; END IF;

    v_out := jsonb_build_object(
        'look', p_answers->>'look', 'goal', p_answers->>'goal', 'pace', p_answers->>'pace',
        'chaos', (p_answers->>'chaos')::integer, 'destination', p_answers->>'destination',
        'audience', p_answers->>'audience', 'voice', p_answers->>'voice');

    IF p_answers ? 'studio_name' THEN
        IF jsonb_typeof(p_answers->'studio_name') <> 'string' THEN RETURN NULL; END IF;
        v_name := btrim(p_answers->>'studio_name');
        -- 40 characters, no control characters, no angle brackets (the name is shown back in UI).
        IF char_length(v_name) > 40 OR v_name ~ '[[:cntrl:]<>]' THEN RETURN NULL; END IF;
        IF v_name <> '' THEN v_out := v_out || jsonb_build_object('studio_name', v_name); END IF;
    END IF;
    RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION private.creator_profile_clean(JSONB) FROM PUBLIC, anon, authenticated;

-- ── Read ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_creator_profile(p_auth_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_row     public.creator_profiles%ROWTYPE;
BEGIN
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'account_not_found'); END IF;
    SELECT * INTO v_row FROM public.creator_profiles WHERE user_id = v_user_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'status', 'none'); END IF;
    RETURN jsonb_build_object('ok', true,
        'status', CASE WHEN v_row.completed_at IS NOT NULL THEN 'completed' ELSE 'skipped' END,
        'answers', v_row.answers, 'version', v_row.version,
        'completed_at', v_row.completed_at, 'skipped_at', v_row.skipped_at);
END $$;
REVOKE ALL ON FUNCTION public.get_creator_profile(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_creator_profile(TEXT) TO service_role;

-- ── Save ─────────────────────────────────────────────────────────────────────
-- Replaying the same answers changes nothing (`changed` false, updated_at untouched).
CREATE OR REPLACE FUNCTION public.save_creator_profile(p_auth_id TEXT, p_answers JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_clean   JSONB;
    v_row     public.creator_profiles%ROWTYPE;
BEGIN
    v_clean := private.creator_profile_clean(p_answers);
    IF v_clean IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_answers'); END IF;

    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'account_not_found'); END IF;

    SELECT * INTO v_row FROM public.creator_profiles WHERE user_id = v_user_id FOR UPDATE;
    IF FOUND AND v_row.completed_at IS NOT NULL AND v_row.answers = v_clean THEN
        RETURN jsonb_build_object('ok', true, 'changed', false, 'answers', v_row.answers);
    END IF;

    INSERT INTO public.creator_profiles (user_id, answers, completed_at, skipped_at)
    VALUES (v_user_id, v_clean, now(), NULL)
    ON CONFLICT (user_id) DO UPDATE
        SET answers = EXCLUDED.answers, completed_at = now(), skipped_at = NULL, updated_at = now();
    RETURN jsonb_build_object('ok', true, 'changed', true, 'answers', v_clean);
END $$;
REVOKE ALL ON FUNCTION public.save_creator_profile(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_creator_profile(TEXT, JSONB) TO service_role;

-- ── Skip ─────────────────────────────────────────────────────────────────────
-- Skipping after completing is a no-op: a skip never throws away answers.
CREATE OR REPLACE FUNCTION public.skip_creator_profile(p_auth_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_row     public.creator_profiles%ROWTYPE;
BEGIN
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'account_not_found'); END IF;
    SELECT * INTO v_row FROM public.creator_profiles WHERE user_id = v_user_id FOR UPDATE;
    IF FOUND THEN
        RETURN jsonb_build_object('ok', true, 'changed', false,
            'status', CASE WHEN v_row.completed_at IS NOT NULL THEN 'completed' ELSE 'skipped' END);
    END IF;
    INSERT INTO public.creator_profiles (user_id, answers, skipped_at) VALUES (v_user_id, '{}'::jsonb, now());
    RETURN jsonb_build_object('ok', true, 'changed', true, 'status', 'skipped');
END $$;
REVOKE ALL ON FUNCTION public.skip_creator_profile(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.skip_creator_profile(TEXT) TO service_role;

-- ── Reset ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reset_creator_profile(p_auth_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_gone    INTEGER;
BEGIN
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'account_not_found'); END IF;
    DELETE FROM public.creator_profiles WHERE user_id = v_user_id;
    GET DIAGNOSTICS v_gone = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'changed', v_gone > 0);
END $$;
REVOKE ALL ON FUNCTION public.reset_creator_profile(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_creator_profile(TEXT) TO service_role;

-- ── Account deletion hook (ADR-0111) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.creator_profile_forget_erased_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        DELETE FROM public.creator_profiles WHERE user_id = NEW.id;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.creator_profile_forget_erased_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS users_creator_profile_forget_erased ON public.users;
CREATE TRIGGER users_creator_profile_forget_erased
    AFTER UPDATE OF deleted_at ON public.users
    FOR EACH ROW EXECUTE FUNCTION private.creator_profile_forget_erased_user();
