-- 0147_cinema_publication.sql — ADR-0059: the publication slice.
--
-- A creator submits a finished title (a film, short, trailer, or a series
-- with every episode uploaded) with a versioned Rights Declaration. It waits
-- UNDER_REVIEW until a Cinema administrator approves it through the same
-- fresh-MFA gate as creator applications, at which point it and everything
-- under it become PUBLISHED and PUBLIC. Rejection returns it to DRAFT with a
-- note the creator can read. A creator may withdraw a title; an administrator
-- may suspend one. Both take it out of view and, if it had been published,
-- reverse its Unlocks through reverse_cinema_unlocks (ADR-0057 §5), so no
-- viewer pays for something they can no longer watch.
--
-- Additive and idempotent. Ships behind CINEMA_PUBLISHING_ENABLED (creator
-- and administrator paths) and CINEMA_VIEWING_ENABLED (public reads), both off.

-- ── cinema_content: the lifecycle it always meant to have ─────────────────
ALTER TABLE public.cinema_content DROP CONSTRAINT IF EXISTS cinema_content_lifecycle_status_check;
ALTER TABLE public.cinema_content ADD CONSTRAINT cinema_content_lifecycle_status_check
    CHECK (lifecycle_status IN ('DRAFT', 'UNDER_REVIEW', 'PUBLISHED', 'SUSPENDED'));
ALTER TABLE public.cinema_content ADD COLUMN IF NOT EXISTS rights_version TEXT NULL
    CHECK (rights_version IS NULL OR rights_version ~ '^[A-Za-z0-9._-]{1,32}$');
ALTER TABLE public.cinema_content ADD COLUMN IF NOT EXISTS rights_at    TIMESTAMPTZ NULL;
ALTER TABLE public.cinema_content ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ NULL;
ALTER TABLE public.cinema_content ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ NULL;
ALTER TABLE public.cinema_content ADD COLUMN IF NOT EXISTS closed_at    TIMESTAMPTZ NULL;
ALTER TABLE public.cinema_content ADD COLUMN IF NOT EXISTS review_note  TEXT NULL
    CHECK (review_note IS NULL OR length(review_note) <= 500);
CREATE INDEX IF NOT EXISTS cinema_content_published_idx
    ON public.cinema_content (published_at DESC, id DESC) WHERE lifecycle_status = 'PUBLISHED' AND parent_id IS NULL;

