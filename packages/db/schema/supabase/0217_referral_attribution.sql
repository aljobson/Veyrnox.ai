-- Referral attribution (ADR-0071 part 1, accepted 2026-10-05): who sent whom. NOTHING IN THIS MIGRATION MOVES CREDITS. The reward, its release
-- sweep, its caps and its clawback are later migrations; this one only records the link, so it can ship and be tested on its own.
--
--   referral_codes   one opaque code per account, 10 characters from an alphabet without look-alikes (never an email, an id or anything guessable)
--   referrals        one row per referred account (the referee is the primary key, so it can be set once and never changed), naming the referrer
--
-- Attribution is allowed only for a NEW account: created in the last 48 hours, with no job and no top-up yet, and never to itself. Setting it
-- is idempotent (the same code again is a success; a different one is refused), and it never tells the caller who the referrer is.
-- Tables are reachable only through the definer functions below, keyed by the verified auth id. Behind REFERRALS_ENABLED in the Worker.
--
-- Idempotent: IF NOT EXISTS, OR REPLACE, explicit revokes naming each full signature.

CREATE TABLE IF NOT EXISTS public.referral_codes (
    user_id    UUID        PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    code       TEXT        NOT NULL UNIQUE CHECK (code ~ '^[2-9A-HJKMNP-Z]{10}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.referrals (
    referee_user_id  UUID        PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    referrer_user_id UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    code             TEXT        NOT NULL CHECK (code ~ '^[2-9A-HJKMNP-Z]{10}$'),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (referee_user_id <> referrer_user_id)
);
CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON public.referrals (referrer_user_id, created_at);

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_codes FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.referrals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals      FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.referral_codes FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.referrals      FROM PUBLIC, anon, authenticated, service_role;

-- The caller's own code, made on first use. 31 characters (2-9 and A-Z without I, L, O) from random bytes of a v4 UUID, skipping the bytes
-- whose bits are fixed; a collision on the unique constraint just draws again.
CREATE OR REPLACE FUNCTION public.referral_code_for(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID; v_code TEXT; v_bytes BYTEA; v_try INTEGER := 0;
    v_alphabet CONSTANT TEXT := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    SELECT code INTO v_code FROM public.referral_codes WHERE user_id = v_user;
    IF v_code IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'code', v_code); END IF;
    LOOP
        v_try := v_try + 1;
        v_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
        v_code := (SELECT string_agg(substr(v_alphabet, 1 + (get_byte(v_bytes, i) % 31), 1), '' ORDER BY n)
                     FROM unnest(ARRAY[0, 1, 2, 3, 4, 5, 7, 9, 10, 11]) WITH ORDINALITY AS t(i, n));
        BEGIN
            INSERT INTO public.referral_codes (user_id, code) VALUES (v_user, v_code);
            RETURN jsonb_build_object('ok', true, 'code', v_code);
        EXCEPTION WHEN unique_violation THEN
            -- Either another request made this account's code first, or the code collided: read ours, else draw again.
            SELECT code INTO v_code FROM public.referral_codes WHERE user_id = v_user;
            IF v_code IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'code', v_code); END IF;
            IF v_try >= 5 THEN RETURN jsonb_build_object('ok', false, 'code', 'CODE_UNAVAILABLE'); END IF;
        END;
    END LOOP;
END $$;

-- Record that this (new) account was sent by the owner of p_code. Never reveals who the referrer is.
CREATE OR REPLACE FUNCTION public.attach_referral(p_auth_id TEXT, p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_created TIMESTAMPTZ; v_referrer UUID; v_existing TEXT;
BEGIN
    SELECT id, created_at INTO v_user, v_created FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    IF p_code IS NULL OR p_code !~ '^[2-9A-HJKMNP-Z]{10}$' THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CODE'); END IF;

    -- Already attached: the same code again is fine (a retry), a different one is refused. Checked first so a retry after the account stops
    -- being new still succeeds.
    SELECT code INTO v_existing FROM public.referrals WHERE referee_user_id = v_user;
    IF v_existing IS NOT NULL THEN
        IF v_existing = p_code THEN RETURN jsonb_build_object('ok', true, 'attached', true, 'idempotent', true); END IF;
        RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_ATTACHED');
    END IF;

    SELECT user_id INTO v_referrer FROM public.referral_codes WHERE code = p_code;
    IF v_referrer IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CODE'); END IF;
    IF v_referrer = v_user THEN RETURN jsonb_build_object('ok', false, 'code', 'SELF_REFERRAL'); END IF;

    -- Only a new account: made in the last 48 hours, with no job and no top-up yet.
    IF v_created < now() - interval '48 hours'
       OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.user_id = v_user)
       OR EXISTS (SELECT 1 FROM public.top_ups t WHERE t.user_id = v_user) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_NEW');
    END IF;

    BEGIN
        INSERT INTO public.referrals (referee_user_id, referrer_user_id, code) VALUES (v_user, v_referrer, p_code);
    EXCEPTION WHEN unique_violation THEN
        -- A concurrent request attached it first: the same code is a success, anything else is not.
        SELECT code INTO v_existing FROM public.referrals WHERE referee_user_id = v_user;
        IF v_existing = p_code THEN RETURN jsonb_build_object('ok', true, 'attached', true, 'idempotent', true); END IF;
        RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_ATTACHED');
    END;
    RETURN jsonb_build_object('ok', true, 'attached', true, 'idempotent', false);
END $$;

-- What the caller may see about their own referrals: how many people they sent. Counts only, never who.
CREATE OR REPLACE FUNCTION public.referral_summary(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    RETURN jsonb_build_object('ok', true, 'referred', (SELECT count(*)::int FROM public.referrals WHERE referrer_user_id = v_user));
END $$;

REVOKE ALL ON FUNCTION public.referral_code_for(TEXT)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attach_referral(TEXT, TEXT)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.referral_summary(TEXT)          FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_code_for(TEXT)      TO service_role;
GRANT EXECUTE ON FUNCTION public.attach_referral(TEXT, TEXT)  TO service_role;
GRANT EXECUTE ON FUNCTION public.referral_summary(TEXT)       TO service_role;
