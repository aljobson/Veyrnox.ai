-- 0144_cinema_pass_plays.sql — ADR-0057 Phase 3: Pass Plays and the ceiling.
--
-- A Pass Play is a heartbeat of seconds a Cinema Pass holder watched. It feeds
-- the Pass's monthly viewing ceiling (3,000 delivered minutes, the figure that
-- bounds Stream cost per Pass in ADR-0057 §3) and the Operator earnings read a
-- later creator revenue-share ADR will build on. No money moves here: nothing
-- in this file touches ledger_entries or credit_balances.
-- Additive and idempotent.

-- ── The ceiling lives with the other Cinema numbers ───────────────────────
ALTER TABLE public.cinema_prices DROP CONSTRAINT IF EXISTS cinema_prices_key_check;
ALTER TABLE public.cinema_prices ADD CONSTRAINT cinema_prices_key_check
    CHECK (key IN ('episode_unlock', 'film_unlock', 'free_episodes', 'pass_ceiling_minutes'));
ALTER TABLE public.cinema_prices DROP CONSTRAINT IF EXISTS cinema_prices_value_check;
ALTER TABLE public.cinema_prices ADD CONSTRAINT cinema_prices_value_check
    CHECK (CASE WHEN key = 'pass_ceiling_minutes' THEN value BETWEEN 0 AND 100000 ELSE value BETWEEN 0 AND 50 END);
INSERT INTO public.cinema_prices (key, value) VALUES ('pass_ceiling_minutes', 3000)
ON CONFLICT (key) DO NOTHING;