-- ── Submissions and their reviews ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cinema_submissions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    content_id      UUID        NOT NULL REFERENCES public.cinema_content(id) ON DELETE RESTRICT,
    creator_id      UUID        NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    idempotency_key UUID        NOT NULL,
    rights_version  TEXT        NOT NULL CHECK (rights_version ~ '^[A-Za-z0-9._-]{1,32}$'),
    status          TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at      TIMESTAMPTZ NULL,
    CONSTRAINT cinema_submissions_one_key UNIQUE (creator_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS cinema_submissions_one_pending ON public.cinema_submissions (content_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS cinema_submissions_pending_idx ON public.cinema_submissions (created_at, id) WHERE status = 'pending';
ALTER TABLE public.cinema_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_submissions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_submissions FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.cinema_submission_reviews (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id   UUID        NOT NULL UNIQUE,
    actor_id        UUID        NOT NULL,
    idempotency_key UUID        NOT NULL,
    decision        TEXT        NOT NULL CHECK (decision IN ('approved', 'rejected')),
    reason          TEXT        NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
    creator_note    TEXT        NULL CHECK (creator_note IS NULL OR length(creator_note) <= 500),
    request_id      UUID        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (actor_id, idempotency_key)
);
ALTER TABLE public.cinema_submission_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_submission_reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_submission_reviews FROM PUBLIC, anon, authenticated, service_role;

-- Withdrawals and suspensions, append-only, with the Unlock reversal they caused.
CREATE TABLE IF NOT EXISTS public.cinema_moderation_actions (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    content_id       UUID        NOT NULL REFERENCES public.cinema_content(id) ON DELETE RESTRICT,
    action           TEXT        NOT NULL CHECK (action IN ('withdraw', 'suspend')),
    actor_id         UUID        NOT NULL,
    actor            TEXT        NOT NULL CHECK (length(btrim(actor)) BETWEEN 1 AND 120),
    idempotency_key  UUID        NOT NULL,
    reason           TEXT        NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
    request_id       UUID        NULL,
    was_published    BOOLEAN     NOT NULL,
    unlocks_reversed INTEGER     NOT NULL CHECK (unlocks_reversed >= 0),
    credits_returned INTEGER     NOT NULL CHECK (credits_returned >= 0),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (actor_id, idempotency_key)
);
ALTER TABLE public.cinema_moderation_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_moderation_actions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_moderation_actions FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cinema_publication_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;
DROP TRIGGER IF EXISTS cinema_submission_reviews_append_only ON public.cinema_submission_reviews;
CREATE TRIGGER cinema_submission_reviews_append_only
    BEFORE UPDATE OR DELETE ON public.cinema_submission_reviews
    FOR EACH ROW EXECUTE FUNCTION public.cinema_publication_append_only();
DROP TRIGGER IF EXISTS cinema_moderation_actions_append_only ON public.cinema_moderation_actions;
CREATE TRIGGER cinema_moderation_actions_append_only
    BEFORE UPDATE OR DELETE ON public.cinema_moderation_actions
    FOR EACH ROW EXECUTE FUNCTION public.cinema_publication_append_only();

-- ── Internal helpers ──────────────────────────────────────────────────────
-- Every row of a title: the root, its seasons and their episodes.
CREATE OR REPLACE FUNCTION public.cinema_title_rows(p_root UUID)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p_root
    UNION ALL
    SELECT s.id FROM public.cinema_content s WHERE s.parent_id = p_root
    UNION ALL
    SELECT e.id FROM public.cinema_content e JOIN public.cinema_content s ON s.id = e.parent_id WHERE s.parent_id = p_root;
$$;

-- Take a title out of view and give its viewers their credits back. Runs
-- inside withdraw and suspend; the caller has already locked the root.
CREATE OR REPLACE FUNCTION public.cinema_close_title(p_root UUID, p_status TEXT, p_actor TEXT, p_reason TEXT, p_reverse BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id      UUID;
    v_type    TEXT;
    v_r       JSONB;
    v_count   INTEGER := 0;
    v_credits INTEGER := 0;
BEGIN
    UPDATE public.cinema_content SET lifecycle_status = p_status, visibility = 'PRIVATE',
        closed_at = CASE WHEN p_status = 'SUSPENDED' THEN now() ELSE closed_at END, updated_at = now()
    WHERE id IN (SELECT public.cinema_title_rows(p_root));
    IF p_reverse THEN
        FOR v_id, v_type IN SELECT c.id, c.content_type FROM public.cinema_content c
            WHERE c.id IN (SELECT public.cinema_title_rows(p_root)) AND c.content_type IN ('FILM', 'SHORT', 'TRAILER', 'EPISODE')
        LOOP
            v_r := public.reverse_cinema_unlocks(v_id, p_actor, p_reason);
            v_count := v_count + COALESCE((v_r->>'unlocks_reversed')::int, 0);
            v_credits := v_credits + COALESCE((v_r->>'credits_returned')::int, 0);
        END LOOP;
    END IF;
    RETURN jsonb_build_object('unlocks_reversed', v_count, 'credits_returned', v_credits);
END $$;

-- ── submit_cinema_title: creator asks for review ──────────────────────────
-- {id, content_id, status:'pending', idempotent} or {error} with
-- creator_required, account_not_active, invalid_submission, content_not_found,
-- already_submitted, already_published, suspended, no_episodes,
-- video_not_ready (+missing), idempotency_conflict.
CREATE OR REPLACE FUNCTION public.submit_cinema_title(p_auth_id TEXT, p_idempotency_key UUID, p_content_id UUID, p_rights_version TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user    UUID;
    v_member  public.cinema_memberships%ROWTYPE;
    v_root    public.cinema_content%ROWTYPE;
    v_old     public.cinema_submissions%ROWTYPE;
    v_eps     INTEGER;
    v_missing INTEGER;
    v_id      UUID;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('error', 'creator_required');
    END IF;
    SELECT u.id INTO v_user FROM public.users u JOIN auth.users a ON a.id = p_auth_id::UUID WHERE u.auth_id = p_auth_id;
    SELECT * INTO v_member FROM public.cinema_memberships WHERE user_id = v_user FOR UPDATE;
    IF NOT FOUND OR v_member.role <> 'creator' THEN RETURN jsonb_build_object('error', 'creator_required'); END IF;
    IF v_member.account_status <> 'active' THEN RETURN jsonb_build_object('error', 'account_not_active'); END IF;
    IF p_idempotency_key IS NULL OR p_content_id IS NULL OR p_rights_version IS NULL OR p_rights_version !~ '^[A-Za-z0-9._-]{1,32}$' THEN
        RETURN jsonb_build_object('error', 'invalid_submission');
    END IF;

    SELECT * INTO v_old FROM public.cinema_submissions WHERE creator_id = v_user AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_old.content_id <> p_content_id OR v_old.rights_version <> p_rights_version THEN
            RETURN jsonb_build_object('error', 'idempotency_conflict');
        END IF;
        RETURN jsonb_build_object('id', v_old.id, 'content_id', v_old.content_id, 'status', v_old.status, 'idempotent', true);
    END IF;

    SELECT * INTO v_root FROM public.cinema_content WHERE id = p_content_id AND creator_id = v_user FOR UPDATE;
    IF NOT FOUND OR v_root.parent_id IS NOT NULL OR v_root.content_type NOT IN ('FILM', 'SHORT', 'TRAILER', 'SERIES') THEN
        RETURN jsonb_build_object('error', 'content_not_found');
    END IF;
    IF v_root.lifecycle_status = 'UNDER_REVIEW' THEN RETURN jsonb_build_object('error', 'already_submitted'); END IF;
    IF v_root.lifecycle_status = 'PUBLISHED' THEN RETURN jsonb_build_object('error', 'already_published'); END IF;
    IF v_root.lifecycle_status = 'SUSPENDED' THEN RETURN jsonb_build_object('error', 'suspended'); END IF;

    -- Every playable item must have a finished upload before anyone reviews it.
    IF v_root.content_type = 'SERIES' THEN
        SELECT count(*), count(*) FILTER (WHERE NOT EXISTS (
            SELECT 1 FROM public.cinema_uploads x WHERE x.content_id = e.id AND x.state = 'ready'))
        INTO v_eps, v_missing
        FROM public.cinema_content e JOIN public.cinema_content s ON s.id = e.parent_id
        WHERE s.parent_id = v_root.id AND e.content_type = 'EPISODE';
        IF v_eps = 0 THEN RETURN jsonb_build_object('error', 'no_episodes'); END IF;
        IF v_missing > 0 THEN RETURN jsonb_build_object('error', 'video_not_ready', 'missing', v_missing); END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM public.cinema_uploads x WHERE x.content_id = v_root.id AND x.state = 'ready') THEN
        RETURN jsonb_build_object('error', 'video_not_ready', 'missing', 1);
    END IF;

    UPDATE public.cinema_content SET lifecycle_status = 'UNDER_REVIEW', visibility = 'PRIVATE',
        rights_version = p_rights_version, rights_at = now(), submitted_at = now(), review_note = NULL, updated_at = now()
    WHERE id IN (SELECT public.cinema_title_rows(v_root.id));

    INSERT INTO public.cinema_submissions (content_id, creator_id, idempotency_key, rights_version)
    VALUES (v_root.id, v_user, p_idempotency_key, p_rights_version)
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('id', v_id, 'content_id', v_root.id, 'status', 'pending', 'idempotent', false);
END $$;

-- ── withdraw_cinema_title: creator takes a title back ─────────────────────
-- A title under review returns to DRAFT; a published title returns to DRAFT
-- and every Unlock of it from the last 30 days is reversed. {content_id,
-- status:'DRAFT', unlocks_reversed, credits_returned, idempotent} or {error}
-- with creator_required, account_not_active, invalid_withdrawal,
-- content_not_found, not_withdrawable, idempotency_conflict.
CREATE OR REPLACE FUNCTION public.withdraw_cinema_title(p_auth_id TEXT, p_idempotency_key UUID, p_content_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user     UUID;
    v_member   public.cinema_memberships%ROWTYPE;
    v_profile  public.cinema_profiles%ROWTYPE;
    v_root     public.cinema_content%ROWTYPE;
    v_old      public.cinema_moderation_actions%ROWTYPE;
    v_closed   JSONB;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('error', 'creator_required');
    END IF;
    SELECT u.id INTO v_user FROM public.users u JOIN auth.users a ON a.id = p_auth_id::UUID WHERE u.auth_id = p_auth_id;
    SELECT * INTO v_member FROM public.cinema_memberships WHERE user_id = v_user FOR UPDATE;
    IF NOT FOUND OR v_member.role <> 'creator' THEN RETURN jsonb_build_object('error', 'creator_required'); END IF;
    IF v_member.account_status <> 'active' THEN RETURN jsonb_build_object('error', 'account_not_active'); END IF;
    IF p_idempotency_key IS NULL OR p_content_id IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
        RETURN jsonb_build_object('error', 'invalid_withdrawal');
    END IF;
    SELECT * INTO v_old FROM public.cinema_moderation_actions WHERE actor_id = v_user AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_old.content_id <> p_content_id THEN RETURN jsonb_build_object('error', 'idempotency_conflict'); END IF;
        RETURN jsonb_build_object('content_id', v_old.content_id, 'status', 'DRAFT', 'unlocks_reversed', v_old.unlocks_reversed,
                                  'credits_returned', v_old.credits_returned, 'idempotent', true);
    END IF;

    SELECT * INTO v_root FROM public.cinema_content WHERE id = p_content_id AND creator_id = v_user FOR UPDATE;
    IF NOT FOUND OR v_root.parent_id IS NOT NULL THEN RETURN jsonb_build_object('error', 'content_not_found'); END IF;
    IF v_root.lifecycle_status NOT IN ('UNDER_REVIEW', 'PUBLISHED') THEN RETURN jsonb_build_object('error', 'not_withdrawable'); END IF;
    SELECT * INTO v_profile FROM public.cinema_profiles WHERE user_id = v_user;

    UPDATE public.cinema_submissions SET status = 'withdrawn', decided_at = now()
    WHERE content_id = v_root.id AND status = 'pending';
    v_closed := public.cinema_close_title(v_root.id, 'DRAFT', 'creator:' || COALESCE(v_profile.username, v_user::text),
                                          'creator withdrawal: ' || btrim(p_reason), v_root.lifecycle_status = 'PUBLISHED');

    INSERT INTO public.cinema_moderation_actions (content_id, action, actor_id, actor, idempotency_key, reason, was_published, unlocks_reversed, credits_returned)
    VALUES (v_root.id, 'withdraw', v_user, 'creator:' || COALESCE(v_profile.username, v_user::text), p_idempotency_key, btrim(p_reason),
            v_root.lifecycle_status = 'PUBLISHED', (v_closed->>'unlocks_reversed')::int, (v_closed->>'credits_returned')::int);
    RETURN jsonb_build_object('content_id', v_root.id, 'status', 'DRAFT', 'idempotent', false) || v_closed;
END $$;

-- ── list_cinema_submissions: the review queue ─────────────────────────────
CREATE OR REPLACE FUNCTION public.list_cinema_submissions(p_auth_id TEXT, p_aal TEXT, p_mfa_at BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_aal IS DISTINCT FROM 'aal2' OR p_mfa_at IS NULL OR p_mfa_at < extract(epoch FROM now()) - 300 OR p_mfa_at > extract(epoch FROM now()) + 5
       OR NOT EXISTS (SELECT 1 FROM public.users u JOIN public.cinema_memberships m ON m.user_id = u.id
                      WHERE u.auth_id = p_auth_id AND m.role = 'administrator' AND m.account_status = 'active') THEN
        RETURN jsonb_build_object('error', 'not_authorized');
    END IF;
    RETURN jsonb_build_object('submissions', COALESCE((SELECT jsonb_agg(row_to_json(s)) FROM (
        SELECT sub.id, sub.content_id, sub.rights_version, sub.created_at,
               c.title, c.content_type, c.synopsis, c.language, c.ai_disclosures,
               p.username, p.display_name,
               (SELECT count(*)::int FROM public.cinema_content e JOIN public.cinema_content se ON se.id = e.parent_id
                WHERE se.parent_id = c.id AND e.content_type = 'EPISODE') AS episode_count,
               (SELECT COALESCE(sum(x.duration_seconds), 0)::int FROM public.cinema_uploads x
                WHERE x.state = 'ready' AND x.content_id IN (SELECT public.cinema_title_rows(c.id))) AS duration_seconds,
               (SELECT count(*)::int FROM public.cinema_moderation_actions a WHERE a.content_id = c.id) AS prior_actions
        FROM public.cinema_submissions sub
        JOIN public.cinema_content c ON c.id = sub.content_id
        JOIN public.cinema_profiles p ON p.user_id = sub.creator_id
        JOIN public.cinema_memberships m ON m.user_id = sub.creator_id
        WHERE sub.status = 'pending' AND m.account_status = 'active'
        ORDER BY sub.created_at, sub.id LIMIT 50
    ) s), '[]'::jsonb));
END $$;

-- ── review_cinema_submission: approve publishes, reject returns to draft ──
CREATE OR REPLACE FUNCTION public.review_cinema_submission(
    p_auth_id TEXT, p_aal TEXT, p_mfa_at BIGINT, p_idempotency_key UUID, p_submission_id UUID,
    p_decision TEXT, p_reason TEXT, p_creator_note TEXT, p_request_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor  UUID;
    v_sub    public.cinema_submissions%ROWTYPE;
    v_review public.cinema_submission_reviews%ROWTYPE;
    v_member public.cinema_memberships%ROWTYPE;
BEGIN
    IF p_aal IS DISTINCT FROM 'aal2' OR p_mfa_at IS NULL OR p_mfa_at < extract(epoch FROM now()) - 300 OR p_mfa_at > extract(epoch FROM now()) + 5 THEN
        RETURN jsonb_build_object('error', 'not_authorized');
    END IF;
    SELECT u.id INTO v_actor FROM public.users u JOIN public.cinema_memberships m ON m.user_id = u.id
    WHERE u.auth_id = p_auth_id AND m.role = 'administrator' AND m.account_status = 'active' FOR UPDATE OF m;
    IF v_actor IS NULL THEN RETURN jsonb_build_object('error', 'not_authorized'); END IF;
    IF p_request_id IS NULL OR p_idempotency_key IS NULL OR p_submission_id IS NULL OR p_decision IS NULL OR p_decision NOT IN ('approved', 'rejected')
       OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500
       OR (p_creator_note IS NOT NULL AND length(p_creator_note) > 500) THEN
        RETURN jsonb_build_object('error', 'invalid_review');
    END IF;
    SELECT * INTO v_review FROM public.cinema_submission_reviews WHERE actor_id = v_actor AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_review.submission_id = p_submission_id AND v_review.decision = p_decision AND v_review.reason = btrim(p_reason) THEN
            RETURN jsonb_build_object('id', p_submission_id, 'status', v_review.decision, 'idempotent', true);
        END IF;
        RETURN jsonb_build_object('error', 'idempotency_conflict');
    END IF;
    SELECT * INTO v_sub FROM public.cinema_submissions WHERE id = p_submission_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'submission_not_found'); END IF;
    IF v_sub.creator_id = v_actor THEN RETURN jsonb_build_object('error', 'self_review_forbidden'); END IF;
    IF v_sub.status <> 'pending' THEN RETURN jsonb_build_object('error', 'already_reviewed'); END IF;
    SELECT * INTO v_member FROM public.cinema_memberships WHERE user_id = v_sub.creator_id FOR UPDATE;
    IF NOT FOUND OR v_member.account_status <> 'active' THEN RETURN jsonb_build_object('error', 'account_not_active'); END IF;
    PERFORM 1 FROM public.cinema_content WHERE id = v_sub.content_id FOR UPDATE;

    IF p_decision = 'approved' THEN
        UPDATE public.cinema_content SET lifecycle_status = 'PUBLISHED', visibility = 'PUBLIC', published_at = now(),
            closed_at = NULL, review_note = NULL, updated_at = now()
        WHERE id IN (SELECT public.cinema_title_rows(v_sub.content_id));
    ELSE
        UPDATE public.cinema_content SET lifecycle_status = 'DRAFT', visibility = 'PRIVATE',
            review_note = CASE WHEN id = v_sub.content_id THEN NULLIF(btrim(COALESCE(p_creator_note, '')), '') ELSE review_note END,
            updated_at = now()
        WHERE id IN (SELECT public.cinema_title_rows(v_sub.content_id));
    END IF;
    UPDATE public.cinema_submissions SET status = p_decision, decided_at = now() WHERE id = p_submission_id;
    INSERT INTO public.cinema_submission_reviews (submission_id, actor_id, idempotency_key, decision, reason, creator_note, request_id)
    VALUES (p_submission_id, v_actor, p_idempotency_key, p_decision, btrim(p_reason), NULLIF(btrim(COALESCE(p_creator_note, '')), ''), p_request_id);
    RETURN jsonb_build_object('id', p_submission_id, 'content_id', v_sub.content_id, 'status', p_decision, 'idempotent', false);
END $$;

-- ── suspend_cinema_title: administrator takedown ──────────────────────────
-- SUSPENDED is terminal for the creator: no edit, no resubmission. Every
-- Unlock of the title from the last 30 days is reversed.
CREATE OR REPLACE FUNCTION public.suspend_cinema_title(
    p_auth_id TEXT, p_aal TEXT, p_mfa_at BIGINT, p_idempotency_key UUID, p_content_id UUID, p_reason TEXT, p_request_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor   UUID;
    v_name    TEXT;
    v_root    public.cinema_content%ROWTYPE;
    v_old     public.cinema_moderation_actions%ROWTYPE;
    v_closed  JSONB;
BEGIN
    IF p_aal IS DISTINCT FROM 'aal2' OR p_mfa_at IS NULL OR p_mfa_at < extract(epoch FROM now()) - 300 OR p_mfa_at > extract(epoch FROM now()) + 5 THEN
        RETURN jsonb_build_object('error', 'not_authorized');
    END IF;
    SELECT u.id, p.username INTO v_actor, v_name FROM public.users u JOIN public.cinema_memberships m ON m.user_id = u.id
    LEFT JOIN public.cinema_profiles p ON p.user_id = u.id
    WHERE u.auth_id = p_auth_id AND m.role = 'administrator' AND m.account_status = 'active' FOR UPDATE OF m;
    IF v_actor IS NULL THEN RETURN jsonb_build_object('error', 'not_authorized'); END IF;
    IF p_request_id IS NULL OR p_idempotency_key IS NULL OR p_content_id IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
        RETURN jsonb_build_object('error', 'invalid_suspension');
    END IF;
    SELECT * INTO v_old FROM public.cinema_moderation_actions WHERE actor_id = v_actor AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_old.content_id <> p_content_id THEN RETURN jsonb_build_object('error', 'idempotency_conflict'); END IF;
        RETURN jsonb_build_object('content_id', v_old.content_id, 'status', 'SUSPENDED', 'unlocks_reversed', v_old.unlocks_reversed,
                                  'credits_returned', v_old.credits_returned, 'idempotent', true);
    END IF;
    SELECT * INTO v_root FROM public.cinema_content WHERE id = p_content_id FOR UPDATE;
    IF NOT FOUND OR v_root.parent_id IS NOT NULL THEN RETURN jsonb_build_object('error', 'content_not_found'); END IF;
    IF v_root.lifecycle_status = 'SUSPENDED' THEN RETURN jsonb_build_object('error', 'already_suspended'); END IF;

    UPDATE public.cinema_submissions SET status = 'withdrawn', decided_at = now() WHERE content_id = v_root.id AND status = 'pending';
    v_closed := public.cinema_close_title(v_root.id, 'SUSPENDED', 'operator:' || COALESCE(v_name, v_actor::text),
                                          'suspension: ' || btrim(p_reason), v_root.lifecycle_status = 'PUBLISHED');
    INSERT INTO public.cinema_moderation_actions (content_id, action, actor_id, actor, idempotency_key, reason, request_id, was_published, unlocks_reversed, credits_returned)
    VALUES (v_root.id, 'suspend', v_actor, 'operator:' || COALESCE(v_name, v_actor::text), p_idempotency_key, btrim(p_reason), p_request_id,
            v_root.lifecycle_status = 'PUBLISHED', (v_closed->>'unlocks_reversed')::int, (v_closed->>'credits_returned')::int);
    RETURN jsonb_build_object('content_id', v_root.id, 'status', 'SUSPENDED', 'idempotent', false) || v_closed;
END $$;

-- ── Public reads ──────────────────────────────────────────────────────────
-- The catalogue: published titles, newest first, with the creator's public
-- name. Nothing private, nothing about the viewer.
CREATE OR REPLACE FUNCTION public.list_public_cinema_titles(p_limit INTEGER, p_before TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
        SELECT c.id, c.content_type, c.title, c.synopsis, c.language, c.ai_disclosures, c.published_at,
               p.username, p.display_name,
               (SELECT count(*)::int FROM public.cinema_content e JOIN public.cinema_content s ON s.id = e.parent_id
                WHERE s.parent_id = c.id AND e.content_type = 'EPISODE' AND e.lifecycle_status = 'PUBLISHED') AS episode_count,
               (SELECT x.duration_seconds::int FROM public.cinema_uploads x WHERE x.content_id = c.id AND x.state = 'ready') AS duration_seconds
        FROM public.cinema_content c
        JOIN public.cinema_profiles p ON p.user_id = c.creator_id
        JOIN public.cinema_memberships m ON m.user_id = c.creator_id
        WHERE c.parent_id IS NULL AND c.lifecycle_status = 'PUBLISHED' AND c.visibility = 'PUBLIC'
          AND c.published_at IS NOT NULL AND m.account_status = 'active'
          AND (p_before IS NULL OR c.published_at < p_before)
        ORDER BY c.published_at DESC, c.id DESC
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 50)
    ) t;
$$;

-- One title with its seasons and episodes, and for each playable item what
-- this viewer may do with it. p_auth_id may be NULL for an anonymous viewer.
CREATE OR REPLACE FUNCTION public.read_public_cinema_title(p_auth_id TEXT, p_content_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_root public.cinema_content%ROWTYPE;
    v_head JSONB;
BEGIN
    SELECT * INTO v_root FROM public.cinema_content c WHERE c.id = p_content_id AND c.parent_id IS NULL
      AND c.lifecycle_status = 'PUBLISHED' AND c.visibility = 'PUBLIC'
      AND EXISTS (SELECT 1 FROM public.cinema_memberships m WHERE m.user_id = c.creator_id AND m.account_status = 'active');
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'title_not_found'); END IF;
    SELECT jsonb_build_object('id', v_root.id, 'content_type', v_root.content_type, 'title', v_root.title, 'synopsis', v_root.synopsis,
        'language', v_root.language, 'ai_disclosures', to_jsonb(v_root.ai_disclosures), 'published_at', v_root.published_at,
        'creator', jsonb_build_object('username', p.username, 'display_name', p.display_name))
    INTO v_head FROM public.cinema_profiles p WHERE p.user_id = v_root.creator_id;
    IF v_root.content_type = 'SERIES' THEN
        RETURN v_head || jsonb_build_object('seasons', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', s.id, 'position', s.position, 'title', s.title, 'episodes', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('id', e.id, 'position', e.position, 'title', e.title, 'synopsis', e.synopsis,
                    'duration_seconds', (SELECT x.duration_seconds::int FROM public.cinema_uploads x WHERE x.content_id = e.id AND x.state = 'ready'))
                    || public.cinema_entitlement(p_auth_id, e.id) ORDER BY e.position)
                FROM public.cinema_content e WHERE e.parent_id = s.id AND e.content_type = 'EPISODE' AND e.lifecycle_status = 'PUBLISHED'), '[]'::jsonb))
                ORDER BY s.position)
            FROM public.cinema_content s WHERE s.parent_id = v_root.id AND s.content_type = 'SEASON' AND s.lifecycle_status = 'PUBLISHED'), '[]'::jsonb));
    END IF;
    RETURN v_head || jsonb_build_object('duration_seconds',
        (SELECT x.duration_seconds::int FROM public.cinema_uploads x WHERE x.content_id = v_root.id AND x.state = 'ready'))
        || public.cinema_entitlement(p_auth_id, v_root.id);
