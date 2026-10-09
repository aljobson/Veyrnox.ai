-- 0182 — Draft posts and batch review for Veyrnox Publish (ADR-0061 amendment).
--
-- A draft is a social_posts row with status 'draft' and a draft_batch_id.
-- Every reader that moves a post towards a network filters
-- status = 'scheduled' (claim 0168, settle 0168, sweep health 0157, due
-- index 0156), so a draft is inert until its owner approves the batch.
--
-- create_social_post_draft runs create_social_post unchanged, so a draft
-- passes exactly the checks a scheduled post does, then parks the new row
-- as a draft in the same transaction: the sweep never sees it scheduled.
--
-- approve_social_post_batch moves a batch's drafts to 'scheduled' (never
-- into the past) and settles each one, because a disconnect while it was a
-- draft may have failed every target; such a post becomes 'failed' instead
-- of sitting 'scheduled' and tripping the sweep-health check.
--
-- discard_social_post_drafts cancels one draft or a whole batch, and
-- list_social_post_drafts returns every open draft for review.
-- Approve and discard are written to social_account_actions.

-- ── Schema ────────────────────────────────────────────────────────────────
ALTER TABLE public.social_posts DROP CONSTRAINT IF EXISTS social_posts_status_check;
ALTER TABLE public.social_posts ADD CONSTRAINT social_posts_status_check
    CHECK (status IN ('draft', 'scheduled', 'published', 'failed', 'canceled'));

ALTER TABLE public.social_posts ADD COLUMN IF NOT EXISTS draft_batch_id UUID NULL;

