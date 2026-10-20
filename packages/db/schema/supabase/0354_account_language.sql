-- ADR-0107 C2: display preference only; retained on the deleted account tombstone.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS preferred_locale TEXT NULL;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.users'::regclass AND conname = 'users_preferred_locale_check') THEN
        ALTER TABLE public.users ADD CONSTRAINT users_preferred_locale_check
            CHECK (preferred_locale IS NULL OR preferred_locale IN ('es','zh','hi','ar','fr','pt','ru','ja','de','ko'));
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_user_language(p_auth_id TEXT, p_locale TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user public.users%ROWTYPE;
BEGIN
    IF p_locale IS NOT NULL AND p_locale NOT IN ('es','zh','hi','ar','fr','pt','ru','ja','de','ko') THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'INVALID_LOCALE');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE auth_id = p_auth_id FOR UPDATE;
    IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    IF v_user.deleted_at IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'ACCOUNT_DELETED');
    END IF;
    -- A Frozen account may change its display language. Replay writes nothing.
    IF v_user.preferred_locale IS DISTINCT FROM p_locale THEN
        UPDATE public.users SET preferred_locale = p_locale WHERE id = v_user.id;
    END IF;
    RETURN pg_catalog.jsonb_build_object('ok', true, 'locale', p_locale);
END $$;
REVOKE ALL ON FUNCTION public.set_user_language(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_language(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.get_user_language(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_locale TEXT;
BEGIN
    SELECT preferred_locale INTO v_locale FROM public.users WHERE auth_id = p_auth_id;
    IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    RETURN pg_catalog.jsonb_build_object('ok', true, 'locale', v_locale);
END $$;
REVOKE ALL ON FUNCTION public.get_user_language(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_language(TEXT) TO service_role;
