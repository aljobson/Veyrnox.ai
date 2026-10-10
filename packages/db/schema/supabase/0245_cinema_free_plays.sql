-- 0245_cinema_free_plays.sql — ADR-0057: a monthly ceiling on free viewing.
--
-- Free titles (SHORT, TRAILER, Free Episodes) are delivered by Stream at the
-- same per-minute rate as paid ones, and until now nothing counted them. A
-- Free Play is seconds of a free title watched by an account. An account has
-- cinema_prices.free_ceiling_minutes of them per calendar month (UTC); past
-- that a free title is locked with reason 'free_ceiling' unless a live Unlock
-- or a Cinema Pass under its own ceiling plays it.
--
-- Nothing here changes what today's callers get. cinema_entitlement,
-- read_cinema_playback and record_cinema_pass_play keep their bodies; the
-- Worker calls the three new functions instead only while
-- CINEMA_FREE_CEILING_ENABLED is "true". No money moves: nothing in this file
-- touches ledger_entries or credit_balances.
-- Additive and idempotent.

-- ── The ceiling lives with the other Cinema numbers ───────────────────────
ALTER TABLE public.cinema_prices DROP CONSTRAINT IF EXISTS cinema_prices_key_check;
ALTER TABLE public.cinema_prices ADD CONSTRAINT cinema_prices_key_check
    CHECK (key IN ('episode_unlock', 'film_unlock', 'free_episodes', 'pass_ceiling_minutes', 'free_ceiling_minutes'));
ALTER TABLE public.cinema_prices DROP CONSTRAINT IF EXISTS cinema_prices_value_check;
ALTER TABLE public.cinema_prices ADD CONSTRAINT cinema_prices_value_check
    CHECK (CASE WHEN key IN ('pass_ceiling_minutes', 'free_ceiling_minutes') THEN value BETWEEN 0 AND 100000
                ELSE value BETWEEN 0 AND 50 END);
INSERT INTO public.cinema_prices (key, value) VALUES ('free_ceiling_minutes', 300)
ON CONFLICT (key) DO NOTHING;