ALTER TABLE public.social_posts DROP CONSTRAINT IF EXISTS social_posts_draft_has_batch;
ALTER TABLE public.social_posts ADD CONSTRAINT social_posts_draft_has_batch
    CHECK (status <> 'draft' OR draft_batch_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS social_posts_draft_batch_idx
    ON public.social_posts (brand_id, draft_batch_id) WHERE draft_batch_id IS NOT NULL;

-- ── create_social_post_draft ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_social_post_draft(
    p_auth_id TEXT,
    p_brand_id UUID,
    p_batch_id UUID,
    p_scheduled_at TIMESTAMPTZ,
    p_global_text TEXT,
    p_idempotency_key TEXT,
    p_account_ids UUID[],
    p_media JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_result JSONB;
    v_post   UUID;
    v_status TEXT;
BEGIN
    IF p_batch_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_BATCH');
    END IF;

    v_result := public.create_social_post(p_auth_id, p_brand_id, p_scheduled_at, p_global_text,
                                          p_idempotency_key, p_account_ids, p_media);
    IF NOT coalesce((v_result->>'ok')::BOOLEAN, false) THEN
        RETURN v_result;
    END IF;
    v_post := (v_result->>'post_id')::UUID;

    -- Only the row this call inserted. A replayed key returns the existing
    -- post as it stands, so an approved post never falls back to draft.
    IF NOT coalesce((v_result->>'idempotent')::BOOLEAN, false) THEN
        UPDATE public.social_posts
        SET status = 'draft', draft_batch_id = p_batch_id, updated_at = now()
        WHERE id = v_post AND status = 'scheduled' AND draft_batch_id IS NULL;
    END IF;

    SELECT status INTO v_status FROM public.social_posts WHERE id = v_post;
    RETURN v_result || jsonb_build_object('status', v_status);
END $$;

-- Resolves p_auth_id to the owner of p_brand_id, or NULL.
CREATE OR REPLACE FUNCTION public.social_brand_owner(p_auth_id TEXT, p_brand_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user UUID;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN NULL;
    END IF;
    SELECT u.id INTO v_user FROM public.users u
    JOIN auth.users a ON a.id = p_auth_id::UUID
    JOIN public.social_brands b ON b.owner_user_id = u.id AND b.id = p_brand_id
    WHERE u.auth_id = p_auth_id;
    RETURN v_user;
END $$;

-- ── approve_social_post_batch ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_social_post_batch(p_auth_id TEXT, p_brand_id UUID, p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user     UUID;
    v_post     UUID;
    v_approved INTEGER := 0;
    v_failed   INTEGER;
BEGIN
    v_user := public.social_brand_owner(p_auth_id, p_brand_id);
    IF v_user IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BRAND_NOT_FOUND');
    END IF;
    IF p_batch_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_BATCH');
    END IF;

    FOR v_post IN
        UPDATE public.social_posts
        SET status = 'scheduled', scheduled_at = greatest(scheduled_at, now()), updated_at = now()
        WHERE brand_id = p_brand_id AND draft_batch_id = p_batch_id AND status = 'draft'
        RETURNING id
    LOOP
        PERFORM public.settle_social_post(v_post);
        v_approved := v_approved + 1;
    END LOOP;

    SELECT count(*) INTO v_failed FROM public.social_posts
    WHERE brand_id = p_brand_id AND draft_batch_id = p_batch_id AND status = 'failed';

    IF v_approved > 0 THEN
        INSERT INTO public.social_account_actions (actor_id, brand_id, action, target_id, detail)
        VALUES (v_user, p_brand_id, 'approve_drafts', p_batch_id, jsonb_build_object('posts', v_approved));
    END IF;
    RETURN jsonb_build_object('ok', true, 'approved', v_approved, 'failed', v_failed);
END $$;

-- ── discard_social_post_drafts ────────────────────────────────────────────
-- p_post_id NULL discards every draft in the batch.
CREATE OR REPLACE FUNCTION public.discard_social_post_drafts(
    p_auth_id TEXT, p_brand_id UUID, p_batch_id UUID, p_post_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user      UUID;
    v_discarded INTEGER;
BEGIN
    v_user := public.social_brand_owner(p_auth_id, p_brand_id);
    IF v_user IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BRAND_NOT_FOUND');
    END IF;
    IF p_batch_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_BATCH');
    END IF;

    WITH discarded AS (
        UPDATE public.social_posts
        SET status = 'canceled', updated_at = now()
        WHERE brand_id = p_brand_id AND draft_batch_id = p_batch_id AND status = 'draft'
          AND (p_post_id IS NULL OR id = p_post_id)
        RETURNING id
    ), targets AS (
        UPDATE public.social_post_targets t
        SET publish_status = 'failed', last_error = 'draft_discarded', claim_key = NULL
        FROM discarded d
        WHERE t.post_id = d.id AND t.publish_status = 'pending'
        RETURNING t.id
    )
    SELECT count(*) INTO v_discarded FROM discarded;

    IF v_discarded > 0 THEN
        INSERT INTO public.social_account_actions (actor_id, brand_id, action, target_id, detail)
        VALUES (v_user, p_brand_id, 'discard_drafts', p_batch_id,
                jsonb_build_object('posts', v_discarded, 'post_id', p_post_id));
    END IF;
    RETURN jsonb_build_object('ok', true, 'discarded', v_discarded);
END $$;

-- ── list_social_post_drafts ───────────────────────────────────────────────
-- Every open draft of the brand, oldest batch first, for the review screen.
-- list_social_posts stays the paginated history; drafts need the batch id
-- and media to be reviewed, and all of them at once.
CREATE OR REPLACE FUNCTION public.list_social_post_drafts(p_auth_id TEXT, p_brand_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rows JSONB;
BEGIN
    IF public.social_brand_owner(p_auth_id, p_brand_id) IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BRAND_NOT_FOUND');
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', p.id,
        'draft_batch_id', p.draft_batch_id,
        'scheduled_at', p.scheduled_at,
        'global_text', p.global_text,
        'created_at', p.created_at,
        'media', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('media_type', m.media_type, 'job_id', m.source_job_id) ORDER BY m."position")
            FROM public.social_post_media m WHERE m.post_id = p.id
        ), '[]'::jsonb),
        'networks', COALESCE((
            SELECT jsonb_agg(t.network ORDER BY t.network)
            FROM public.social_post_targets t WHERE t.post_id = p.id
        ), '[]'::jsonb)
    ) ORDER BY p.created_at, p.scheduled_at, p.id), '[]'::jsonb)
    INTO v_rows
    FROM (
        SELECT * FROM public.social_posts
        WHERE brand_id = p_brand_id AND status = 'draft'
        ORDER BY created_at, scheduled_at, id
        LIMIT 200
    ) p;
    RETURN jsonb_build_object('ok', true, 'drafts', v_rows);
END $$;

-- ── Privileges: service role only, full signatures ───────────────────────
REVOKE ALL ON FUNCTION public.create_social_post_draft(TEXT, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, UUID[], JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.social_brand_owner(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_social_post_batch(TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.discard_social_post_drafts(TEXT, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_social_post_drafts(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_social_post_draft(TEXT, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, UUID[], JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.social_brand_owner(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_social_post_batch(TEXT, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.discard_social_post_drafts(TEXT, UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_social_post_drafts(TEXT, UUID) TO service_role;
