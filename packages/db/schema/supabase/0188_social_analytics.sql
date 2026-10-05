-- 0188_social_analytics.sql — ADR-0061 v1 "basic per-network analytics"
-- (technical spec §2.5): what the analytics sweep stores and the one read
-- the dashboard makes.
--
-- Three tables, all deny-by-default like 0154 (no client policies; every
-- read and write goes through a SECURITY DEFINER RPC, service-role only):
--   * social_analytics_snapshots — one row per account, connector and day.
--     'evolution' is the only connector so far: account totals as they stood
--     that day (followers, following, posts_count, ...).
--   * social_analytics_posts — one row per post the network reports for the
--     account, whether or not Veyrnox published it.
--   * social_analytics_sync — when each account is next due, and how its
--     last fetch went.
--
-- A failed fetch is kept on the account's sync row, not appended to
-- social_account_actions as §2.5 first proposed: a broken account would add
-- a permanent audit row every few hours for as long as it stayed broken.
--
-- Additive and idempotent. Nothing calls these until the Worker's analytics
-- sweep is switched on (PUBLISH_ANALYTICS_ENABLED) and Publish itself is
-- open (PUBLISH_ENABLED), so the previous release is unaffected.

-- ── Tables ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.social_analytics_sync (
    account_id    UUID        PRIMARY KEY REFERENCES public.social_accounts(id) ON DELETE CASCADE,
    next_sync_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_ok_at    TIMESTAMPTZ NULL,
    last_error    TEXT        NULL CHECK (char_length(last_error) <= 200),
    last_error_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS social_analytics_sync_due_idx ON public.social_analytics_sync (next_sync_at);
ALTER TABLE public.social_analytics_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_analytics_sync FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_analytics_sync FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.social_analytics_snapshots (
    account_id  UUID        NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
    connector   TEXT        NOT NULL CHECK (connector IN ('evolution')),
    metric_date DATE        NOT NULL,
    metrics     JSONB       NOT NULL CHECK (jsonb_typeof(metrics) = 'object'),
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, connector, metric_date)
);
ALTER TABLE public.social_analytics_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_analytics_snapshots FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_analytics_snapshots FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.social_analytics_posts (
    account_id       UUID        NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
    platform_post_id TEXT        NOT NULL CHECK (char_length(platform_post_id) BETWEEN 1 AND 128),
    published_at     TIMESTAMPTZ NOT NULL,
    post_type        TEXT        NULL CHECK (post_type ~ '^[a-z_]{1,32}$'),
    permalink        TEXT        NULL CHECK (permalink ~ '^https://' AND char_length(permalink) <= 500),
    caption          TEXT        NULL CHECK (char_length(caption) <= 500),
    metrics          JSONB       NOT NULL CHECK (jsonb_typeof(metrics) = 'object'),
    fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, platform_post_id)
);
CREATE INDEX IF NOT EXISTS social_analytics_posts_published_idx
    ON public.social_analytics_posts (account_id, published_at DESC);
ALTER TABLE public.social_analytics_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_analytics_posts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_analytics_posts FROM PUBLIC, anon, authenticated, service_role;

