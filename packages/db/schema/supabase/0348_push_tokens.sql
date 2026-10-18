-- Mobile push notifications (ADR-0113, roadmap S2).
-- Applied name: 0348_push_tokens.
--
-- The phone app registers an Expo push token; when a generation finishes or
-- fails, a sweep sends one push. Three tables, all service_role-only through
-- SECURITY DEFINER functions (the browser roles hold no grant):
--
--   push_tokens        one row per device token. A token belongs to one account
--                      at a time (signing in as someone else on the same phone
--                      moves it). notify_jobs is the per-device opt-out.
--   push_outbox        one row per (job, kind): at most one push per job outcome,
--                      whatever retries happen. Holds no token and no prompt.
--   push_token_writes  one row per effective token write, for the hourly limit.
--
-- The outbox is filled by a SWEEP over finished jobs, not by a trigger on
-- public.jobs: the money path (job_stored, job_failed, ledger_refund) never runs
-- a line of push code, so a push can never change a job or the ledger. Nothing
-- here writes ledger_entries or credit_balances.
--
-- Account deletion (ADR-0111, 0347): erase_account sets users.deleted_at; the
-- trigger below removes the person's tokens and outbox rows in that same
-- transaction, without redefining erase_account.
--
-- Idempotent: IF NOT EXISTS, OR REPLACE, DROP TRIGGER IF EXISTS, REVOKE/GRANT re-run.

CREATE TABLE IF NOT EXISTS public.push_tokens (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    token        TEXT        NOT NULL UNIQUE
                             CHECK (token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,64}\]$'),
    platform     TEXT        NOT NULL CHECK (platform IN ('ios', 'android')),
    -- A stable per-install id the app generates, so a rotated token replaces the old one.
    device_id    TEXT        NULL CHECK (device_id IS NULL OR device_id ~ '^[A-Za-z0-9._-]{8,64}$'),
    app_version  TEXT        NULL CHECK (app_version IS NULL OR app_version ~ '^[A-Za-z0-9._+-]{1,32}$'),
    notify_jobs  BOOLEAN     NOT NULL DEFAULT true,
    -- Set when Expo reports the device is gone; the row is kept for the sweep's pruning only.
    disabled_at  TIMESTAMPTZ NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_tokens_user_idx ON public.push_tokens (user_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS push_tokens_active_idx ON public.push_tokens (user_id) WHERE disabled_at IS NULL AND notify_jobs;
CREATE INDEX IF NOT EXISTS push_tokens_seen_idx ON public.push_tokens (last_seen_at);
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_tokens FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_tokens FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.push_outbox (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    job_id          UUID        NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    kind            TEXT        NOT NULL CHECK (kind IN ('job_done', 'job_failed')),
    state           TEXT        NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sent', 'dead')),
    attempts        INTEGER     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_until   TIMESTAMPTZ NULL,
    last_error      TEXT        NULL CHECK (last_error IS NULL OR char_length(last_error) <= 200),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at         TIMESTAMPTZ NULL,
    UNIQUE (job_id, kind)
);
CREATE INDEX IF NOT EXISTS push_outbox_due_idx ON public.push_outbox (next_attempt_at) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS push_outbox_user_idx ON public.push_outbox (user_id);
CREATE INDEX IF NOT EXISTS push_outbox_created_idx ON public.push_outbox (created_at);
ALTER TABLE public.push_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_outbox FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_outbox FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.push_token_writes (
    id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_token_writes_user_idx ON public.push_token_writes (user_id, created_at);
ALTER TABLE public.push_token_writes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_token_writes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_token_writes FROM PUBLIC, anon, authenticated, service_role;

-- ── Register (create, rotate, move, change the opt-out) ─────────────────────
-- Replaying the same call changes nothing and does not count against the limit.
CREATE OR REPLACE FUNCTION public.register_push_token(
    p_auth_id TEXT, p_token TEXT, p_platform TEXT, p_device_id TEXT, p_app_version TEXT, p_notify_jobs BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user    public.users%ROWTYPE;
    v_row     public.push_tokens%ROWTYPE;
    v_notify  BOOLEAN := COALESCE(p_notify_jobs, true);
    v_recent  INTEGER;
    v_changed BOOLEAN := false;
BEGIN
    IF p_token IS NULL OR p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,64}\]$' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'token_invalid');
    END IF;
    IF p_platform IS NULL OR p_platform NOT IN ('ios', 'android') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'platform_invalid');
    END IF;

    SELECT * INTO v_user FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'account_not_found');
    END IF;

    SELECT * INTO v_row FROM public.push_tokens WHERE token = p_token FOR UPDATE;
    IF FOUND AND v_row.user_id = v_user.id AND v_row.disabled_at IS NULL AND v_row.platform = p_platform
       AND v_row.device_id IS NOT DISTINCT FROM p_device_id AND v_row.app_version IS NOT DISTINCT FROM p_app_version
       AND v_row.notify_jobs = v_notify THEN
        -- Nothing to change; keep last_seen_at fresh at most once a day.
        UPDATE public.push_tokens SET last_seen_at = now() WHERE id = v_row.id AND last_seen_at < now() - interval '1 day';
        RETURN jsonb_build_object('ok', true, 'registered', true, 'notify_jobs', v_notify, 'changed', false);
    END IF;

    SELECT count(*) INTO v_recent FROM public.push_token_writes
     WHERE user_id = v_user.id AND created_at > now() - interval '1 hour';
    IF v_recent >= 20 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'rate_limited', 'retry_after_seconds', 600);
    END IF;
    INSERT INTO public.push_token_writes (user_id) VALUES (v_user.id);

    -- A rotated token replaces the one this install had before.
    IF p_device_id IS NOT NULL THEN
        DELETE FROM public.push_tokens WHERE user_id = v_user.id AND device_id = p_device_id AND token <> p_token;
    END IF;

    INSERT INTO public.push_tokens (user_id, token, platform, device_id, app_version, notify_jobs)
    VALUES (v_user.id, p_token, p_platform, p_device_id, p_app_version, v_notify)
    ON CONFLICT (token) DO UPDATE
       SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, device_id = EXCLUDED.device_id,
           app_version = EXCLUDED.app_version, notify_jobs = EXCLUDED.notify_jobs,
           disabled_at = NULL, updated_at = now(), last_seen_at = now();
    v_changed := true;

    -- At most ten devices per account: the least recently seen go first.
    DELETE FROM public.push_tokens t
     WHERE t.user_id = v_user.id
       AND t.id IN (SELECT id FROM public.push_tokens WHERE user_id = v_user.id
                     ORDER BY last_seen_at DESC, id OFFSET 10);

    RETURN jsonb_build_object('ok', true, 'registered', true, 'notify_jobs', v_notify, 'changed', v_changed);