-- ── Pass Plays: append-only heartbeats ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cinema_pass_plays (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    pass_id    UUID        NOT NULL REFERENCES public.cinema_passes(id) ON DELETE RESTRICT,
    user_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    content_id UUID        NOT NULL REFERENCES public.cinema_content(id) ON DELETE RESTRICT,
    seconds    INTEGER     NOT NULL CHECK (seconds BETWEEN 1 AND 60),
    played_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cinema_pass_plays_pass_idx ON public.cinema_pass_plays (pass_id, played_at);
CREATE INDEX IF NOT EXISTS cinema_pass_plays_content_idx ON public.cinema_pass_plays (content_id, played_at);
ALTER TABLE public.cinema_pass_plays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_pass_plays FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_pass_plays FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.cinema_pass_plays_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    RAISE EXCEPTION 'cinema_pass_plays is append-only';
END $$;
DROP TRIGGER IF EXISTS cinema_pass_plays_append_only ON public.cinema_pass_plays;
CREATE TRIGGER cinema_pass_plays_append_only
    BEFORE UPDATE OR DELETE ON public.cinema_pass_plays
    FOR EACH ROW EXECUTE FUNCTION public.cinema_pass_plays_append_only();

-- ── cinema_pass_month_seconds: what a Pass has watched this calendar month (UTC)
CREATE OR REPLACE FUNCTION public.cinema_pass_month_seconds(p_pass_id UUID, p_at TIMESTAMPTZ)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(SUM(p.seconds), 0)::INTEGER
    FROM public.cinema_pass_plays p
    WHERE p.pass_id = p_pass_id
      AND p.played_at >= (date_trunc('month', p_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
      AND p.played_at <  ((date_trunc('month', p_at AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC');
$$;

-- ── cinema_entitlement: same signature, now honouring the ceiling ─────────
-- A Pass at its monthly ceiling reports 'locked' with reason 'pass_ceiling'
-- and the unlock price, so the viewer can still pay per episode.
CREATE OR REPLACE FUNCTION public.cinema_entitlement(p_auth_id TEXT, p_content_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_price   INTEGER;
    v_user    UUID;
    v_pass    UUID;
    v_ceiling INTEGER;
BEGIN
    v_price := public.cinema_unlock_price(p_content_id);
    IF v_price IS NULL THEN
        RETURN jsonb_build_object('error', 'content_not_found');
    END IF;
    IF v_price = 0 THEN
        RETURN jsonb_build_object('access', 'free', 'credits', 0);
    END IF;
    IF p_auth_id IS NOT NULL AND p_auth_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT u.id INTO v_user FROM public.users u WHERE u.auth_id = p_auth_id;
        IF v_user IS NOT NULL THEN
            IF EXISTS (SELECT 1 FROM public.cinema_unlocks x
                       WHERE x.user_id = v_user AND x.content_id = p_content_id AND x.reversed_at IS NULL) THEN
                RETURN jsonb_build_object('access', 'unlocked', 'credits', 0);
            END IF;
            SELECT p.id INTO v_pass FROM public.cinema_passes p
            WHERE p.user_id = v_user AND p.status IN ('active', 'past_due')
              AND p.current_period_end IS NOT NULL AND p.current_period_end > now();
            IF v_pass IS NOT NULL THEN
                SELECT value INTO v_ceiling FROM public.cinema_prices WHERE key = 'pass_ceiling_minutes';
                IF public.cinema_pass_month_seconds(v_pass, now()) < COALESCE(v_ceiling, 0) * 60 THEN
                    RETURN jsonb_build_object('access', 'pass', 'credits', 0);
                END IF;
                RETURN jsonb_build_object('access', 'locked', 'credits', v_price, 'reason', 'pass_ceiling');
            END IF;
        END IF;
    END IF;
    RETURN jsonb_build_object('access', 'locked', 'credits', v_price);
END $$;

-- ── record_cinema_pass_play: one heartbeat from an entitled Pass holder ───
-- Only a viewer whose access to the content is 'pass' writes a row; free,
-- unlocked and locked viewing record nothing (their cost and their credits
-- are already accounted for). Two caps: a heartbeat is at most 60 seconds,
-- and a Pass cannot log more seconds than wall-clock time, so a scripted
-- client can neither inflate a creator's seconds nor race the ceiling.
-- Returns {ok:true, recorded, access, seconds, minutes_used, ceiling_minutes}
-- with reason 'pass_ceiling' or 'too_fast' when nothing was recorded, or
-- {error} with not_authenticated, invalid_seconds or content_not_found.
CREATE OR REPLACE FUNCTION public.record_cinema_pass_play(p_auth_id TEXT, p_content_id UUID, p_seconds INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user    UUID;
    v_ent     JSONB;
    v_pass    UUID;
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
    IF v_ent->>'access' <> 'pass' THEN
        RETURN jsonb_build_object('ok', true, 'recorded', false, 'access', v_ent->>'access', 'reason', v_ent->'reason');
    END IF;

    -- Serialize heartbeats per Pass so the two caps hold under concurrency.
    -- Same definition of a usable Pass as cinema_entitlement, re-read under
    -- the lock: a Pass that lapsed or ended between the two reads records nothing.
    SELECT p.id INTO v_pass FROM public.cinema_passes p
    WHERE p.user_id = v_user AND p.status IN ('active', 'past_due')
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
    SELECT COALESCE(SUM(x.seconds), 0) INTO v_recent FROM public.cinema_pass_plays x
    WHERE x.pass_id = v_pass AND x.played_at > now() - interval '60 seconds';
    IF v_recent >= 60 THEN
        RETURN jsonb_build_object('ok', true, 'recorded', false, 'access', 'pass', 'reason', 'too_fast',
                                  'minutes_used', v_used / 60, 'ceiling_minutes', v_ceiling);
    END IF;
    v_seconds := LEAST(p_seconds, 60 - v_recent, COALESCE(v_ceiling, 0) * 60 - v_used);

    INSERT INTO public.cinema_pass_plays (pass_id, user_id, content_id, seconds)
    VALUES (v_pass, v_user, p_content_id, v_seconds);

    RETURN jsonb_build_object('ok', true, 'recorded', true, 'access', 'pass', 'seconds', v_seconds,
                              'minutes_used', (v_used + v_seconds) / 60, 'ceiling_minutes', v_ceiling);
END $$;

-- ── operator_cinema_earnings: what each title earned in a month ───────────
-- Operator read for a later creator revenue-share ADR. Unlock credits are
-- live (not reversed) Unlocks made in the month; Pass seconds are Pass Plays
-- in the month. Raises insufficient_privilege for a non-admin, as
-- ops_metrics_24h does, so the check lives with the data.
CREATE OR REPLACE FUNCTION public.operator_cinema_earnings(p_auth_id TEXT, p_month DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user   UUID;
    v_admin  BOOLEAN;
    v_from   TIMESTAMPTZ;
    v_to     TIMESTAMPTZ;
    v_rows   JSONB;
BEGIN
    SELECT u.id, u.is_admin INTO v_user, v_admin FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_user IS NULL OR v_admin IS NOT TRUE THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
    END IF;
    IF p_month IS NULL OR p_month <> date_trunc('month', p_month)::date THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_MONTH');
    END IF;
    v_from := p_month::timestamp AT TIME ZONE 'UTC';
    v_to := (p_month + interval '1 month')::timestamp AT TIME ZONE 'UTC';

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'content_id', t.content_id, 'creator_id', t.creator_id, 'title', t.title, 'content_type', t.content_type,
        'unlocks', t.unlocks, 'unlock_credits', t.unlock_credits, 'pass_plays', t.pass_plays, 'pass_seconds', t.pass_seconds)
        ORDER BY t.unlock_credits DESC, t.pass_seconds DESC, t.content_id), '[]'::jsonb)
    INTO v_rows
    FROM (
        SELECT c.id AS content_id, c.creator_id, c.title, c.content_type,
               COALESCE(u.unlocks, 0) AS unlocks, COALESCE(u.unlock_credits, 0) AS unlock_credits,
               COALESCE(p.pass_plays, 0) AS pass_plays, COALESCE(p.pass_seconds, 0) AS pass_seconds
        FROM public.cinema_content c
        LEFT JOIN (
            SELECT x.content_id, count(*)::int AS unlocks, sum(x.credits)::int AS unlock_credits
            FROM public.cinema_unlocks x
            WHERE x.reversed_at IS NULL AND x.created_at >= v_from AND x.created_at < v_to
            GROUP BY x.content_id
        ) u ON u.content_id = c.id
        LEFT JOIN (
            SELECT y.content_id, count(*)::int AS pass_plays, sum(y.seconds)::int AS pass_seconds
            FROM public.cinema_pass_plays y
            WHERE y.played_at >= v_from AND y.played_at < v_to
            GROUP BY y.content_id
        ) p ON p.content_id = c.id
        WHERE u.content_id IS NOT NULL OR p.content_id IS NOT NULL
    ) t;

    RETURN jsonb_build_object('ok', true, 'month', to_char(p_month, 'YYYY-MM'), 'generated_at', now(),
        'content', v_rows,
        'totals', jsonb_build_object(
            'unlock_credits', (SELECT COALESCE(sum((e->>'unlock_credits')::int), 0) FROM jsonb_array_elements(v_rows) e),
            'pass_seconds', (SELECT COALESCE(sum((e->>'pass_seconds')::int), 0) FROM jsonb_array_elements(v_rows) e)));
END $$;

-- ── Grants ────────────────────────────────────────────────────────────────
DO $$
DECLARE fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.cinema_pass_month_seconds(UUID, TIMESTAMPTZ)',
        'public.cinema_entitlement(TEXT, UUID)',
        'public.record_cinema_pass_play(TEXT, UUID, INTEGER)',
        'public.operator_cinema_earnings(TEXT, DATE)',
        'public.cinema_pass_plays_append_only()'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    END LOOP;
    FOREACH fn IN ARRAY ARRAY[
        'public.cinema_entitlement(TEXT, UUID)',
        'public.record_cinema_pass_play(TEXT, UUID, INTEGER)',
        'public.operator_cinema_earnings(TEXT, DATE)'
    ] LOOP
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
    REVOKE ALL ON FUNCTION public.cinema_pass_month_seconds(UUID, TIMESTAMPTZ) FROM service_role;
END $$;