-- ── social_analytics_numbers (internal): the numeric, well-named keys of a
-- metrics object. Everything a network sends back is untrusted, so anything
-- that is not a plain number under a snake_case key is dropped here.
CREATE OR REPLACE FUNCTION public.social_analytics_numbers(p_metrics JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    FROM jsonb_each(CASE WHEN jsonb_typeof(p_metrics) = 'object' THEN p_metrics ELSE '{}'::jsonb END) e
    WHERE e.key ~ '^[a-z_]{1,32}$' AND jsonb_typeof(e.value) = 'number';
$$;

-- ── claim_social_analytics_accounts: the active accounts due a fetch ──────
-- Claiming pushes next_sync_at six hours on in the same statement, so a
-- sweep that dies mid-fetch simply leaves that account for the next round
-- and two overlapping sweeps never fetch the same account. p_networks is the
-- list the Worker has a fetcher for; other networks are never claimed.
-- Returns the encrypted tokens: service-role only, like the publish claim.
CREATE OR REPLACE FUNCTION public.claim_social_analytics_accounts(p_limit INTEGER, p_networks TEXT[])
RETURNS TABLE (
    account_id UUID, network TEXT, external_account_id TEXT,
    access_token_enc BYTEA, refresh_token_enc BYTEA, token_expires_at TIMESTAMPTZ, scopes_granted TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
    INSERT INTO public.social_analytics_sync (account_id)
    SELECT a.id FROM public.social_accounts a
    WHERE a.status = 'active' AND a.network = ANY(COALESCE(p_networks, '{}'))
    ON CONFLICT (account_id) DO NOTHING;

    RETURN QUERY
    WITH due AS (
        SELECT s.account_id AS id
        FROM public.social_analytics_sync s
        JOIN public.social_accounts a ON a.id = s.account_id
        WHERE s.next_sync_at <= now()
          AND a.status = 'active' AND a.access_token_enc IS NOT NULL
          AND a.network = ANY(COALESCE(p_networks, '{}'))
        ORDER BY s.next_sync_at
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 0), 0), 50)
        FOR UPDATE OF s SKIP LOCKED
    ), claimed AS (
        UPDATE public.social_analytics_sync s
        SET next_sync_at = now() + INTERVAL '6 hours'
        FROM due WHERE s.account_id = due.id
        RETURNING s.account_id AS id
    )
    SELECT a.id, a.network, a.external_account_id,
           a.access_token_enc, a.refresh_token_enc, a.token_expires_at, a.scopes_granted
    FROM claimed c JOIN public.social_accounts a ON a.id = c.id;
END $$;

-- ── record_social_analytics: one fetch's result for one account ───────────
-- Upserts the day's evolution snapshot and each reported post, so a replay
-- changes nothing and a later fetch brings the newer numbers. Metrics are
-- merged key by key, not replaced: a fetch that could not read one number
-- (insights are only refreshed for the newest posts) keeps the stored one. p_posts is a JSON array of
-- {id, published_at, type, permalink, caption, metrics}; malformed entries
-- are skipped, not failed. {ok:true, posts:n} or {ok:false, code} with
-- ACCOUNT_NOT_FOUND (also when the account is no longer active),
-- INVALID_DATE.
CREATE OR REPLACE FUNCTION public.record_social_analytics(
    p_account_id UUID,
    p_metric_date DATE,
    p_metrics JSONB,
    p_posts JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_posts INTEGER := 0;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.social_accounts a WHERE a.id = p_account_id AND a.status = 'active') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_NOT_FOUND');
    END IF;
    IF p_metric_date IS NULL OR p_metric_date > (now() AT TIME ZONE 'UTC')::DATE + 1
        OR p_metric_date < (now() AT TIME ZONE 'UTC')::DATE - 1 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_DATE');
    END IF;

    INSERT INTO public.social_analytics_snapshots (account_id, connector, metric_date, metrics)
    VALUES (p_account_id, 'evolution', p_metric_date, public.social_analytics_numbers(p_metrics))
    ON CONFLICT (account_id, connector, metric_date) DO UPDATE
        SET metrics = public.social_analytics_snapshots.metrics || EXCLUDED.metrics, fetched_at = now();

    IF jsonb_typeof(p_posts) = 'array' THEN
        WITH incoming AS (
            SELECT DISTINCT ON (e.value->>'id')
                e.value->>'id' AS id,
                e.value->>'published_at' AS published_at,
                e.value->>'type' AS post_type,
                e.value->>'permalink' AS permalink,
                e.value->>'caption' AS caption,
                e.value->'metrics' AS metrics
            FROM jsonb_array_elements(p_posts) WITH ORDINALITY AS e(value, n)
            WHERE e.n <= 100
              AND jsonb_typeof(e.value) = 'object'
              AND char_length(e.value->>'id') BETWEEN 1 AND 128
              AND e.value->>'published_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$'
        ), written AS (
            INSERT INTO public.social_analytics_posts
                (account_id, platform_post_id, published_at, post_type, permalink, caption, metrics)
            SELECT p_account_id, i.id, i.published_at::TIMESTAMPTZ,
                CASE WHEN i.post_type ~ '^[a-z_]{1,32}$' THEN i.post_type END,
                CASE WHEN i.permalink ~ '^https://' AND char_length(i.permalink) <= 500 THEN i.permalink END,
                left(i.caption, 500),
                public.social_analytics_numbers(i.metrics)
            FROM incoming i
            ON CONFLICT (account_id, platform_post_id) DO UPDATE SET
                published_at = EXCLUDED.published_at, post_type = EXCLUDED.post_type,
                permalink = EXCLUDED.permalink, caption = EXCLUDED.caption,
                metrics = public.social_analytics_posts.metrics || EXCLUDED.metrics, fetched_at = now()
            RETURNING 1
        )
        SELECT count(*) INTO v_posts FROM written;
    END IF;

    INSERT INTO public.social_analytics_sync (account_id, next_sync_at, last_ok_at)
    VALUES (p_account_id, now() + INTERVAL '6 hours', now())
    ON CONFLICT (account_id) DO UPDATE
        SET last_ok_at = now(), last_error = NULL, last_error_at = NULL;

    RETURN jsonb_build_object('ok', true, 'posts', v_posts);
