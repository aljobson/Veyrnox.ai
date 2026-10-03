-- 0168: a disconnected account stops publishing, and a worker that lost its
-- claim cannot overwrite the result (docs/product/ISSUES.md S2, S3).
--
-- S2. disconnect_social_account (0154) set status='revoked' but kept both
-- encrypted tokens and left the account's queued targets alone, and
-- claim_due_social_post_targets (0161) joined accounts without checking
-- status — so a disconnected account kept publishing its scheduled posts.
-- update_social_account_token could also write a refreshed token back onto
-- a revoked account mid-sweep.
--
-- S3. complete_social_post_target and report_social_post_progress updated
-- whatever row matched p_target_id. A worker whose claim was taken over
-- after the 15-minute backstop could overwrite a published result, or flip
-- it back to pending and cause a second post.
--
-- Changes:
--   * social_accounts.access_token_enc may be NULL once revoked; disconnect
--     clears both tokens. Existing revoked rows are cleared here.
--   * social_fail_inactive_targets (internal): fails the open targets of a
--     non-active account — pending, submitted, and 'publishing' rows whose
--     claim is past the 15-minute backstop (a live worker keeps its claim
--     and reports normally) — and settles each affected post.
--   * disconnect_social_account runs it for the account at once; the claim
--     runs it for every account first, so nothing is left stranded.
--   * social_post_targets.claim_key: set on every claim and returned with
--     the row. Progress and completion apply only while the row is still
--     'publishing' and, when a key is passed, only for that key; otherwise
--     they return CLAIM_LOST and change nothing. The key parameter defaults
--     to NULL so a Worker deployed before this migration keeps working (it
--     then gets the state guard alone).
--   * update_social_account_token writes only to an active account.
--
-- Not covered: a post the platform already accepted from a worker whose
-- claim was then lost is not un-posted — the second worker's report is the
-- only one kept. Platform calls are not idempotent; this bounds the damage
-- to the record, it cannot recall the post.

-- ── columns ───────────────────────────────────────────────────────────────
ALTER TABLE public.social_post_targets ADD COLUMN IF NOT EXISTS claim_key UUID;

ALTER TABLE public.social_accounts ALTER COLUMN access_token_enc DROP NOT NULL;
UPDATE public.social_accounts
SET access_token_enc = NULL, refresh_token_enc = NULL
WHERE status = 'revoked' AND (access_token_enc IS NOT NULL OR refresh_token_enc IS NOT NULL);
ALTER TABLE public.social_accounts DROP CONSTRAINT IF EXISTS social_accounts_token_unless_revoked;
ALTER TABLE public.social_accounts ADD CONSTRAINT social_accounts_token_unless_revoked
    CHECK (status = 'revoked' OR access_token_enc IS NOT NULL);

