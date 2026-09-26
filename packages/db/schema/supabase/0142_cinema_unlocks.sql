-- 0142_cinema_unlocks.sql — ADR-0057 Phase 1: Free Episodes and Episode Unlock.
--
-- Additive and idempotent. Ships behind CINEMA_UNLOCKS_ENABLED (off).
-- Nothing here publishes content: the widened CHECKs let a later publication
-- slice set PUBLISHED/PUBLIC, but no function in this file or before it
-- writes those values, so every existing draft stays private.
--
-- Money rules (CLAUDE.md, ADR-0013, ADR-0018): an Unlock is a ledger row
-- written by ledger_unlock, a sibling of ledger_debit (which cannot be reused
-- because it creates a jobs row). Free Credits spend first, Frozen accounts
-- are denied, and credit_balances moves with every row so
-- reconcile_balances() and reconcile_free_credits() stay at zero rows.

-- ── cinema_content: admit the published states (no writer yet) ────────────
ALTER TABLE public.cinema_content DROP CONSTRAINT IF EXISTS cinema_content_lifecycle_status_check;
ALTER TABLE public.cinema_content ADD CONSTRAINT cinema_content_lifecycle_status_check
    CHECK (lifecycle_status IN ('DRAFT', 'PUBLISHED'));
ALTER TABLE public.cinema_content DROP CONSTRAINT IF EXISTS cinema_content_visibility_check;
ALTER TABLE public.cinema_content ADD CONSTRAINT cinema_content_visibility_check
    CHECK (visibility IN ('PRIVATE', 'PUBLIC'));