END $$;

-- ── record_social_analytics_failure: the last fetch did not work ──────────
-- Keeps earlier data and the claim's six-hour retry. {ok:true}.
CREATE OR REPLACE FUNCTION public.record_social_analytics_failure(p_account_id UUID, p_error TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.social_analytics_sync
    SET last_error = left(COALESCE(NULLIF(btrim(p_error), ''), 'fetch_failed'), 200), last_error_at = now()
    WHERE account_id = p_account_id;
    RETURN jsonb_build_object('ok', true);
END $$;

-- ── get_social_analytics: the dashboard's read, for one of the caller's own
-- accounts. Never returns a token or the stored error text (it can quote a
-- network's own message). {ok:true, account, sync, evolution:[{date,
-- metrics}], posts:[...]} — evolution oldest first, posts newest first and
-- capped at 200 — or {ok:false, code} with USER_NOT_FOUND,
-- ACCOUNT_NOT_FOUND, INVALID_RANGE (from after to, or more than 366 days).
CREATE OR REPLACE FUNCTION public.get_social_analytics(
    p_auth_id TEXT,
    p_account_id UUID,
    p_from DATE,
    p_to DATE
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user    UUID;
    v_account public.social_accounts%ROWTYPE;
    v_sync    public.social_analytics_sync%ROWTYPE;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    SELECT u.id INTO v_user FROM public.users u
    JOIN auth.users a ON a.id = p_auth_id::UUID
    WHERE u.auth_id = p_auth_id;
    IF v_user IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 366 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_RANGE');
    END IF;

    SELECT a.* INTO v_account FROM public.social_accounts a
    JOIN public.social_brands b ON b.id = a.brand_id
    WHERE a.id = p_account_id AND b.owner_user_id = v_user;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_NOT_FOUND');
    END IF;
    SELECT s.* INTO v_sync FROM public.social_analytics_sync s WHERE s.account_id = v_account.id;

    RETURN jsonb_build_object(
        'ok', true,
        'account', jsonb_build_object('id', v_account.id, 'network', v_account.network,
            'display_name', v_account.display_name, 'status', v_account.status),
        'sync', jsonb_build_object('last_ok_at', v_sync.last_ok_at,
            'failing', v_sync.last_error_at IS NOT NULL),
        'evolution', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('date', s.metric_date, 'metrics', s.metrics) ORDER BY s.metric_date)
            FROM public.social_analytics_snapshots s
            WHERE s.account_id = v_account.id AND s.connector = 'evolution'
              AND s.metric_date BETWEEN p_from AND p_to
        ), '[]'::jsonb),
        'posts', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', p.platform_post_id, 'published_at', p.published_at, 'type', p.post_type,
                'permalink', p.permalink, 'caption', p.caption, 'metrics', p.metrics)
                ORDER BY p.published_at DESC)
            FROM (
                SELECT * FROM public.social_analytics_posts p
                WHERE p.account_id = v_account.id
                  AND p.published_at >= p_from::TIMESTAMPTZ
                  AND p.published_at < (p_to + 1)::TIMESTAMPTZ
                ORDER BY p.published_at DESC LIMIT 200
            ) p
        ), '[]'::jsonb)
    );
END $$;

-- ── Grants ────────────────────────────────────────────────────────────────
DO $$
DECLARE fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.claim_social_analytics_accounts(INTEGER, TEXT[])',
        'public.record_social_analytics(UUID, DATE, JSONB, JSONB)',
        'public.record_social_analytics_failure(UUID, TEXT)',
        'public.get_social_analytics(TEXT, UUID, DATE, DATE)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
    REVOKE ALL ON FUNCTION public.social_analytics_numbers(JSONB) FROM PUBLIC, anon, authenticated;
END $$;
