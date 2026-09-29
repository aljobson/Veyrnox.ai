-- 0161_social_publish_async_engine.sql — ADR-0061 Phase 5: the async
-- dispatch engine TikTok and YouTube publishing both need.
--
-- Every network dispatched so far (Instagram, LinkedIn, X) finishes inside
-- one sweep tick: submit, get an id back, done. TikTok's Content Posting
-- API and YouTube's resumable upload protocol don't fit that shape —
-- TikTok returns a publish_id that must be polled separately until it
-- settles, and a video upload can span many sweep ticks (YouTube's
-- resumable-upload session URI + last-confirmed byte offset is exactly the
-- state a stateless 5-minute cron needs to carry between ticks). A target
-- that's mid-flight now has somewhere to keep that provider-specific state
-- (provider_state) and a review status distinct from the sweep's usual
-- claim-then-terminate loop ('submitted').
--
-- TikTok's own app isn't audited yet, so an automated DIRECT_POST would
-- silently force every post to SELF_ONLY (private) — confirmed against
-- live TikTok docs. Rather than ship a "Publish" button that quietly makes
-- private posts, TikTok publishing here uses MEDIA_UPLOAD mode: content
-- lands as a draft in the creator's own TikTok inbox for them to finish.
-- That's a genuine, different outcome from "published" — 'delivered'
-- names it honestly instead of overloading 'published'.
--
-- Additive/idempotent except where Postgres requires DROP+CREATE (a
-- RETURNS TABLE column change can't go through CREATE OR REPLACE).

-- ── social_post_targets: provider-specific async state + the new status ──
ALTER TABLE public.social_post_targets ADD COLUMN IF NOT EXISTS provider_state JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.social_post_targets DROP CONSTRAINT IF EXISTS social_post_targets_publish_status_check;
ALTER TABLE public.social_post_targets ADD CONSTRAINT social_post_targets_publish_status_check
    CHECK (publish_status IN ('pending', 'publishing', 'submitted', 'delivered', 'published', 'failed'));

-- ── claim_due_social_post_targets: also claims 'submitted' targets whose
-- next check is due (a TikTok poll, or the next YouTube upload chunk),
-- and surfaces provider_state plus the refresh token/expiry so the sweep
-- can refresh a token that outlives one 5-minute tick (a multi-hour
-- YouTube upload can easily outlive Google's ~1h access token — nothing
-- dispatched before this needed that, since it always finished in one
-- tick). Claiming a 'submitted' row for routine continuation does NOT
-- bump attempts — only a genuinely stuck/died invocation (reclaimed past
-- the 15-minute 'publishing' backstop) or a fresh 'pending' dispatch does,
-- so a legitimate multi-tick upload never hits the 3-attempt failure cap
-- just for taking many ticks.
DROP FUNCTION IF EXISTS public.claim_due_social_post_targets(INTEGER);
CREATE FUNCTION public.claim_due_social_post_targets(p_limit INTEGER)
RETURNS TABLE (
    target_id UUID, post_id UUID, account_id UUID, network TEXT,
    text_override TEXT, global_text TEXT, brand_id UUID, attempts INTEGER,
    access_token_enc BYTEA, refresh_token_enc BYTEA, token_expires_at TIMESTAMPTZ,
    external_account_id TEXT, media_type TEXT, r2_key TEXT,
    mime_type TEXT, size_bytes BIGINT, provider_state JSONB
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH due AS (
        SELECT t.id, t.publish_status AS prior_status
        FROM public.social_post_targets t
        JOIN public.social_posts p ON p.id = t.post_id
        WHERE p.status = 'scheduled'
          AND p.scheduled_at <= now()
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
            attempts = CASE WHEN due.prior_status = 'submitted' THEN t.attempts ELSE t.attempts + 1 END
        FROM due
        WHERE t.id = due.id
        RETURNING t.id, t.post_id, t.account_id, t.network, t.text_override, t.attempts, t.provider_state
    )
    SELECT c.id, c.post_id, c.account_id, c.network, c.text_override, p.global_text, p.brand_id, c.attempts,
        a.access_token_enc, a.refresh_token_enc, a.token_expires_at, a.external_account_id,
        m.media_type, ast.r2_key, ast.mime_type, ast.size_bytes, c.provider_state
    FROM claimed c
    JOIN public.social_posts p ON p.id = c.post_id
    JOIN public.social_accounts a ON a.id = c.account_id
    LEFT JOIN LATERAL (
        SELECT media_type, source_job_id FROM public.social_post_media pm
        WHERE pm.post_id = c.post_id ORDER BY pm."position" LIMIT 1
    ) m ON true
    LEFT JOIN LATERAL (
        SELECT r2_key, mime_type, size_bytes FROM public.assets WHERE job_id = m.source_job_id ORDER BY created_at LIMIT 1
    ) ast ON true;
$$;

-- ── report_social_post_progress: the sweep's non-terminal report-back for
-- a target that isn't done yet (still polling, or more upload chunks to
-- go). Never touches attempts — see the claim function's own comment for
-- why. next_check_at becomes the row's next_attempt_at, reusing the same
-- column the pending-dispatch backoff already uses.
CREATE OR REPLACE FUNCTION public.report_social_post_progress(
    p_target_id UUID,
    p_provider_state JSONB,
    p_next_check_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.social_post_targets
    SET publish_status = 'submitted',
        provider_state = COALESCE(p_provider_state, '{}'::jsonb),
        next_attempt_at = p_next_check_at,
        last_error = NULL
    WHERE id = p_target_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'TARGET_NOT_FOUND');
    END IF;
    RETURN jsonb_build_object('ok', true);
END $$;

-- ── complete_social_post_target: p_delivered marks TikTok's MEDIA_UPLOAD
-- outcome ('delivered' — handed to the creator's inbox, not itself live)
-- as distinct from a confirmed-live 'published' post. Every existing
-- caller (Instagram/LinkedIn/X) omits it (defaults false) and is
-- unaffected. A delivered target counts as a success for the parent
-- post's own aggregate status, same as published — the sweep did its job
-- either way. Adding a parameter changes the signature, so this needs
-- DROP+CREATE, not CREATE OR REPLACE (which would leave the old 5-arg
-- form as a stray overload instead of replacing it). Both possible prior
-- shapes are dropped so this file stays idempotent on a second run: after
-- the first run has already installed the 6-arg form, a second run's own
-- "drop the 5-arg form" would be a no-op and collide with the 6-arg form
-- CREATE FUNCTION already installed.
DROP FUNCTION IF EXISTS public.complete_social_post_target(UUID, BOOLEAN, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.complete_social_post_target(UUID, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN);
CREATE FUNCTION public.complete_social_post_target(
    p_target_id UUID,
    p_ok BOOLEAN,
    p_platform_post_id TEXT,
    p_platform_post_url TEXT,
    p_error TEXT,
    p_delivered BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_target    public.social_post_targets%ROWTYPE;
    v_pending   INTEGER;
    v_succeeded INTEGER;
BEGIN
    SELECT * INTO v_target FROM public.social_post_targets WHERE id = p_target_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'TARGET_NOT_FOUND');
    END IF;

    IF p_ok THEN
        UPDATE public.social_post_targets
        SET publish_status = CASE WHEN p_delivered THEN 'delivered' ELSE 'published' END,
            published_at = now(),
            platform_post_id = p_platform_post_id, platform_post_url = p_platform_post_url, last_error = NULL
        WHERE id = p_target_id;
    ELSIF v_target.attempts >= 3 THEN
        UPDATE public.social_post_targets
        SET publish_status = 'failed', last_error = left(COALESCE(p_error, 'unknown_error'), 500)
        WHERE id = p_target_id;
    ELSE
        UPDATE public.social_post_targets
        SET publish_status = 'pending', last_error = left(COALESCE(p_error, 'unknown_error'), 500),
            next_attempt_at = now() + make_interval(mins => least(5 * (1 << (v_target.attempts - 1)), 60))
        WHERE id = p_target_id;
    END IF;

    SELECT count(*) FILTER (WHERE publish_status IN ('pending', 'publishing', 'submitted')),
           count(*) FILTER (WHERE publish_status IN ('published', 'delivered'))
    INTO v_pending, v_succeeded
    FROM public.social_post_targets WHERE post_id = v_target.post_id;
    IF v_pending = 0 THEN
        UPDATE public.social_posts
        SET status = CASE WHEN v_succeeded > 0 THEN 'published' ELSE 'failed' END, updated_at = now()
        WHERE id = v_target.post_id AND status = 'scheduled';
    END IF;

    RETURN jsonb_build_object('ok', true);
END $$;

-- ── update_social_account_token: the sweep persists a refreshed access
-- token mid-flight (a multi-hour YouTube upload can outlive the access
-- token it started with). Service-role only, like every sweep RPC — the
-- account_id it's given already passed through claim_due_social_post_targets's
-- own join, so no separate ownership check is needed here.
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
    WHERE id = p_account_id
    RETURNING jsonb_build_object('ok', true);
$$;

-- ── YouTube's own project quota caps videos.insert at 100/day (confirmed
-- against live Google docs, Sep 2026) — a single shared bucket across the
-- whole app, not per-account. One row per UTC day; consume_ before every
-- fresh upload start (not every chunk — only the initial insert is billed).
CREATE TABLE IF NOT EXISTS public.youtube_upload_daily_quota (
    quota_date DATE PRIMARY KEY,
    upload_count INTEGER NOT NULL DEFAULT 0 CHECK (upload_count >= 0)
);
ALTER TABLE public.youtube_upload_daily_quota ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.youtube_upload_daily_quota FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.youtube_upload_daily_quota FROM PUBLIC, anon, authenticated, service_role;

-- Conservative default below Google's documented 100/day — the same live
-- research that found this limit also found reports of some projects
-- being throttled well before 100 with no official explanation, so this
-- stays comfortably under the documented ceiling rather than chasing it.
CREATE OR REPLACE FUNCTION public.consume_youtube_upload_quota()
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    INSERT INTO public.youtube_upload_daily_quota AS q (quota_date, upload_count)
    VALUES (current_date, 1)
    ON CONFLICT (quota_date) DO UPDATE SET upload_count = q.upload_count + 1
    RETURNING upload_count INTO v_count;
    IF v_count > 80 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'QUOTA_EXHAUSTED');
    END IF;
    RETURN jsonb_build_object('ok', true, 'used', v_count, 'limit', 80);
END $$;

-- ── Grants ────────────────────────────────────────────────────────────────
DO $$
DECLARE fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.claim_due_social_post_targets(INTEGER)',
        'public.report_social_post_progress(UUID, JSONB, TIMESTAMPTZ)',
        'public.complete_social_post_target(UUID, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN)',
        'public.update_social_account_token(UUID, BYTEA, TIMESTAMPTZ)',
        'public.consume_youtube_upload_quota()'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END $$;