END $$;

-- The creator's own titles now carry their publication state and note.
CREATE OR REPLACE FUNCTION public.list_own_cinema_content(p_auth_id TEXT, p_parent_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_member public.cinema_memberships%ROWTYPE;
BEGIN
  IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN jsonb_build_object('error','creator_required'); END IF;
  SELECT u.id INTO v_user FROM public.users u JOIN auth.users a ON a.id=p_auth_id::UUID WHERE u.auth_id=p_auth_id;
  SELECT * INTO v_member FROM public.cinema_memberships WHERE user_id=v_user;
  IF NOT FOUND OR v_member.role<>'creator' THEN RETURN jsonb_build_object('error','creator_required'); END IF;
  IF v_member.account_status<>'active' THEN RETURN jsonb_build_object('error','account_not_active'); END IF;
  IF p_parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.cinema_content WHERE id=p_parent_id AND creator_id=v_user) THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
  RETURN jsonb_build_object('content',coalesce((SELECT jsonb_agg(row_to_json(c) ORDER BY c.position NULLS FIRST,c.created_at,c.id) FROM (
    SELECT id,content_type,parent_id,position,title,synopsis,language,ai_disclosures,lifecycle_status,visibility,revision,created_at,updated_at,
           submitted_at,published_at,closed_at,review_note,rights_version,
           EXISTS(SELECT 1 FROM public.cinema_uploads x WHERE x.content_id=cinema_content.id AND x.state='ready') AS video_ready
    FROM public.cinema_content WHERE creator_id=v_user AND parent_id IS NOT DISTINCT FROM p_parent_id) c),'[]'::jsonb));
