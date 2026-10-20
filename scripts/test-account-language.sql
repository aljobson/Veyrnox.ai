-- Run after the complete migration replay, as postgres on local Postgres 18.
-- Fixtures and preference changes are rolled back. No shared database required.
BEGIN;
\ir ../packages/db/schema/supabase/0354_account_language.sql
\ir ../packages/db/schema/supabase/0354_account_language.sql
DO $$
DECLARE
    v_auth UUID := gen_random_uuid();
    v_id UUID;
    v_xmin TEXT;
    v_result JSONB;
BEGIN
    INSERT INTO auth.users(id, email, email_confirmed_at)
        VALUES (v_auth, v_auth::text || '@test.veyrnox.ai', now());
    SELECT id INTO STRICT v_id FROM public.users WHERE auth_id = v_auth::text;
    IF public.get_user_language(v_auth::text) <> '{"ok":true,"locale":null}'::jsonb THEN RAISE EXCEPTION 'initial'; END IF;
    IF public.set_user_language(v_auth::text, 'de') <> '{"ok":true,"locale":"de"}'::jsonb THEN RAISE EXCEPTION 'set'; END IF;
    SELECT xmin::text INTO v_xmin FROM public.users WHERE id = v_id;
    -- A row-level trigger detects UPDATE even inside this same transaction.
    CREATE TEMP TABLE language_updates (id UUID);
    CREATE FUNCTION pg_temp.language_updated() RETURNS TRIGGER LANGUAGE plpgsql AS $body$
    BEGIN INSERT INTO pg_temp.language_updates VALUES (NEW.id); RETURN NEW; END $body$;
    CREATE TRIGGER language_test_update AFTER UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION pg_temp.language_updated();
    PERFORM public.set_user_language(v_auth::text, 'de');
    IF EXISTS (SELECT 1 FROM pg_temp.language_updates) THEN RAISE EXCEPTION 'replay wrote a row'; END IF;
    IF public.get_user_language(v_auth::text) <> '{"ok":true,"locale":"de"}'::jsonb THEN RAISE EXCEPTION 'read'; END IF;
    IF public.set_user_language(v_auth::text, NULL) <> '{"ok":true,"locale":null}'::jsonb THEN RAISE EXCEPTION 'clear'; END IF;
    FOREACH v_xmin IN ARRAY ARRAY['en','DE','xx','', ' de '] LOOP
        IF public.set_user_language(v_auth::text, v_xmin)->>'code' <> 'INVALID_LOCALE' THEN RAISE EXCEPTION 'invalid %', v_xmin; END IF;
    END LOOP;
    -- Fixture only: a Frozen account must still be allowed this nonfinancial preference.
    UPDATE public.users SET frozen_at = now() WHERE id = v_id;
    IF public.set_user_language(v_auth::text, 'ja')->>'ok' <> 'true' THEN RAISE EXCEPTION 'frozen'; END IF;
    UPDATE public.users SET frozen_at = NULL WHERE id = v_id;
    v_result := public.prepare_account_deletion(v_auth::text);
    IF v_result->>'eligible' <> 'true' THEN RAISE EXCEPTION 'deletion fixture %', v_result; END IF;
    v_result := public.erase_account(v_auth::text, v_result->>'confirmation_token');
    IF v_result->>'ok' <> 'true' THEN RAISE EXCEPTION 'erase fixture %', v_result; END IF;
    IF public.set_user_language('erased:' || v_id::text, 'de')->>'code' <> 'ACCOUNT_DELETED' THEN RAISE EXCEPTION 'deleted'; END IF;
    IF (SELECT preferred_locale FROM public.users WHERE id = v_id) <> 'ja' THEN RAISE EXCEPTION 'tombstone preference'; END IF;
    IF public.get_user_language(gen_random_uuid()::text)->>'code' <> 'NOT_FOUND' THEN RAISE EXCEPTION 'unknown'; END IF;
    IF NOT has_function_privilege('service_role', 'public.set_user_language(text,text)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.get_user_language(text)', 'EXECUTE') THEN RAISE EXCEPTION 'service ACL'; END IF;
END $$;
DO $$ BEGIN
    SET LOCAL ROLE anon;
    BEGIN PERFORM public.set_user_language('test', 'de'); RAISE EXCEPTION 'anon setter allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.get_user_language('test'); RAISE EXCEPTION 'anon getter allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RESET ROLE;
    SET LOCAL ROLE authenticated;
    BEGIN PERFORM public.set_user_language('test', 'de'); RAISE EXCEPTION 'authenticated setter allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.get_user_language('test'); RAISE EXCEPTION 'authenticated getter allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RESET ROLE;
END $$;
ROLLBACK;