-- ── Prices: the only source of an unlock price or a free-episode count ─────
CREATE TABLE IF NOT EXISTS public.cinema_prices (
    key        TEXT        PRIMARY KEY CHECK (key IN ('episode_unlock', 'film_unlock', 'free_episodes')),
    value      INTEGER     NOT NULL CHECK (value BETWEEN 0 AND 50),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cinema_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_prices FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_prices FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO public.cinema_prices (key, value)
VALUES ('episode_unlock', 6), ('film_unlock', 6), ('free_episodes', 5)
ON CONFLICT (key) DO NOTHING;

-- ── Unlocks ───────────────────────────────────────────────────────────────
-- One live Unlock per user and content. A reversed Unlock (content taken
-- down) keeps its rows for the audit trail and no longer grants access; a
-- fresh Unlock is possible if the content is published again.
CREATE TABLE IF NOT EXISTS public.cinema_unlocks (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID        NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    content_id        UUID        NOT NULL REFERENCES public.cinema_content(id) ON DELETE RESTRICT,
    ledger_entry_id   UUID        NOT NULL REFERENCES public.ledger_entries(id) ON DELETE RESTRICT,
    credits           INTEGER     NOT NULL CHECK (credits > 0),
    consent_version   TEXT        NOT NULL CHECK (consent_version ~ '^[A-Za-z0-9._-]{1,32}$'),
    consent_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    reversed_at       TIMESTAMPTZ NULL,
    reversal_entry_id UUID        NULL REFERENCES public.ledger_entries(id) ON DELETE RESTRICT,
    CONSTRAINT cinema_unlocks_reversal_pair CHECK ((reversed_at IS NULL) = (reversal_entry_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS cinema_unlocks_live_one_per_content
    ON public.cinema_unlocks (user_id, content_id) WHERE reversed_at IS NULL;
CREATE INDEX IF NOT EXISTS cinema_unlocks_content_idx ON public.cinema_unlocks (content_id, created_at);
ALTER TABLE public.cinema_unlocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_unlocks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_unlocks FROM PUBLIC, anon, authenticated, service_role;

-- Fixed-minute attempt window, the 0117 shape: 20 attempts, saturating at 21.
CREATE TABLE IF NOT EXISTS public.cinema_unlock_rate_limits (
    user_id           UUID        PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    window_started_at TIMESTAMPTZ NOT NULL,
    request_count     INTEGER     NOT NULL CHECK (request_count BETWEEN 1 AND 21)
);
ALTER TABLE public.cinema_unlock_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_unlock_rate_limits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_unlock_rate_limits FROM PUBLIC, anon, authenticated, service_role;

-- Operator takedown reversals, append-only like account_actions.
CREATE TABLE IF NOT EXISTS public.cinema_unlock_reversals (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    content_id       UUID        NOT NULL REFERENCES public.cinema_content(id) ON DELETE RESTRICT,
    operator         TEXT        NOT NULL CHECK (length(btrim(operator)) BETWEEN 1 AND 120),
    reason           TEXT        NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
    unlocks_reversed INTEGER     NOT NULL CHECK (unlocks_reversed >= 0),
    credits_returned INTEGER     NOT NULL CHECK (credits_returned >= 0),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cinema_unlock_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_unlock_reversals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_unlock_reversals FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.cinema_unlock_reversals_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    RAISE EXCEPTION 'cinema_unlock_reversals is append-only';
END $$;
DROP TRIGGER IF EXISTS cinema_unlock_reversals_append_only ON public.cinema_unlock_reversals;
CREATE TRIGGER cinema_unlock_reversals_append_only
    BEFORE UPDATE OR DELETE ON public.cinema_unlock_reversals
    FOR EACH ROW EXECUTE FUNCTION public.cinema_unlock_reversals_append_only();

-- ── cinema_unlock_price: NULL = not viewable, 0 = free, else credits ──────
-- SHORT and TRAILER are always free. The first `free_episodes` episodes of
-- season 1 are free. FILM and every other episode carry the catalog price.
-- SERIES and SEASON are containers and are never played.
CREATE OR REPLACE FUNCTION public.cinema_unlock_price(p_content_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row    public.cinema_content%ROWTYPE;
    v_season public.cinema_content%ROWTYPE;
    v_value  INTEGER;
BEGIN
    SELECT * INTO v_row FROM public.cinema_content WHERE id = p_content_id;
    IF NOT FOUND OR v_row.lifecycle_status <> 'PUBLISHED' OR v_row.visibility <> 'PUBLIC' THEN
        RETURN NULL;
    END IF;
    IF v_row.content_type IN ('SHORT', 'TRAILER') THEN
        RETURN 0;
    END IF;
    IF v_row.content_type = 'FILM' THEN
        SELECT value INTO v_value FROM public.cinema_prices WHERE key = 'film_unlock';
        RETURN v_value;
    END IF;
    IF v_row.content_type = 'EPISODE' THEN
        SELECT * INTO v_season FROM public.cinema_content WHERE id = v_row.parent_id;
        SELECT value INTO v_value FROM public.cinema_prices WHERE key = 'free_episodes';
        IF v_season.position = 1 AND v_row.position <= v_value THEN
            RETURN 0;
        END IF;
        SELECT value INTO v_value FROM public.cinema_prices WHERE key = 'episode_unlock';
        RETURN v_value;
    END IF;
    RETURN NULL;
END $$;

-- ── cinema_entitlement: what this viewer may do with this content ─────────
-- {access: 'free'|'unlocked'|'locked', credits} or {error: 'content_not_found'}.
-- Phase 2 adds 'pass'. Identity is optional: an unknown or absent viewer sees
-- free or locked only. Never trusts a client-supplied user id.
CREATE OR REPLACE FUNCTION public.cinema_entitlement(p_auth_id TEXT, p_content_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_price INTEGER;
    v_user  UUID;
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
        IF v_user IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.cinema_unlocks x
            WHERE x.user_id = v_user AND x.content_id = p_content_id AND x.reversed_at IS NULL
        ) THEN
            RETURN jsonb_build_object('access', 'unlocked', 'credits', 0);
        END IF;
    END IF;
    RETURN jsonb_build_object('access', 'locked', 'credits', v_price);
END $$;

-- ── ledger_unlock: the money half. Same lock order as ledger_debit. ───────
-- Returns {ok:true, unlock_id, entry_id, idempotent, balance_after} or
-- {ok:false, code} with INVALID_CREDITS, NO_BALANCE_ROW, ACCOUNT_FROZEN or
-- INSUFFICIENT_BALANCE. The balance lock serializes every Unlock writer, so
-- the partial unique index is a backstop, not the concurrency control.
CREATE OR REPLACE FUNCTION public.ledger_unlock(
    p_user_id UUID,
    p_content_id UUID,
    p_credits INTEGER,
    p_consent_version TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_balance   INTEGER;
    v_free      INTEGER;
    v_free_part INTEGER;
    v_existing  public.cinema_unlocks%ROWTYPE;
    v_entry_id  UUID;
    v_unlock_id UUID;
BEGIN
    IF p_credits IS NULL OR p_credits <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CREDITS');
    END IF;

    SELECT balance, free_balance INTO v_balance, v_free FROM public.credit_balances
    WHERE user_id = p_user_id
    FOR UPDATE;
    IF v_balance IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NO_BALANCE_ROW');
    END IF;

    SELECT * INTO v_existing FROM public.cinema_unlocks
    WHERE user_id = p_user_id AND content_id = p_content_id AND reversed_at IS NULL;
    IF FOUND THEN
        RETURN jsonb_build_object('ok', true, 'unlock_id', v_existing.id, 'entry_id', v_existing.ledger_entry_id,
                                  'idempotent', true, 'balance_after', v_balance);
    END IF;

    -- Under the balance lock every Freeze also takes, so none races this.
    IF EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.frozen_at IS NOT NULL) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN');
    END IF;

    IF v_balance < p_credits THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_BALANCE', 'balance', v_balance);
    END IF;

    v_free_part := LEAST(v_free, p_credits);

    INSERT INTO public.ledger_entries (user_id, delta, free_delta, reason, job_id)
    VALUES (p_user_id, -p_credits, -v_free_part, 'unlock:cinema:' || p_content_id::text, NULL)
    RETURNING id INTO v_entry_id;

    UPDATE public.credit_balances
    SET balance = balance - p_credits, free_balance = free_balance - v_free_part, updated_at = now()
    WHERE user_id = p_user_id;

    INSERT INTO public.cinema_unlocks (user_id, content_id, ledger_entry_id, credits, consent_version)
    VALUES (p_user_id, p_content_id, v_entry_id, p_credits, p_consent_version)
    RETURNING id INTO v_unlock_id;

    RETURN jsonb_build_object('ok', true, 'unlock_id', v_unlock_id, 'entry_id', v_entry_id,
                              'idempotent', false, 'balance_after', v_balance - p_credits);
END $$;

-- ── unlock_cinema_content: identity, content, consent, rate limit, money ──
-- Returns {ok:true, access:'free'|'unlocked', credits, balance_after, idempotent}
-- or {error} with not_authenticated, account_not_active, account_frozen,
-- consent_required, content_not_found, rate_limited (+retry_after_seconds),
-- insufficient_credits (+balance) or temporarily_unavailable.
CREATE OR REPLACE FUNCTION public.unlock_cinema_content(
    p_auth_id TEXT,
    p_content_id UUID,
    p_consent_version TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user     UUID;
    v_frozen   BOOLEAN;
    v_status   TEXT;
    v_price    INTEGER;
    v_existing public.cinema_unlocks%ROWTYPE;
    v_now      TIMESTAMPTZ := clock_timestamp();
    v_start    TIMESTAMPTZ;
    v_count    INTEGER;
    v_result   JSONB;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('error', 'not_authenticated');
    END IF;
    -- A still-valid token after Auth deletion must not spend anything.
    SELECT u.id, u.frozen_at IS NOT NULL INTO v_user, v_frozen
    FROM public.users u JOIN auth.users a ON a.id = p_auth_id::UUID
    WHERE u.auth_id = p_auth_id;
    IF v_user IS NULL THEN
        RETURN jsonb_build_object('error', 'not_authenticated');
    END IF;
    SELECT m.account_status INTO v_status FROM public.cinema_memberships m WHERE m.user_id = v_user;
    IF v_status IS NOT NULL AND v_status <> 'active' THEN
        RETURN jsonb_build_object('error', 'account_not_active');
    END IF;
    IF v_frozen THEN
        RETURN jsonb_build_object('error', 'account_frozen');
    END IF;
    IF p_consent_version IS NULL OR p_consent_version !~ '^[A-Za-z0-9._-]{1,32}$' THEN
        RETURN jsonb_build_object('error', 'consent_required');
    END IF;

    v_price := public.cinema_unlock_price(p_content_id);
    IF v_price IS NULL THEN
        RETURN jsonb_build_object('error', 'content_not_found');
    END IF;
    IF v_price = 0 THEN
        RETURN jsonb_build_object('ok', true, 'access', 'free', 'credits', 0, 'idempotent', true);
    END IF;

    SELECT * INTO v_existing FROM public.cinema_unlocks
    WHERE user_id = v_user AND content_id = p_content_id AND reversed_at IS NULL;
    IF FOUND THEN
        RETURN jsonb_build_object('ok', true, 'access', 'unlocked', 'unlock_id', v_existing.id,
                                  'credits', v_existing.credits, 'idempotent', true);
    END IF;

    -- Attempts that reach the ledger are bounded; replays above never count.
    INSERT INTO public.cinema_unlock_rate_limits AS r (user_id, window_started_at, request_count)
    VALUES (v_user, v_now, 1)
    ON CONFLICT (user_id) DO UPDATE SET
        window_started_at = CASE WHEN r.window_started_at <= v_now - interval '60 seconds'
            THEN v_now ELSE r.window_started_at END,
        request_count = CASE WHEN r.window_started_at <= v_now - interval '60 seconds'
            THEN 1 ELSE LEAST(r.request_count + 1, 21) END
    RETURNING window_started_at, request_count INTO v_start, v_count;
    IF v_count > 20 THEN
        RETURN jsonb_build_object('error', 'rate_limited', 'retry_after_seconds', LEAST(60, GREATEST(1,
            ceil(extract(epoch FROM (v_start + interval '60 seconds' - v_now)))::INTEGER)));
    END IF;

    v_result := public.ledger_unlock(v_user, p_content_id, v_price, p_consent_version);
    IF (v_result->>'ok')::boolean THEN
        RETURN jsonb_build_object('ok', true, 'access', 'unlocked', 'unlock_id', v_result->'unlock_id',
                                  'credits', v_price, 'balance_after', v_result->'balance_after',
                                  'idempotent', v_result->'idempotent');
    END IF;
    IF v_result->>'code' = 'INSUFFICIENT_BALANCE' THEN
        RETURN jsonb_build_object('error', 'insufficient_credits', 'credits', v_price, 'balance', v_result->'balance');
    END IF;
    IF v_result->>'code' = 'ACCOUNT_FROZEN' THEN
        RETURN jsonb_build_object('error', 'account_frozen');
    END IF;
    RETURN jsonb_build_object('error', 'temporarily_unavailable');
END $$;

-- ── read_cinema_playback: the Stream video an entitled viewer may play ─────
-- {stream_uid, access} when the viewer is entitled and the upload is ready;
-- {error: 'locked'|'content_not_found'|'not_ready'} otherwise. The playback
-- route mints the short-lived signed token from this and nothing else.
CREATE OR REPLACE FUNCTION public.read_cinema_playback(p_auth_id TEXT, p_content_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_ent JSONB;
    v_uid TEXT;
BEGIN
    v_ent := public.cinema_entitlement(p_auth_id, p_content_id);
    IF v_ent ? 'error' THEN
        RETURN v_ent;
    END IF;
    IF v_ent->>'access' = 'locked' THEN
        RETURN jsonb_build_object('error', 'locked', 'credits', v_ent->'credits');
    END IF;
    SELECT u.stream_uid INTO v_uid FROM public.cinema_uploads u
    WHERE u.content_id = p_content_id AND u.state = 'ready';
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('error', 'not_ready');
    END IF;
    RETURN jsonb_build_object('access', v_ent->>'access', 'stream_uid', v_uid);
END $$;

-- ── reverse_cinema_unlocks: Operator takedown reversal (ADR-0057 §5) ──────
-- Reverses every live Unlock of the content from the last 30 days as
-- compensating rows. Free Credits go back to Free only while the user's
-- sign-up grant has not expired (ADR-0013); afterwards they return as Pack
-- Credits so an expired grant is never resurrected. Service-role only; the
-- route must take p_operator from a verified identity, never a body.
CREATE OR REPLACE FUNCTION public.reverse_cinema_unlocks(
    p_content_id UUID,
    p_operator TEXT,
    p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_unlock    public.cinema_unlocks%ROWTYPE;
    v_free_part INTEGER;
    v_entry_id  UUID;
    v_count     INTEGER := 0;
    v_credits   INTEGER := 0;
BEGIN
    IF p_operator IS NULL OR length(btrim(p_operator)) NOT BETWEEN 1 AND 120
       OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'OPERATOR_AND_REASON_REQUIRED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.cinema_content c WHERE c.id = p_content_id) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CONTENT_NOT_FOUND');
    END IF;

    FOR v_unlock IN
        SELECT * FROM public.cinema_unlocks x
        WHERE x.content_id = p_content_id AND x.reversed_at IS NULL
          AND x.created_at > now() - interval '30 days'
        ORDER BY x.user_id
        FOR UPDATE
    LOOP
        PERFORM 1 FROM public.credit_balances b WHERE b.user_id = v_unlock.user_id FOR UPDATE;

        SELECT COALESCE(-l.free_delta, 0) INTO v_free_part FROM public.ledger_entries l
        WHERE l.id = v_unlock.ledger_entry_id;
        IF EXISTS (SELECT 1 FROM public.ledger_entries l
                   WHERE l.user_id = v_unlock.user_id AND l.reason = 'expire:free') THEN
            v_free_part := 0;
        END IF;

        INSERT INTO public.ledger_entries (user_id, delta, free_delta, reason, job_id)
        VALUES (v_unlock.user_id, v_unlock.credits, v_free_part,
                'reverse:cinema_unlock:' || p_content_id::text, NULL)
        RETURNING id INTO v_entry_id;

        UPDATE public.credit_balances
        SET balance = balance + v_unlock.credits, free_balance = free_balance + v_free_part, updated_at = now()
        WHERE user_id = v_unlock.user_id;

        UPDATE public.cinema_unlocks
        SET reversed_at = now(), reversal_entry_id = v_entry_id
        WHERE id = v_unlock.id;

        v_count := v_count + 1;
        v_credits := v_credits + v_unlock.credits;
    END LOOP;

    INSERT INTO public.cinema_unlock_reversals (content_id, operator, reason, unlocks_reversed, credits_returned)
    VALUES (p_content_id, btrim(p_operator), btrim(p_reason), v_count, v_credits);

    RETURN jsonb_build_object('ok', true, 'unlocks_reversed', v_count, 'credits_returned', v_credits);
END $$;

-- ── Grants: every new function names its full signature ───────────────────
DO $$
DECLARE fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.cinema_unlock_price(UUID)',
        'public.cinema_entitlement(TEXT, UUID)',
        'public.ledger_unlock(UUID, UUID, INTEGER, TEXT)',
        'public.unlock_cinema_content(TEXT, UUID, TEXT)',
        'public.read_cinema_playback(TEXT, UUID)',
        'public.reverse_cinema_unlocks(UUID, TEXT, TEXT)',
        'public.cinema_unlock_reversals_append_only()'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    END LOOP;
    FOREACH fn IN ARRAY ARRAY[
        'public.cinema_entitlement(TEXT, UUID)',
        'public.unlock_cinema_content(TEXT, UUID, TEXT)',
        'public.read_cinema_playback(TEXT, UUID)',
        'public.reverse_cinema_unlocks(UUID, TEXT, TEXT)'
    ] LOOP
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
    -- Internal halves: callable only from the SECURITY DEFINER functions above.
    REVOKE ALL ON FUNCTION public.cinema_unlock_price(UUID) FROM service_role;
    REVOKE ALL ON FUNCTION public.ledger_unlock(UUID, UUID, INTEGER, TEXT) FROM service_role;
END $$;