-- ── settle_social_post (internal): the parent post's aggregate status ─────
-- The block complete_social_post_target (0161) ran inline, shared now.
CREATE OR REPLACE FUNCTION public.settle_social_post(p_post_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_pending   INTEGER;
    v_succeeded INTEGER;
BEGIN
    SELECT count(*) FILTER (WHERE publish_status IN ('pending', 'publishing', 'submitted')),
           count(*) FILTER (WHERE publish_status IN ('published', 'delivered'))
    INTO v_pending, v_succeeded
    FROM public.social_post_targets WHERE post_id = p_post_id;
    IF v_pending = 0 THEN
        UPDATE public.social_posts
        SET status = CASE WHEN v_succeeded > 0 THEN 'published' ELSE 'failed' END, updated_at = now()
        WHERE id = p_post_id AND status = 'scheduled';
    END IF;
END $$;

-- ── social_fail_inactive_targets (internal) ───────────────────────────────
-- p_account_id NULL means every non-active account.
CREATE OR REPLACE FUNCTION public.social_fail_inactive_targets(p_account_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_post  UUID;
    v_count INTEGER := 0;
BEGIN
    FOR v_post IN
        WITH failed AS (
            UPDATE public.social_post_targets t
            SET publish_status = 'failed', last_error = 'account_disconnected', claim_key = NULL
            FROM public.social_accounts a
            WHERE a.id = t.account_id
              AND a.status <> 'active'
              AND (p_account_id IS NULL OR a.id = p_account_id)
              AND (t.publish_status IN ('pending', 'submitted')
                   OR (t.publish_status = 'publishing' AND t.claimed_at <= now() - interval '15 minutes'))
            RETURNING t.post_id
        )
        SELECT DISTINCT post_id FROM failed
    LOOP
        PERFORM public.settle_social_post(v_post);
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END $$;

-- ── disconnect_social_account: 0154 body, plus token clearing and the
-- account's open targets failed at once.
CREATE OR REPLACE FUNCTION public.disconnect_social_account(p_auth_id TEXT, p_account_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user    UUID;
    v_account public.social_accounts%ROWTYPE;
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

    SELECT a.* INTO v_account FROM public.social_accounts a
    JOIN public.social_brands b ON b.id = a.brand_id
    WHERE a.id = p_account_id AND b.owner_user_id = v_user
    FOR UPDATE OF a;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_NOT_FOUND');
    END IF;

    UPDATE public.social_accounts
    SET status = 'revoked', disconnected_at = now(), access_token_enc = NULL, refresh_token_enc = NULL
    WHERE id = v_account.id;
    INSERT INTO public.social_account_actions (actor_id, brand_id, action, target_id, detail)
    VALUES (v_user, v_account.brand_id, 'disconnect', v_account.id, jsonb_build_object('network', v_account.network));
    PERFORM public.social_fail_inactive_targets(v_account.id);

    RETURN jsonb_build_object('ok', true);
END $$;

-- ── claim_due_social_post_targets: 0161 body, plus the inactive-account
-- sweep first, an active-account filter, and a claim_key per claim.
-- RETURNS TABLE gains a column, so DROP+CREATE.
DROP FUNCTION IF EXISTS public.claim_due_social_post_targets(INTEGER);
CREATE FUNCTION public.claim_due_social_post_targets(p_limit INTEGER)
RETURNS TABLE (
    target_id UUID, post_id UUID, account_id UUID, network TEXT,
    text_override TEXT, global_text TEXT, brand_id UUID, attempts INTEGER,
    access_token_enc BYTEA, refresh_token_enc BYTEA, token_expires_at TIMESTAMPTZ,
    external_account_id TEXT, media_type TEXT, r2_key TEXT,
    mime_type TEXT, size_bytes BIGINT, provider_state JSONB, claim_key UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
    PERFORM public.social_fail_inactive_targets(NULL);

    RETURN QUERY
    WITH due AS (
        SELECT t.id, t.publish_status AS prior_status
        FROM public.social_post_targets t
        JOIN public.social_posts p ON p.id = t.post_id
        JOIN public.social_accounts a ON a.id = t.account_id
        WHERE p.status = 'scheduled'
          AND p.scheduled_at <= now()
          AND a.status = 'active'
          AND (
              (t.publish_status = 'pending' AND (t.next_attempt_at IS NULL OR t.next_attempt_at <= now()))
              OR (t.publish_status = 'submitted' AND t.next_attempt_at IS NOT NULL AND t.next_attempt_at <= now())
              OR (t.publish_status = 'publishing' AND t.claimed_at <= now() - interval '15 minutes')
          )
        ORDER BY p.scheduled_at
        LIMIT least(greatest(COALESCE(p_limit, 1), 1), 50)
        FOR UPDATE OF t SKIP LOCKED
    ),
    claimed AS (
        UPDATE public.social_post_targets t
        SET publish_status = 'publishing',
            claimed_at = now(),
            claim_key = gen_random_uuid(),
            attempts = CASE WHEN due.prior_status = 'submitted' THEN t.attempts ELSE t.attempts + 1 END
        FROM due
        WHERE t.id = due.id
        RETURNING t.id, t.post_id, t.account_id, t.network, t.text_override, t.attempts, t.provider_state, t.claim_key
    )
    SELECT c.id, c.post_id, c.account_id, c.network, c.text_override, p.global_text, p.brand_id, c.attempts,
        a.access_token_enc, a.refresh_token_enc, a.token_expires_at, a.external_account_id,
        m.media_type, ast.r2_key, ast.mime_type, ast.size_bytes, c.provider_state, c.claim_key
    FROM claimed c
    JOIN public.social_posts p ON p.id = c.post_id
    JOIN public.social_accounts a ON a.id = c.account_id
    LEFT JOIN LATERAL (
        SELECT pm.media_type, pm.source_job_id FROM public.social_post_media pm
        WHERE pm.post_id = c.post_id ORDER BY pm."position" LIMIT 1
    ) m ON true
    LEFT JOIN LATERAL (
        SELECT x.r2_key, x.mime_type, x.size_bytes FROM public.assets x
        WHERE x.job_id = m.source_job_id ORDER BY x.created_at LIMIT 1
    ) ast ON true;
END $$;

-- ── report_social_post_progress: 0161 body behind the claim guard ────────
DROP FUNCTION IF EXISTS public.report_social_post_progress(UUID, JSONB, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.report_social_post_progress(UUID, JSONB, TIMESTAMPTZ, UUID);
CREATE FUNCTION public.report_social_post_progress(
    p_target_id UUID,
    p_provider_state JSONB,
    p_next_check_at TIMESTAMPTZ,
    p_claim_key UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_target public.social_post_targets%ROWTYPE;
BEGIN
    SELECT * INTO v_target FROM public.social_post_targets WHERE id = p_target_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'TARGET_NOT_FOUND');
    END IF;
    IF v_target.publish_status <> 'publishing'
       OR (p_claim_key IS NOT NULL AND v_target.claim_key IS DISTINCT FROM p_claim_key) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CLAIM_LOST');
    END IF;

    UPDATE public.social_post_targets
    SET publish_status = 'submitted',
        provider_state = COALESCE(p_provider_state, '{}'::jsonb),
        -- A NULL check time would strand the row: the claim only takes a
        -- 'submitted' row whose next_attempt_at is set.
        next_attempt_at = COALESCE(p_next_check_at, now()),
        last_error = NULL,
        claim_key = NULL
    WHERE id = p_target_id;
    RETURN jsonb_build_object('ok', true);
END $$;

-- ── complete_social_post_target: 0161 body behind the claim guard ────────
DROP FUNCTION IF EXISTS public.complete_social_post_target(UUID, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.complete_social_post_target(UUID, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN, UUID);
CREATE FUNCTION public.complete_social_post_target(
    p_target_id UUID,
    p_ok BOOLEAN,
    p_platform_post_id TEXT,
    p_platform_post_url TEXT,
    p_error TEXT,
    p_delivered BOOLEAN DEFAULT false,
    p_claim_key UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_target public.social_post_targets%ROWTYPE;
BEGIN
    SELECT * INTO v_target FROM public.social_post_targets WHERE id = p_target_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'TARGET_NOT_FOUND');
    END IF;
    IF v_target.publish_status <> 'publishing'
       OR (p_claim_key IS NOT NULL AND v_target.claim_key IS DISTINCT FROM p_claim_key) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CLAIM_LOST');
    END IF;

    IF p_ok THEN
        UPDATE public.social_post_targets
        SET publish_status = CASE WHEN p_delivered THEN 'delivered' ELSE 'published' END,
            published_at = now(),
            platform_post_id = p_platform_post_id, platform_post_url = p_platform_post_url, last_error = NULL,
            claim_key = NULL
        WHERE id = p_target_id;
    ELSIF v_target.attempts >= 3 THEN
        UPDATE public.social_post_targets
        SET publish_status = 'failed', last_error = left(COALESCE(p_error, 'unknown_error'), 500), claim_key = NULL
        WHERE id = p_target_id;
    ELSE
        UPDATE public.social_post_targets
        SET publish_status = 'pending', last_error = left(COALESCE(p_error, 'unknown_error'), 500),
            next_attempt_at = now() + make_interval(mins => least(5 * (1 << (v_target.attempts - 1)), 60)),
            claim_key = NULL
        WHERE id = p_target_id;
    END IF;

    PERFORM public.settle_social_post(v_target.post_id);
    RETURN jsonb_build_object('ok', true);
END $$;

-- ── update_social_account_token: never onto a non-active account ─────────
CREATE OR REPLACE FUNCTION public.update_social_account_token(
    p_account_id UUID,
    p_access_token_enc BYTEA,
    p_token_expires_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    UPDATE public.social_accounts
    SET access_token_enc = p_access_token_enc, token_expires_at = p_token_expires_at
    WHERE id = p_account_id AND status = 'active'
    RETURNING jsonb_build_object('ok', true);
$$;

-- ── Grants ────────────────────────────────────────────────────────────────
DO $$
DECLARE fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.disconnect_social_account(TEXT, UUID)',
        'public.claim_due_social_post_targets(INTEGER)',
        'public.report_social_post_progress(UUID, JSONB, TIMESTAMPTZ, UUID)',
        'public.complete_social_post_target(UUID, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN, UUID)',
        'public.update_social_account_token(UUID, BYTEA, TIMESTAMPTZ)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
    -- Internal: callable only by the definer functions above.
    FOREACH fn IN ARRAY ARRAY[
        'public.settle_social_post(UUID)',
        'public.social_fail_inactive_targets(UUID)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', fn);
    END LOOP;
END $$;
