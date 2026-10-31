-- Cinema free-viewing ceiling: reserve the full authorized lease up front
-- (assessment F-15, ADR-0307).
--
-- start_cinema_playback (0245) reserved at most 60 seconds against the monthly
-- free ceiling, then the handler issued a 900-second playback token for a
-- title whose whole runtime is at most 600 seconds (Stream caps Cinema uploads
-- at 600s). Further use was recorded only by voluntary client heartbeats. A
-- client that never sends a heartbeat watches the entire title while only 60
-- seconds is charged, so the ceiling never binds: the counted seconds are far
-- below the seconds actually watched.
--
-- Fix: when a free play is granted, reserve the FULL authorized lease up front
-- — the title's runtime, bounded by the ceiling seconds remaining — as the
-- single 'start' Free Play. The ceiling is then enforced by that reservation,
-- not by heartbeats. Heartbeats become analytics: cinema_free_month_seconds
-- now sums only 'start' rows, so a heartbeat ('heartbeat') never adds to the
-- ceiling and cannot double-count the lease already reserved. The 900s token
-- is unchanged and needs no bound: a title is finite (<=600s), so no token can
-- authorize watching more than the runtime already reserved.
--
-- A viewer is charged the full runtime per play-start even if they stop early;
-- that is the safe, cost-bounding direction and matches the ADR's "reserve the
-- full authorized lease" option. (A client that re-requests playback for the
-- same title is charged again; metering rewatches more finely is left to a
-- later change and is bounded by the same ceiling.)
--
-- Idempotent (CREATE OR REPLACE; the CHECK is dropped and re-added as a strict
-- superset, so no existing <=60s row can block it). No money moves (no
-- ledger/credit_balances). The ceiling only ever counts MORE now, so it binds
-- sooner and never grants more free viewing than before — safe under the
-- Worker-only rollback contract.

-- A 'start' lease is now the title's runtime (<=600s), not a single minute.
-- Heartbeats stay <=60 by record_cinema_play's own p_seconds guard.
ALTER TABLE public.cinema_free_plays DROP CONSTRAINT IF EXISTS cinema_free_plays_seconds_check;
ALTER TABLE public.cinema_free_plays ADD CONSTRAINT cinema_free_plays_seconds_check
    CHECK (seconds BETWEEN 1 AND 600);

-- Only the up-front 'start' leases count toward the ceiling; heartbeats are
-- analytics. (0245 summed every row, which undercounted because 'start' was
-- capped at 60 and heartbeats were optional.)
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
      AND f.source = 'start'
      AND f.played_at >= (date_trunc('month', p_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
      AND f.played_at <  ((date_trunc('month', p_at AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC');
$$;

-- start_cinema_playback: 0245 body, reserving the FULL lease (title runtime
-- bounded by remaining ceiling seconds) instead of LEAST(60, remaining).
CREATE OR REPLACE FUNCTION public.start_cinema_playback(p_auth_id TEXT, p_content_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user     UUID;
    v_ent      JSONB;
    v_uid      TEXT;
    v_duration NUMERIC;
    v_ceiling  INTEGER;
    v_used     INTEGER;
    v_lease    INTEGER;
    v_counts   BOOLEAN := false;
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
    SELECT u.stream_uid, u.duration_seconds INTO v_uid, v_duration FROM public.cinema_uploads u
    WHERE u.content_id = p_content_id AND u.state = 'ready';
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('error', 'not_ready');
    END IF;
    IF v_counts THEN
        -- The full authorized lease: the title's runtime (<=600s; a ready upload
        -- always has one, so COALESCE to the 600s cap is only a guard), bounded
        -- by the ceiling seconds still left. The ceiling binds on this up-front
        -- figure, not on later heartbeats.
        v_lease := LEAST(GREATEST(1, CEIL(COALESCE(v_duration, 600))::INTEGER), COALESCE(v_ceiling, 0) * 60 - v_used);
        INSERT INTO public.cinema_free_plays (user_id, content_id, seconds, source)
        VALUES (v_user, p_content_id, v_lease, 'start');
    END IF;
    RETURN jsonb_build_object('access', v_ent->>'access', 'stream_uid', v_uid);
END $$;

-- 0245's grant map, restated for the two replaced functions (signatures
-- unchanged; the internal half stays off service_role).
REVOKE ALL ON FUNCTION public.cinema_free_month_seconds(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.start_cinema_playback(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_cinema_playback(TEXT, UUID) TO service_role;