-- ── Free Plays: append-only ───────────────────────────────────────────────
-- 'start' is the minute counted when playback is granted; 'heartbeat' is
-- seconds the player reported afterwards.
CREATE TABLE IF NOT EXISTS public.cinema_free_plays (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    content_id UUID        NOT NULL REFERENCES public.cinema_content(id) ON DELETE RESTRICT,
    seconds    INTEGER     NOT NULL CHECK (seconds BETWEEN 1 AND 60),
    source     TEXT        NOT NULL CHECK (source IN ('start', 'heartbeat')),
    played_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cinema_free_plays_user_idx ON public.cinema_free_plays (user_id, played_at);
CREATE INDEX IF NOT EXISTS cinema_free_plays_content_idx ON public.cinema_free_plays (content_id, played_at);
ALTER TABLE public.cinema_free_plays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_free_plays FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_free_plays FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.cinema_free_plays_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    RAISE EXCEPTION 'cinema_free_plays is append-only';
END $$;
DROP TRIGGER IF EXISTS cinema_free_plays_append_only ON public.cinema_free_plays;
CREATE TRIGGER cinema_free_plays_append_only
    BEFORE UPDATE OR DELETE ON public.cinema_free_plays
    FOR EACH ROW EXECUTE FUNCTION public.cinema_free_plays_append_only();
-- Row triggers never fire for TRUNCATE (0177).
DROP TRIGGER IF EXISTS cinema_free_plays_no_truncate ON public.cinema_free_plays;
CREATE TRIGGER cinema_free_plays_no_truncate
    BEFORE TRUNCATE ON public.cinema_free_plays
    FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_no_truncate();

-- ── cinema_free_month_seconds: free seconds an account used this calendar month (UTC)
CREATE OR REPLACE FUNCTION public.cinema_free_month_seconds(p_user_id UUID, p_at TIMESTAMPTZ)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(SUM(f.seconds), 0)::INTEGER
    FROM public.cinema_free_plays f
    WHERE f.user_id = p_user_id
      AND f.played_at >= (date_trunc('month', p_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
      AND f.played_at <  ((date_trunc('month', p_at AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC');
$$;

-- ── cinema_past_free_ceiling: what a free title is to an account with no free minutes left
-- A live Unlock still plays it (the title was paid for before it became
-- free). A Cinema Pass under its own ceiling plays it as Pass viewing, which
-- counts toward the Pass ceiling. Otherwise it is locked, and there is no
-- price to pay: credits is 0.
CREATE OR REPLACE FUNCTION public.cinema_past_free_ceiling(p_user_id UUID, p_content_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_pass    UUID;
    v_ceiling INTEGER;
BEGIN
    IF EXISTS (SELECT 1 FROM public.cinema_unlocks x
               WHERE x.user_id = p_user_id AND x.content_id = p_content_id AND x.reversed_at IS NULL) THEN
        RETURN jsonb_build_object('access', 'unlocked', 'credits', 0);
    END IF;
    -- Same definition of a usable Pass as cinema_entitlement (0144).
    SELECT p.id INTO v_pass FROM public.cinema_passes p
    WHERE p.user_id = p_user_id AND p.status IN ('active', 'past_due')
      AND p.current_period_end IS NOT NULL AND p.current_period_end > now();
    IF v_pass IS NOT NULL THEN
        SELECT value INTO v_ceiling FROM public.cinema_prices WHERE key = 'pass_ceiling_minutes';
        IF public.cinema_pass_month_seconds(v_pass, now()) < COALESCE(v_ceiling, 0) * 60 THEN
            RETURN jsonb_build_object('access', 'pass', 'credits', 0);
        END IF;
    END IF;
    RETURN jsonb_build_object('access', 'locked', 'credits', 0, 'reason', 'free_ceiling');
END $$;

-- ── cinema_metered_entitlement: cinema_entitlement with the free ceiling ──
-- Same answers as cinema_entitlement for everything except a free title whose
-- viewer has used the month's free minutes. A reader with no account row
-- still sees 'free': the catalogue is public, and start_cinema_playback
-- refuses to play anything without an account.
CREATE OR REPLACE FUNCTION public.cinema_metered_entitlement(p_auth_id TEXT, p_content_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_ent     JSONB;
    v_user    UUID;
    v_ceiling INTEGER;
BEGIN
    v_ent := public.cinema_entitlement(p_auth_id, p_content_id);
    IF v_ent ? 'error' OR v_ent->>'access' <> 'free' THEN
        RETURN v_ent;
    END IF;
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN v_ent;
    END IF;
    SELECT u.id INTO v_user FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_user IS NULL THEN
        RETURN v_ent;
    END IF;
    SELECT value INTO v_ceiling FROM public.cinema_prices WHERE key = 'free_ceiling_minutes';
    IF public.cinema_free_month_seconds(v_user, now()) < COALESCE(v_ceiling, 0) * 60 THEN
        RETURN v_ent;
    END IF;
    RETURN public.cinema_past_free_ceiling(v_user, p_content_id);
END $$;

-- ── cinema_record_pass_seconds: the Pass Play caps, for a resolved user ───
-- The body of record_cinema_pass_play (0144) from its lock onwards, with a
-- 55-second window, so a free title played under a Pass is recorded with
-- the same two caps. The caller has already decided this viewing is Pass
-- viewing.
CREATE OR REPLACE FUNCTION public.cinema_record_pass_seconds(p_user_id UUID, p_content_id UUID, p_seconds INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_pass    UUID;
    v_ceiling INTEGER;
    v_used    INTEGER;
    v_recent  INTEGER;
    v_seconds INTEGER;
BEGIN
    SELECT p.id INTO v_pass FROM public.cinema_passes p
    WHERE p.user_id = p_user_id AND p.status IN ('active', 'past_due')
      AND p.current_period_end IS NOT NULL AND p.current_period_end > now()
    FOR UPDATE;
    IF v_pass IS NULL THEN
        RETURN jsonb_build_object('ok', true, 'recorded', false, 'access', 'locked', 'reason', 'pass_lapsed');
    END IF;
    SELECT value INTO v_ceiling FROM public.cinema_prices WHERE key = 'pass_ceiling_minutes';
    v_used := public.cinema_pass_month_seconds(v_pass, now());
    IF v_used >= COALESCE(v_ceiling, 0) * 60 THEN
        RETURN jsonb_build_object('ok', true, 'recorded', false, 'access', 'locked', 'reason', 'pass_ceiling',
                                  'minutes_used', v_used / 60, 'ceiling_minutes', v_ceiling);
    END IF;
    -- The window is 55 seconds, not 60: a steady 30-second heartbeat puts the
    -- row from two beats ago at 60 seconds plus or minus network jitter, and a
    -- 60-second window refused about a third of honest beats. A scripted client
    -- can now log 60 seconds per 55 of wall-clock, about a tenth over.
    SELECT COALESCE(SUM(x.seconds), 0) INTO v_recent FROM public.cinema_pass_plays x
    WHERE x.pass_id = v_pass AND x.played_at > now() - interval '55 seconds';
    IF v_recent >= 60 THEN
        RETURN jsonb_build_object('ok', true, 'recorded', false, 'access', 'pass', 'reason', 'too_fast',
                                  'minutes_used', v_used / 60, 'ceiling_minutes', v_ceiling);
    END IF;
    v_seconds := LEAST(p_seconds, 60 - v_recent, COALESCE(v_ceiling, 0) * 60 - v_used);

    INSERT INTO public.cinema_pass_plays (pass_id, user_id, content_id, seconds)
    VALUES (v_pass, p_user_id, p_content_id, v_seconds);

    RETURN jsonb_build_object('ok', true, 'recorded', true, 'access', 'pass', 'seconds', v_seconds,
                              'minutes_used', (v_used + v_seconds) / 60, 'ceiling_minutes', v_ceiling);
END $$;

-- ── start_cinema_playback: read_cinema_playback with the free ceiling ─────
-- {stream_uid, access} when the viewer may play and the upload is ready;
-- {error} with not_authenticated, content_not_found, locked (+credits,
-- +reason when there is one) or not_ready. Granting playback of a free title
-- counts one minute of the account's free minutes (or what is left of them),
-- whether or not the player reports back; the heartbeat meters the rest. A
-- repeated request counts again: there is no idempotency key, because a new
-- request is a new grant. Nothing is counted when playback is refused or the
-- video is not ready.
CREATE OR REPLACE FUNCTION public.start_cinema_playback(p_auth_id TEXT, p_content_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user    UUID;
    v_ent     JSONB;
    v_uid     TEXT;
    v_ceiling INTEGER;
    v_used    INTEGER;
    v_counts  BOOLEAN := false;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('error', 'not_authenticated');
    END IF;
    SELECT u.id INTO v_user FROM public.users u JOIN auth.users a ON a.id = p_auth_id::UUID WHERE u.auth_id = p_auth_id;
    IF v_user IS NULL THEN
        RETURN jsonb_build_object('error', 'not_authenticated');
    END IF;

    v_ent := public.cinema_entitlement(p_auth_id, p_content_id);
    IF v_ent ? 'error' THEN
        RETURN v_ent;
    END IF;
    IF v_ent->>'access' = 'free' THEN
        -- Serialize this account's Free Plays so the ceiling holds under concurrency.
        PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cinema_free_plays:' || v_user::text, 0));
        SELECT value INTO v_ceiling FROM public.cinema_prices WHERE key = 'free_ceiling_minutes';
        v_used := public.cinema_free_month_seconds(v_user, now());
        IF v_used < COALESCE(v_ceiling, 0) * 60 THEN
            v_counts := true;
        ELSE
            v_ent := public.cinema_past_free_ceiling(v_user, p_content_id);
        END IF;
    END IF;
    IF v_ent->>'access' = 'locked' THEN
        RETURN jsonb_strip_nulls(jsonb_build_object('error', 'locked', 'credits', v_ent->'credits', 'reason', v_ent->'reason'));
    END IF;
    SELECT u.stream_uid INTO v_uid FROM public.cinema_uploads u
    WHERE u.content_id = p_content_id AND u.state = 'ready';
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('error', 'not_ready');
    END IF;
    IF v_counts THEN
        INSERT INTO public.cinema_free_plays (user_id, content_id, seconds, source)
        VALUES (v_user, p_content_id, LEAST(60, COALESCE(v_ceiling, 0) * 60 - v_used), 'start');
    END IF;
    RETURN jsonb_build_object('access', v_ent->>'access', 'stream_uid', v_uid);
END $$;

-- ── record_cinema_play: one heartbeat, as a Pass Play or a Free Play ──────
-- Same contract as record_cinema_pass_play (0144), which it replaces while
-- the free ceiling is on. Paid titles behave exactly as there. A free title
-- records a Free Play with the same two caps: a heartbeat is at most 60
-- seconds, and an account cannot log more than 60 seconds per 55 of
-- wall-clock time (the minute counted at a play start is inside that cap).
-- Past the free ceiling
-- a Pass holder's heartbeat is a Pass Play; anyone else's records nothing.
-- Returns {ok:true, recorded, access, seconds, minutes_used, ceiling_minutes}
-- with reason 'free_ceiling', 'pass_ceiling' or 'too_fast' when nothing was
-- recorded, or {error} with not_authenticated, invalid_seconds or content_not_found.
CREATE OR REPLACE FUNCTION public.record_cinema_play(p_auth_id TEXT, p_content_id UUID, p_seconds INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user    UUID;
    v_ent     JSONB;
    v_ceiling INTEGER;
    v_used    INTEGER;
    v_recent  INTEGER;
    v_seconds INTEGER;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('error', 'not_authenticated');
    END IF;
    SELECT u.id INTO v_user FROM public.users u JOIN auth.users a ON a.id = p_auth_id::UUID WHERE u.auth_id = p_auth_id;
    IF v_user IS NULL THEN
        RETURN jsonb_build_object('error', 'not_authenticated');
    END IF;
    IF p_seconds IS NULL OR p_seconds < 1 OR p_seconds > 60 THEN
        RETURN jsonb_build_object('error', 'invalid_seconds');
    END IF;

    v_ent := public.cinema_entitlement(p_auth_id, p_content_id);
    IF v_ent ? 'error' THEN
        RETURN v_ent;
    END IF;
    IF v_ent->>'access' = 'pass' THEN
        RETURN public.cinema_record_pass_seconds(v_user, p_content_id, p_seconds);
    END IF;
    IF v_ent->>'access' <> 'free' THEN
        RETURN jsonb_build_object('ok', true, 'recorded', false, 'access', v_ent->>'access', 'reason', v_ent->'reason');
    END IF;

    -- A free title. Same lock as start_cinema_playback, taken before any Pass
    -- row lock, so the two caps and the ceiling hold under concurrency.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cinema_free_plays:' || v_user::text, 0));
    SELECT value INTO v_ceiling FROM public.cinema_prices WHERE key = 'free_ceiling_minutes';
    v_used := public.cinema_free_month_seconds(v_user, now());
    IF v_used >= COALESCE(v_ceiling, 0) * 60 THEN
        v_ent := public.cinema_past_free_ceiling(v_user, p_content_id);
        IF v_ent->>'access' = 'pass' THEN
            RETURN public.cinema_record_pass_seconds(v_user, p_content_id, p_seconds);
        END IF;
        RETURN jsonb_build_object('ok', true, 'recorded', false, 'access', v_ent->>'access', 'reason', v_ent->'reason',
                                  'minutes_used', v_used / 60, 'ceiling_minutes', v_ceiling);
    END IF;
    -- 55-second window, for the reason given in cinema_record_pass_seconds.
    SELECT COALESCE(SUM(x.seconds), 0) INTO v_recent FROM public.cinema_free_plays x
    WHERE x.user_id = v_user AND x.played_at > now() - interval '55 seconds';
    IF v_recent >= 60 THEN
        RETURN jsonb_build_object('ok', true, 'recorded', false, 'access', 'free', 'reason', 'too_fast',
                                  'minutes_used', v_used / 60, 'ceiling_minutes', v_ceiling);
    END IF;
    v_seconds := LEAST(p_seconds, 60 - v_recent, COALESCE(v_ceiling, 0) * 60 - v_used);

    INSERT INTO public.cinema_free_plays (user_id, content_id, seconds, source)
    VALUES (v_user, p_content_id, v_seconds, 'heartbeat');

    RETURN jsonb_build_object('ok', true, 'recorded', true, 'access', 'free', 'seconds', v_seconds,
                              'minutes_used', (v_used + v_seconds) / 60, 'ceiling_minutes', v_ceiling);
END $$;

-- ── Grants: every new function names its full signature ───────────────────
DO $$
DECLARE fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.cinema_free_plays_append_only()',
        'public.cinema_free_month_seconds(UUID, TIMESTAMPTZ)',
        'public.cinema_past_free_ceiling(UUID, UUID)',
        'public.cinema_metered_entitlement(TEXT, UUID)',
        'public.cinema_record_pass_seconds(UUID, UUID, INTEGER)',
        'public.start_cinema_playback(TEXT, UUID)',
        'public.record_cinema_play(TEXT, UUID, INTEGER)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    END LOOP;
    FOREACH fn IN ARRAY ARRAY[
        'public.cinema_metered_entitlement(TEXT, UUID)',
        'public.start_cinema_playback(TEXT, UUID)',
        'public.record_cinema_play(TEXT, UUID, INTEGER)'
    ] LOOP
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
    -- Internal halves: callable only from the SECURITY DEFINER functions above.
    REVOKE ALL ON FUNCTION public.cinema_free_month_seconds(UUID, TIMESTAMPTZ) FROM service_role;
    REVOKE ALL ON FUNCTION public.cinema_past_free_ceiling(UUID, UUID) FROM service_role;
    REVOKE ALL ON FUNCTION public.cinema_record_pass_seconds(UUID, UUID, INTEGER) FROM service_role;
END $$;