END $$;
REVOKE ALL ON FUNCTION public.register_push_token(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;

-- ── Remove (sign-out, or the person turned notifications off) ────────────────
-- Only the owner's row goes. Another account's token, or one already gone,
-- answers the same way, so the call reveals nothing and a replay is a no-op.
CREATE OR REPLACE FUNCTION public.remove_push_token(p_auth_id TEXT, p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    IF p_token IS NULL OR p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,64}\]$' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'token_invalid');
    END IF;
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'account_not_found');
    END IF;
    DELETE FROM public.push_tokens WHERE token = p_token AND user_id = v_user_id;
    RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.remove_push_token(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_push_token(TEXT, TEXT) TO service_role;

-- ── Sweep step 1: queue a push for each job that just finished ───────────────
-- Driven from the (few) people with an active token, through the user's own jobs
-- index. Chat turns are excluded (the reply is on screen). A job older than two
-- hours, or one that finished more than 15 minutes ago, is not announced: a late
-- push is worse than none, and switching the sweep on never replays history.
CREATE OR REPLACE FUNCTION public.push_enqueue_job_events(p_limit INTEGER DEFAULT 200)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_n INTEGER;
BEGIN
    WITH people AS (
        SELECT DISTINCT t.user_id FROM public.push_tokens t
         WHERE t.disabled_at IS NULL AND t.notify_jobs
    ), due AS (
        SELECT j.user_id, j.id AS job_id,
               CASE WHEN j.state = 'STORED' THEN 'job_done' ELSE 'job_failed' END AS kind
          FROM people p
          JOIN public.jobs j ON j.user_id = p.user_id
         WHERE j.created_at > now() - interval '2 hours'
           AND j.updated_at > now() - interval '15 minutes'
           AND j.state IN ('STORED', 'FAILED', 'REFUNDED')
           AND COALESCE(j.provider, '') <> 'openrouter-chat'
         ORDER BY j.updated_at
         LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000))
    ), ins AS (
        INSERT INTO public.push_outbox (user_id, job_id, kind)
        SELECT user_id, job_id, kind FROM due
        ON CONFLICT (job_id, kind) DO NOTHING
        RETURNING 1
    )
    SELECT count(*) INTO v_n FROM ins;
    RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.push_enqueue_job_events(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_enqueue_job_events(INTEGER) TO service_role;

-- ── Sweep step 2: take a batch, with a lease so two sweeps never send the same one
-- Returns [{id, kind, job_id, job_state, modality, attempts, tokens:[{id, token}]}].
-- An item whose person has no active token left is closed as dead here.
CREATE OR REPLACE FUNCTION public.push_claim_batch(p_limit INTEGER DEFAULT 50, p_lease_seconds INTEGER DEFAULT 120)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_ids UUID[];
    v_out JSONB;
BEGIN
    WITH picked AS (
        SELECT o.id FROM public.push_outbox o
         WHERE o.state = 'pending' AND o.next_attempt_at <= now()
           AND (o.claimed_until IS NULL OR o.claimed_until < now())
         ORDER BY o.created_at
         LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
         FOR UPDATE SKIP LOCKED
    ), claimed AS (
        UPDATE public.push_outbox o
           SET attempts = o.attempts + 1,
               claimed_until = now() + make_interval(secs => GREATEST(30, LEAST(COALESCE(p_lease_seconds, 120), 600)))
          FROM picked WHERE o.id = picked.id
        RETURNING o.id
    )
    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_ids FROM claimed;

    -- Nobody left to tell: close the item instead of sending to no one.
    UPDATE public.push_outbox o
       SET state = 'dead', claimed_until = NULL, last_error = 'no_active_token'
     WHERE o.id = ANY(v_ids)
       AND NOT EXISTS (SELECT 1 FROM public.push_tokens t
                        WHERE t.user_id = o.user_id AND t.disabled_at IS NULL AND t.notify_jobs);

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', o.id, 'kind', o.kind, 'job_id', o.job_id, 'job_state', j.state::text,
               'modality', m.modality, 'attempts', o.attempts,
               'tokens', (SELECT jsonb_agg(jsonb_build_object('id', t.id, 'token', t.token))
                            FROM public.push_tokens t
                           WHERE t.user_id = o.user_id AND t.disabled_at IS NULL AND t.notify_jobs))
               ORDER BY o.created_at), '[]'::jsonb)
      INTO v_out
      FROM public.push_outbox o
      JOIN public.jobs j ON j.id = o.job_id
      LEFT JOIN public.model_catalog m ON m.id = j.model_id
     WHERE o.id = ANY(v_ids) AND o.state = 'pending';
    RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.push_claim_batch(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_claim_batch(INTEGER, INTEGER) TO service_role;

-- ── Sweep step 3: record what Expo said ──────────────────────────────────────
-- 'sent' closes the item; 'retry' tries again in attempts x 2 minutes, and the
-- fourth failed attempt closes it as dead; 'dead' closes it now. Tokens Expo
-- called unregistered are switched off (only this item's own person's tokens).
CREATE OR REPLACE FUNCTION public.push_settle(p_id UUID, p_outcome TEXT, p_error TEXT, p_dead_token_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_o public.push_outbox%ROWTYPE;
BEGIN
    SELECT * INTO v_o FROM public.push_outbox WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;
    IF p_dead_token_ids IS NOT NULL AND cardinality(p_dead_token_ids) > 0 THEN
        UPDATE public.push_tokens SET disabled_at = now(), updated_at = now()
         WHERE user_id = v_o.user_id AND id = ANY(p_dead_token_ids) AND disabled_at IS NULL;
    END IF;
    IF v_o.state <> 'pending' THEN
        RETURN jsonb_build_object('ok', true, 'state', v_o.state);
    END IF;
    IF p_outcome = 'sent' THEN
        UPDATE public.push_outbox SET state = 'sent', sent_at = now(), claimed_until = NULL, last_error = NULL WHERE id = p_id;
        RETURN jsonb_build_object('ok', true, 'state', 'sent');
    ELSIF p_outcome = 'retry' AND v_o.attempts < 4 THEN
        UPDATE public.push_outbox
           SET claimed_until = NULL, next_attempt_at = now() + make_interval(mins => 2 * v_o.attempts),
               last_error = left(COALESCE(p_error, 'send_failed'), 200)
         WHERE id = p_id;
        RETURN jsonb_build_object('ok', true, 'state', 'pending');
    END IF;
    UPDATE public.push_outbox
       SET state = 'dead', claimed_until = NULL, last_error = left(COALESCE(p_error, 'send_failed'), 200)
     WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'state', 'dead');
END $$;
REVOKE ALL ON FUNCTION public.push_settle(UUID, TEXT, TEXT, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_settle(UUID, TEXT, TEXT, UUID[]) TO service_role;

-- ── Housekeeping ─────────────────────────────────────────────────────────────
-- Tokens not seen for 180 days (the app re-registers on launch), outbox rows
-- after a week, write-log rows after a day.
CREATE OR REPLACE FUNCTION public.push_prune()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tokens INTEGER;
    v_outbox INTEGER;
BEGIN
    DELETE FROM public.push_tokens WHERE last_seen_at < now() - interval '180 days';
    GET DIAGNOSTICS v_tokens = ROW_COUNT;
    DELETE FROM public.push_outbox WHERE created_at < now() - interval '7 days';
    GET DIAGNOSTICS v_outbox = ROW_COUNT;
    DELETE FROM public.push_token_writes WHERE created_at < now() - interval '1 day';
    RETURN jsonb_build_object('tokens', v_tokens, 'outbox', v_outbox);
END $$;
REVOKE ALL ON FUNCTION public.push_prune() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_prune() TO service_role;

-- ── Account deletion hook (ADR-0111) ─────────────────────────────────────────
-- erase_account tombstones the user row; this runs in that same transaction, so
-- a rolled-back erasure keeps the tokens and a completed one leaves none.
CREATE OR REPLACE FUNCTION private.push_forget_erased_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        DELETE FROM public.push_outbox WHERE user_id = NEW.id;
        DELETE FROM public.push_tokens WHERE user_id = NEW.id;
        DELETE FROM public.push_token_writes WHERE user_id = NEW.id;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.push_forget_erased_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS users_push_forget_erased ON public.users;
CREATE TRIGGER users_push_forget_erased
    AFTER UPDATE OF deleted_at ON public.users
    FOR EACH ROW EXECUTE FUNCTION private.push_forget_erased_user();