END $$;

-- ── Grants ────────────────────────────────────────────────────────────────
DO $$
DECLARE fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.cinema_title_rows(UUID)',
        'public.cinema_close_title(UUID, TEXT, TEXT, TEXT, BOOLEAN)',
        'public.cinema_publication_append_only()',
        'public.submit_cinema_title(TEXT, UUID, UUID, TEXT)',
        'public.withdraw_cinema_title(TEXT, UUID, UUID, TEXT)',
        'public.list_cinema_submissions(TEXT, TEXT, BIGINT)',
        'public.review_cinema_submission(TEXT, TEXT, BIGINT, UUID, UUID, TEXT, TEXT, TEXT, UUID)',
        'public.suspend_cinema_title(TEXT, TEXT, BIGINT, UUID, UUID, TEXT, UUID)',
        'public.list_public_cinema_titles(INTEGER, TIMESTAMPTZ)',
        'public.read_public_cinema_title(TEXT, UUID)',
        'public.list_own_cinema_content(TEXT, UUID)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    END LOOP;
    FOREACH fn IN ARRAY ARRAY[
        'public.submit_cinema_title(TEXT, UUID, UUID, TEXT)',
        'public.withdraw_cinema_title(TEXT, UUID, UUID, TEXT)',
        'public.list_cinema_submissions(TEXT, TEXT, BIGINT)',
        'public.review_cinema_submission(TEXT, TEXT, BIGINT, UUID, UUID, TEXT, TEXT, TEXT, UUID)',
        'public.suspend_cinema_title(TEXT, TEXT, BIGINT, UUID, UUID, TEXT, UUID)',
        'public.list_public_cinema_titles(INTEGER, TIMESTAMPTZ)',
        'public.read_public_cinema_title(TEXT, UUID)',
        'public.list_own_cinema_content(TEXT, UUID)'
    ] LOOP
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
    REVOKE ALL ON FUNCTION public.cinema_title_rows(UUID) FROM service_role;
    REVOKE ALL ON FUNCTION public.cinema_close_title(UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM service_role;
END $$;
