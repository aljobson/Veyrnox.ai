-- Account deletion (ADR-0111, roadmap S1).
-- Applied name: 0347_account_deletion.
--
-- A signed-in person deletes their own account from the mobile app (App Store
-- 5.1.1(v), Play account-deletion policy). Deletion is a TOMBSTONE, not a
-- DELETE of public.users: the ledger, jobs, top-ups and the other money tables
-- reference users(id) ON DELETE RESTRICT and must outlive the person
-- (append-only ledger, refunds and disputes that arrive later, tax records).
-- What goes: everything that identifies the person or holds their content.
-- What stays: the money records, tied to a row with no email, no auth id and
-- no content. See docs/adr/0111-account-deletion.md.
--
-- Three calls, all service_role only:
--   prepare_account_deletion(auth_id)         what would be forfeited, what blocks
--                                             it, and a 15-minute single-use
--                                             confirmation token (stored hashed).
--   erase_account(auth_id, token)             the erasure, one transaction. The
--                                             Worker then removes the Supabase Auth
--                                             user and calls complete_account_deletion.
--   complete_account_deletion(auth_id, token) marks the Auth user as gone.
-- A replay of erase_account with the same token answers with the first result.
--
-- Refused (never erased): a Frozen account (a dispute cannot be escaped by
-- deleting), an account holding preserved evidence, a live subscription, a
-- generation in flight, a top-up in flight, Cinema content, tenant projects,
-- and a Publish brand that has other members.
--
-- Credits are NOT touched: no ledger row, no credit_balances write. The balance
-- stays on the tombstone, unspendable (nobody can sign in as it), so
-- balance = SUM(ledger) and every reconcile_*() still holds. The forfeited
-- amounts are recorded in account_deletions.
--
-- signup_grant is wrapped so an erased email gets no second Free Credit grant
-- (delete-and-resign-up is not a way to collect them again). Only a SHA-256 of
-- the lowercased email is kept for that. The original body is kept as
-- signup_grant_base and stays callable by service_role only.
--
-- Idempotent: IF NOT EXISTS, OR REPLACE, a guarded rename, REVOKE/GRANT re-run.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS public.account_deletions (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID        NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    -- The Supabase Auth id the person had. users.auth_id is rewritten on erasure;
    -- this keeps a replay (the access token lives up to an hour) answerable.
    auth_id             TEXT        NOT NULL,
    token_hash          BYTEA       NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    token_expires_at    TIMESTAMPTZ NOT NULL,
    state               TEXT        NOT NULL DEFAULT 'prepared'
                                    CHECK (state IN ('prepared', 'erased', 'completed')),
    email_sha256        BYTEA       NULL CHECK (email_sha256 IS NULL OR octet_length(email_sha256) = 32),
    forfeited_balance   INTEGER     NULL CHECK (forfeited_balance >= 0),
    forfeited_free      INTEGER     NULL CHECK (forfeited_free >= 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    erased_at           TIMESTAMPTZ NULL,
    completed_at        TIMESTAMPTZ NULL,
    CONSTRAINT account_deletions_state_times CHECK (
        (state = 'prepared' AND erased_at IS NULL AND completed_at IS NULL AND email_sha256 IS NULL)
        OR (state = 'erased' AND erased_at IS NOT NULL AND completed_at IS NULL AND email_sha256 IS NOT NULL)
        OR (state = 'completed' AND erased_at IS NOT NULL AND completed_at IS NOT NULL AND email_sha256 IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS account_deletions_user_idx ON public.account_deletions (user_id, created_at);
CREATE INDEX IF NOT EXISTS account_deletions_email_idx ON public.account_deletions (email_sha256) WHERE email_sha256 IS NOT NULL;
-- One erasure per user.
CREATE UNIQUE INDEX IF NOT EXISTS account_deletions_one_erasure
    ON public.account_deletions (user_id) WHERE state IN ('erased', 'completed');
ALTER TABLE public.account_deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletions FROM PUBLIC, anon, authenticated, service_role;

-- ── What blocks a deletion ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.account_deletion_blockers(p_user_id UUID, p_auth_id TEXT)
RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_blockers TEXT[] := ARRAY[]::TEXT[];
    v_auth     UUID;
BEGIN
    BEGIN
        v_auth := p_auth_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        v_auth := NULL;
    END;

    IF EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.frozen_at IS NOT NULL) THEN
        v_blockers := array_append(v_blockers, 'account_frozen'::text);
    END IF;

    IF EXISTS (SELECT 1 FROM public.evidence_holds h JOIN public.jobs j ON j.id = h.job_id
                WHERE j.user_id = p_user_id AND h.released_at IS NULL)
       OR EXISTS (SELECT 1 FROM public.assets a JOIN public.jobs j ON j.id = a.job_id
                   WHERE j.user_id = p_user_id AND a.held_at IS NOT NULL) THEN
        v_blockers := array_append(v_blockers, 'account_on_hold'::text);
    END IF;

    IF EXISTS (SELECT 1 FROM public.credit_subscriptions s
                WHERE s.user_id = p_user_id AND s.status IN ('active', 'past_due'))
       OR EXISTS (SELECT 1 FROM public.social_publish_subscriptions s
                   WHERE s.user_id = p_user_id AND s.status IN ('active', 'past_due')) THEN
        v_blockers := array_append(v_blockers, 'active_subscription'::text);
    END IF;

    IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.user_id = p_user_id
                AND j.state IN ('DEBITED', 'SUBMITTED', 'FAILOVER')) THEN
        v_blockers := array_append(v_blockers, 'generation_in_progress'::text);
    END IF;

    IF EXISTS (SELECT 1 FROM public.top_ups t WHERE t.user_id = p_user_id
                AND t.status = 'pending' AND t.created_at > now() - interval '2 hours') THEN
        v_blockers := array_append(v_blockers, 'top_up_in_progress'::text);
    END IF;

    IF EXISTS (SELECT 1 FROM public.cinema_content c WHERE c.creator_id = p_user_id)
       OR EXISTS (SELECT 1 FROM public.cinema_uploads c WHERE c.creator_id = p_user_id AND c.deleted_at IS NULL) THEN
        v_blockers := array_append(v_blockers, 'cinema_content_present'::text);
    END IF;

    IF v_auth IS NOT NULL AND EXISTS (SELECT 1 FROM public.projects p
                                       WHERE p.owner_id = v_auth AND p.deleted_at IS NULL) THEN
        v_blockers := array_append(v_blockers, 'projects_present'::text);
    END IF;

    IF EXISTS (SELECT 1 FROM public.social_brands b
                JOIN public.social_brand_members m ON m.brand_id = b.id
               WHERE b.owner_user_id = p_user_id AND m.user_id <> p_user_id) THEN
        v_blockers := array_append(v_blockers, 'publish_team_present'::text);
    END IF;

    RETURN v_blockers;
END $$;
REVOKE ALL ON FUNCTION private.account_deletion_blockers(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ── Step 1: what would happen, and the confirmation token ────────────────────
CREATE OR REPLACE FUNCTION public.prepare_account_deletion(p_auth_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user       public.users%ROWTYPE;
    v_bal        public.credit_balances%ROWTYPE;
    v_blockers   TEXT[];
    v_token      TEXT;
    v_expires    TIMESTAMPTZ := now() + interval '15 minutes';
    v_recent     INTEGER;
BEGIN
    SELECT * INTO v_user FROM public.users WHERE auth_id = p_auth_id FOR UPDATE;
    IF NOT FOUND OR v_user.deleted_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'account_not_found');
    END IF;

    -- A token is cheap to ask for, so ask a few times an hour, not hundreds.
    SELECT count(*) INTO v_recent FROM public.account_deletions d
     WHERE d.user_id = v_user.id AND d.created_at > now() - interval '1 hour';
    IF v_recent >= 5 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'rate_limited', 'retry_after_seconds', 3600);
    END IF;

    SELECT * INTO v_bal FROM public.credit_balances WHERE user_id = v_user.id;
    v_blockers := private.account_deletion_blockers(v_user.id, p_auth_id);

    IF cardinality(v_blockers) > 0 THEN
        RETURN jsonb_build_object(
            'ok', true, 'eligible', false, 'blockers', to_jsonb(v_blockers),
            'forfeit', jsonb_build_object('credits', COALESCE(v_bal.balance, 0), 'free_credits', COALESCE(v_bal.free_balance, 0)));
    END IF;

    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    INSERT INTO public.account_deletions (user_id, auth_id, token_hash, token_expires_at)
    VALUES (v_user.id, p_auth_id, sha256(convert_to(v_token, 'UTF8')), v_expires);

    RETURN jsonb_build_object(
        'ok', true, 'eligible', true, 'blockers', '[]'::jsonb,
        'forfeit', jsonb_build_object('credits', COALESCE(v_bal.balance, 0), 'free_credits', COALESCE(v_bal.free_balance, 0)),
        'confirmation_token', v_token, 'expires_at', v_expires);
END $$;
REVOKE ALL ON FUNCTION public.prepare_account_deletion(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_account_deletion(TEXT) TO service_role;

-- ── Step 2: the erasure ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.erase_account(p_auth_id TEXT, p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_del      public.account_deletions%ROWTYPE;
    v_user     public.users%ROWTYPE;
    v_bal      public.credit_balances%ROWTYPE;
    v_blockers TEXT[];
    v_auth     UUID;
    v_digest   BYTEA;
BEGIN
    IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'confirmation_invalid');
    END IF;

    SELECT * INTO v_del FROM public.account_deletions
     WHERE token_hash = sha256(convert_to(p_token, 'UTF8')) FOR UPDATE;
    IF NOT FOUND OR v_del.auth_id <> p_auth_id THEN
        RETURN jsonb_build_object('ok', false, 'error', 'confirmation_invalid');
    END IF;

    -- The same token again: the first answer, whatever stage it reached.
    IF v_del.state <> 'prepared' THEN
        RETURN jsonb_build_object('ok', true, 'replayed', true, 'state', v_del.state);
    END IF;
    IF v_del.token_expires_at < now() THEN
        RETURN jsonb_build_object('ok', false, 'error', 'confirmation_expired');
    END IF;

    SELECT * INTO v_user FROM public.users WHERE id = v_del.user_id FOR UPDATE;
    IF NOT FOUND OR v_user.deleted_at IS NOT NULL OR v_user.auth_id <> p_auth_id THEN
        RETURN jsonb_build_object('ok', false, 'error', 'confirmation_invalid');
    END IF;
    -- Same lock ledger_debit takes: no generation slips in while we erase.
    SELECT * INTO v_bal FROM public.credit_balances WHERE user_id = v_user.id FOR UPDATE;

    v_blockers := private.account_deletion_blockers(v_user.id, p_auth_id);
    IF cardinality(v_blockers) > 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'deletion_blocked', 'blockers', to_jsonb(v_blockers));
    END IF;

    v_auth := p_auth_id::uuid;
    v_digest := sha256(convert_to(lower(btrim(v_user.email)), 'UTF8'));

    BEGIN
        -- Stored files: queue the objects for the reaper, then drop the rows.
        INSERT INTO public.asset_reap_queue (r2_key)
        SELECT a.r2_key FROM public.assets a JOIN public.jobs j ON j.id = a.job_id
         WHERE j.user_id = v_user.id AND a.held_at IS NULL
        ON CONFLICT (r2_key) DO NOTHING;
        DELETE FROM public.assets a USING public.jobs j
         WHERE j.id = a.job_id AND j.user_id = v_user.id AND a.held_at IS NULL;

        INSERT INTO public.asset_reap_queue (r2_key)
        SELECT m.r2_key FROM public.film_library_masters m WHERE m.user_id = v_user.id
        ON CONFLICT (r2_key) DO NOTHING;
        DELETE FROM public.film_library_masters WHERE user_id = v_user.id;

        INSERT INTO public.asset_reap_queue (r2_key)
        SELECT r.r2_key FROM public.editor_library_renders r WHERE r.owner_id = v_auth
        ON CONFLICT (r2_key) DO NOTHING;
        DELETE FROM public.editor_library_renders WHERE owner_id = v_auth;

        INSERT INTO public.asset_reap_queue (r2_key)
        SELECT r.r2_key FROM public.upload_reservations r WHERE r.user_id = v_user.id
        ON CONFLICT (r2_key) DO NOTHING;
        DELETE FROM public.upload_reservations WHERE user_id = v_user.id;

        -- Publish. Tokens first: we stop holding the credential. Drafts and
        -- scheduled posts go; published history stays under an anonymised brand.
        UPDATE public.social_accounts sa
           SET status = 'revoked', disconnected_at = now(), access_token_enc = NULL, refresh_token_enc = NULL
          FROM public.social_brands b
         WHERE sa.brand_id = b.id AND b.owner_user_id = v_user.id AND sa.status <> 'revoked';
        UPDATE public.social_api_keys k SET revoked_at = now()
          FROM public.social_brands b
         WHERE k.brand_id = b.id AND b.owner_user_id = v_user.id AND k.revoked_at IS NULL;
        DELETE FROM public.social_webhook_endpoints w USING public.social_brands b
         WHERE w.brand_id = b.id AND b.owner_user_id = v_user.id;
        DELETE FROM public.social_posts p USING public.social_brands b
         WHERE p.brand_id = b.id AND b.owner_user_id = v_user.id AND p.status IN ('draft', 'scheduled', 'failed', 'canceled');
        INSERT INTO public.asset_reap_queue (r2_key)
        SELECT su.r2_key FROM public.social_uploads su
         WHERE su.user_id = v_user.id
           AND NOT EXISTS (SELECT 1 FROM public.social_post_media pm WHERE pm.source_upload_id = su.id)
        ON CONFLICT (r2_key) DO NOTHING;
        DELETE FROM public.social_uploads su
         WHERE su.user_id = v_user.id
           AND NOT EXISTS (SELECT 1 FROM public.social_post_media pm WHERE pm.source_upload_id = su.id);
        UPDATE public.social_brands SET label = 'Deleted brand' WHERE owner_user_id = v_user.id;

        -- Prompts and settings kept on the job row.
        UPDATE public.jobs SET inputs = '{}'::jsonb WHERE user_id = v_user.id AND inputs <> '{}'::jsonb;

        -- Personal content and profile.
        DELETE FROM public.chat_threads WHERE user_id = v_user.id;
        DELETE FROM public.chat_folders WHERE user_id = v_user.id;
        DELETE FROM public.chat_personas WHERE user_id = v_user.id;
        DELETE FROM public.chat_closed_sends WHERE user_id = v_user.id;
        DELETE FROM public.cinema_profiles WHERE user_id = v_user.id;
        DELETE FROM public.cinema_memberships WHERE user_id = v_user.id;
        DELETE FROM public.cinema_creator_applications WHERE user_id = v_user.id;
        DELETE FROM public.cinema_creator_follows WHERE user_id = v_user.id;
        DELETE FROM public.cinema_series_follows WHERE user_id = v_user.id;
        DELETE FROM public.cinema_saved_titles WHERE user_id = v_user.id;
        DELETE FROM public.cinema_retention_requests WHERE user_id = v_user.id;
        DELETE FROM public.referral_codes WHERE user_id = v_user.id;

        -- The tombstone: nothing that names the person, nothing a token can match.
        UPDATE public.users
           SET email = 'deleted-' || id::text || '@erased.invalid',
               auth_id = 'erased:' || id::text,
               deleted_at = now(),
               updated_at = now()
         WHERE id = v_user.id;
    EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN
        -- Something references the data in a way this migration did not list.
        -- The block's work is rolled back; nothing is half erased.
        RAISE WARNING 'erase_account blocked by a reference: %', SQLERRM;
        RETURN jsonb_build_object('ok', false, 'error', 'deletion_blocked', 'blockers', '[]'::jsonb);
    END;

    UPDATE public.account_deletions
       SET state = 'erased', erased_at = now(), email_sha256 = v_digest,
           forfeited_balance = COALESCE(v_bal.balance, 0), forfeited_free = COALESCE(v_bal.free_balance, 0)
     WHERE id = v_del.id;

    RETURN jsonb_build_object('ok', true, 'replayed', false, 'state', 'erased',
        'forfeited_credits', COALESCE(v_bal.balance, 0));
END $$;
REVOKE ALL ON FUNCTION public.erase_account(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erase_account(TEXT, TEXT) TO service_role;

-- ── Step 3: the Auth user is gone ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_account_deletion(p_auth_id TEXT, p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_del public.account_deletions%ROWTYPE;
BEGIN
    IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'confirmation_invalid');
    END IF;
    SELECT * INTO v_del FROM public.account_deletions
     WHERE token_hash = sha256(convert_to(p_token, 'UTF8')) FOR UPDATE;
    IF NOT FOUND OR v_del.auth_id <> p_auth_id OR v_del.state = 'prepared' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'confirmation_invalid');
    END IF;
    IF v_del.state = 'erased' THEN
        UPDATE public.account_deletions SET state = 'completed', completed_at = now() WHERE id = v_del.id;
    END IF;
    RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.complete_account_deletion(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_account_deletion(TEXT, TEXT) TO service_role;

-- ── No second Free Credit grant for an erased email ──────────────────────────
-- The grant itself stays where it is (signup_grant_base, the 0127 body, found
-- by its new name); the wrapper only decides whether to call it.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                    AND p.proname = 'signup_grant_base') THEN
        ALTER FUNCTION public.signup_grant(TEXT, TEXT) RENAME TO signup_grant_base;
    END IF;
END $$;
REVOKE ALL ON FUNCTION public.signup_grant_base(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.signup_grant_base(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.signup_grant(p_auth_id TEXT, p_email TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    IF EXISTS (SELECT 1 FROM public.account_deletions d
                WHERE d.email_sha256 = sha256(convert_to(lower(btrim(p_email)), 'UTF8'))) THEN
        -- Provision the shadow row so the new account works; grant nothing.
        RETURN public.provision_user(p_auth_id, p_email);
    END IF;
    v_user_id := public.signup_grant_base(p_auth_id, p_email);
    RETURN v_user_id;
END $$;
REVOKE ALL ON FUNCTION public.signup_grant(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.signup_grant(TEXT, TEXT) TO service_role;
