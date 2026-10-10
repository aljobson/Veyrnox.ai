-- CSAM escalation with evidence preservation, and user content reports
-- (ADR-0083; Thorn / All Tech Is Human, Safety by Design for Generative AI,
-- Deploy mitigations 1 to 3).
--
--   * record_csam_escalation: the tier above a takedown. The job's files stop
--     being served at once (assets rows deleted) but the R2 objects are NOT
--     queued for the reaper: their keys go to evidence_holds, so the report
--     to the IWF / NCMEC and any law-enforcement request can be met
--     (docs/agents/csam-escalation.md). The account is Frozen with reason
--     'content:csam_escalation'. The user is never emailed about this tier.
--   * release_evidence_hold: when the procedure says the material may be
--     destroyed, an admin releases the hold with a reason and the keys enter
--     asset_reap_queue like any other deletion.
--   * content_reports: a user's in-product report of an output or a title
--     (their own, or one they saw), with a category and words; an admin
--     reads the queue and resolves each one with a note.
--
-- Admin-only functions use the ops_metrics_24h pattern (42501 'not_admin').
-- Idempotent: IF NOT EXISTS, OR REPLACE, drop-and-add for the widened CHECK,
-- REVOKE/GRANT re-run.

ALTER TABLE public.account_actions DROP CONSTRAINT IF EXISTS account_actions_action_check;
ALTER TABLE public.account_actions
    ADD CONSTRAINT account_actions_action_check
    CHECK (action IN ('freeze', 'unfreeze', 'dispute_resolved', 'warning', 'takedown', 'credit_grant',
                      'appeal_upheld', 'appeal_rejected', 'csam_escalation', 'evidence_released'));

-- ── evidence_holds ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.evidence_holds (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    action_id       UUID        NOT NULL REFERENCES public.account_actions(id) ON DELETE RESTRICT,
    job_id          UUID        NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
    r2_key          TEXT        NOT NULL UNIQUE,
    mime_type       TEXT        NOT NULL,
    size_bytes      BIGINT      NOT NULL,
    held_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    released_at     TIMESTAMPTZ NULL,
    release_action_id UUID      NULL REFERENCES public.account_actions(id) ON DELETE RESTRICT,
    CHECK ((released_at IS NULL) = (release_action_id IS NULL))
);
CREATE INDEX IF NOT EXISTS evidence_holds_action_idx ON public.evidence_holds (action_id);
CREATE INDEX IF NOT EXISTS evidence_holds_job_idx ON public.evidence_holds (job_id);
CREATE INDEX IF NOT EXISTS evidence_holds_release_action_idx ON public.evidence_holds (release_action_id);
ALTER TABLE public.evidence_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_holds FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.evidence_holds FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.evidence_holds_released_once()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'evidence_holds rows are never deleted';
    END IF;
    IF OLD.released_at IS NOT NULL THEN
        RAISE EXCEPTION 'evidence hold % is already released', OLD.id;
    END IF;
    IF NEW.action_id <> OLD.action_id OR NEW.job_id <> OLD.job_id OR NEW.r2_key <> OLD.r2_key OR NEW.held_at <> OLD.held_at THEN
        RAISE EXCEPTION 'evidence hold % may only be released, not rewritten', OLD.id;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.evidence_holds_released_once() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS evidence_holds_released_once ON public.evidence_holds;
CREATE TRIGGER evidence_holds_released_once BEFORE UPDATE OR DELETE ON public.evidence_holds
    FOR EACH ROW EXECUTE FUNCTION public.evidence_holds_released_once();
DROP TRIGGER IF EXISTS evidence_holds_no_truncate ON public.evidence_holds;
CREATE TRIGGER evidence_holds_no_truncate BEFORE TRUNCATE ON public.evidence_holds
    FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_no_truncate();

-- ── record_csam_escalation (admin) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_csam_escalation(
    p_auth_id TEXT,
    p_user_id UUID,
    p_job_id UUID,
    p_reason TEXT,
    p_idempotency_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_admin RECORD;
    v_frozen BOOLEAN;
    v_job_owner UUID;
    v_seen RECORD;
    v_action_id UUID;
    v_preserved INTEGER := 0;
    v_froze BOOLEAN := false;
BEGIN
    SELECT u.id, u.email, u.is_admin INTO v_admin FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_admin.id IS NULL OR v_admin.is_admin IS NOT TRUE THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
    END IF;
    IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,128}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_INVALID');
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
    END IF;
    IF p_job_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'JOB_REQUIRED');
    END IF;

    PERFORM 1 FROM public.credit_balances b WHERE b.user_id = p_user_id FOR UPDATE;
    SELECT u.frozen_at IS NOT NULL INTO v_frozen FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
    IF v_frozen IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;

    SELECT a.id, a.user_id, a.action INTO v_seen FROM public.account_actions a WHERE a.idempotency_key = p_idempotency_key;
    IF v_seen.id IS NOT NULL THEN
        IF v_seen.user_id <> p_user_id OR v_seen.action <> 'csam_escalation' THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REUSED');
        END IF;
        SELECT count(*) INTO v_preserved FROM public.evidence_holds h WHERE h.action_id = v_seen.id;
        RETURN jsonb_build_object('ok', true, 'action_id', v_seen.id, 'tier', 'csam_escalation', 'assets_removed', 0,
                                   'preserved', v_preserved, 'frozen', v_frozen, 'replayed', true);
    END IF;

    SELECT j.user_id INTO v_job_owner FROM public.jobs j WHERE j.id = p_job_id;
    IF v_job_owner IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'JOB_NOT_FOUND');
    END IF;
    IF v_job_owner <> p_user_id THEN
        RETURN jsonb_build_object('ok', false, 'code', 'JOB_NOT_OWNED');
    END IF;

    INSERT INTO public.account_actions (user_id, action, actor, reason, top_up_id, job_id, idempotency_key)
    VALUES (p_user_id, 'csam_escalation', left(coalesce(v_admin.email, p_auth_id), 120), btrim(p_reason), NULL, p_job_id, p_idempotency_key)
    RETURNING id INTO v_action_id;

    -- Stop serving, keep the bytes: the keys go on hold, never to the reaper.
    WITH doomed AS (
        SELECT a.id, a.r2_key, a.mime_type, a.size_bytes FROM public.assets a WHERE a.job_id = p_job_id
    ),
    held AS (
        INSERT INTO public.evidence_holds (action_id, job_id, r2_key, mime_type, size_bytes)
        SELECT v_action_id, p_job_id, r2_key, mime_type, size_bytes FROM doomed
        ON CONFLICT (r2_key) DO NOTHING
        RETURNING 1
    ),
    dropped AS (
        DELETE FROM public.assets WHERE id IN (SELECT id FROM doomed) RETURNING 1
    )
    SELECT count(*) INTO v_preserved FROM dropped;
    -- A key the reaper was already going to delete must not be deleted now.
    DELETE FROM public.asset_reap_queue q WHERE q.r2_key IN (SELECT h.r2_key FROM public.evidence_holds h WHERE h.action_id = v_action_id);

    IF NOT v_frozen THEN
        PERFORM public.freeze_account(p_user_id, 'content:csam_escalation', NULL);
        v_froze := true;
    END IF;

    RETURN jsonb_build_object('ok', true, 'action_id', v_action_id, 'tier', 'csam_escalation', 'assets_removed', v_preserved,
                               'preserved', v_preserved, 'frozen', v_frozen OR v_froze, 'replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.record_csam_escalation(TEXT, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_csam_escalation(TEXT, UUID, UUID, TEXT, TEXT) TO service_role;

-- ── release_evidence_hold (admin) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.release_evidence_hold(
    p_auth_id TEXT,
    p_action_id UUID,
    p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_admin RECORD;
    v_action RECORD;
    v_release_id UUID;
    v_released INTEGER;
BEGIN
    SELECT u.id, u.email, u.is_admin INTO v_admin FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_admin.id IS NULL OR v_admin.is_admin IS NOT TRUE THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
    END IF;
    SELECT a.id, a.user_id, a.job_id INTO v_action FROM public.account_actions a WHERE a.id = p_action_id AND a.action = 'csam_escalation';
    IF v_action.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACTION_NOT_FOUND');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.evidence_holds h WHERE h.action_id = p_action_id AND h.released_at IS NULL) THEN
        RETURN jsonb_build_object('ok', true, 'released', 0, 'replayed', true);
    END IF;

    INSERT INTO public.account_actions (user_id, action, actor, reason, top_up_id, job_id)
    VALUES (v_action.user_id, 'evidence_released', left(coalesce(v_admin.email, p_auth_id), 120), btrim(p_reason), NULL, v_action.job_id)
    RETURNING id INTO v_release_id;

    WITH released AS (
        UPDATE public.evidence_holds h
           SET released_at = now(), release_action_id = v_release_id
         WHERE h.action_id = p_action_id AND h.released_at IS NULL
        RETURNING h.r2_key
    ),
    queued AS (
        INSERT INTO public.asset_reap_queue (r2_key) SELECT r2_key FROM released
        ON CONFLICT (r2_key) DO NOTHING RETURNING 1
    )
    SELECT count(*) INTO v_released FROM released;
    RETURN jsonb_build_object('ok', true, 'released', v_released, 'action_id', v_release_id, 'replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.release_evidence_hold(TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_evidence_hold(TEXT, UUID, TEXT) TO service_role;

-- ── content_reports ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.content_reports (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id     UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    subject_kind    TEXT        NOT NULL CHECK (subject_kind IN ('job', 'cinema_title', 'other')),
    subject_id      UUID        NULL,
    category        TEXT        NOT NULL CHECK (category IN ('csam', 'intimate_image', 'real_person', 'violence', 'hate', 'fraud', 'copyright', 'other')),
    details         TEXT        NOT NULL CHECK (length(details) <= 2000),
    status          TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ NULL,
    resolved_by     TEXT        NULL,
    resolution      TEXT        NULL CHECK (resolution IS NULL OR length(btrim(resolution)) BETWEEN 3 AND 500),
    CHECK ((status = 'open') = (resolved_at IS NULL)),
    CHECK ((subject_kind = 'other') = (subject_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS content_reports_one_per_subject
    ON public.content_reports (reporter_id, subject_kind, subject_id) WHERE subject_id IS NOT NULL AND status = 'open';
CREATE INDEX IF NOT EXISTS content_reports_open_idx ON public.content_reports (created_at) WHERE status = 'open';
ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_reports FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_reports FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_content_report(
    p_auth_id TEXT,
    p_subject_kind TEXT,
    p_subject_id UUID,
    p_category TEXT,
    p_details TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_open INTEGER;
    v_id UUID;
BEGIN
    SELECT u.id INTO v_user_id FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    IF p_subject_kind IS NULL OR p_subject_kind NOT IN ('job', 'cinema_title', 'other') OR ((p_subject_kind = 'other') <> (p_subject_id IS NULL)) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SUBJECT_INVALID');
    END IF;
    IF p_category IS NULL OR p_category NOT IN ('csam', 'intimate_image', 'real_person', 'violence', 'hate', 'fraud', 'copyright', 'other') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CATEGORY_INVALID');
    END IF;
    IF p_details IS NULL OR length(p_details) > 2000 OR (p_subject_kind = 'other' AND length(btrim(p_details)) < 10) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'DETAILS_INVALID');
    END IF;
    -- A flood is not a report. Twenty open ones is already more than one person has reason for.
    SELECT count(*) INTO v_open FROM public.content_reports r WHERE r.reporter_id = v_user_id AND r.status = 'open';
    IF v_open >= 20 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'TOO_MANY_OPEN_REPORTS');
    END IF;
    IF p_subject_id IS NOT NULL THEN
        SELECT r.id INTO v_id FROM public.content_reports r
         WHERE r.reporter_id = v_user_id AND r.subject_kind = p_subject_kind AND r.subject_id = p_subject_id AND r.status = 'open';
        IF v_id IS NOT NULL THEN
            RETURN jsonb_build_object('ok', true, 'report_id', v_id, 'replayed', true);
        END IF;
    END IF;
    INSERT INTO public.content_reports (reporter_id, subject_kind, subject_id, category, details)
    VALUES (v_user_id, p_subject_kind, p_subject_id, p_category, btrim(coalesce(p_details, '')))
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok', true, 'report_id', v_id, 'replayed', false);
EXCEPTION WHEN unique_violation THEN
    SELECT r.id INTO v_id FROM public.content_reports r
     WHERE r.reporter_id = v_user_id AND r.subject_kind = p_subject_kind AND r.subject_id = p_subject_id AND r.status = 'open';
    RETURN jsonb_build_object('ok', true, 'report_id', v_id, 'replayed', true);
END $$;
REVOKE ALL ON FUNCTION public.submit_content_report(TEXT, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_content_report(TEXT, TEXT, UUID, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.list_content_reports(
    p_auth_id TEXT,
    p_status TEXT DEFAULT 'open',
    p_limit INTEGER DEFAULT 50
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_admin BOOLEAN;
    v_rows JSONB;
BEGIN
    SELECT u.is_admin INTO v_admin FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_admin IS NOT TRUE THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
    END IF;
    IF p_status IS NOT NULL AND p_status NOT IN ('open', 'resolved') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'STATUS_INVALID');
    END IF;
    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY (t.category = 'csam') DESC, t.created_at), '[]'::jsonb) INTO v_rows
    FROM (
        SELECT r.id, r.reporter_id, u.email AS reporter_email, r.subject_kind, r.subject_id, r.category, r.details,
               r.status, r.created_at, r.resolved_at, r.resolved_by, r.resolution,
               j.user_id AS subject_user_id, j.model_id AS subject_model_id,
               EXISTS (SELECT 1 FROM public.assets a WHERE a.job_id = j.id) AS subject_served
          FROM public.content_reports r
          JOIN public.users u ON u.id = r.reporter_id
          LEFT JOIN public.jobs j ON r.subject_kind = 'job' AND j.id = r.subject_id
         WHERE p_status IS NULL OR r.status = p_status
         ORDER BY (r.category = 'csam') DESC, r.created_at
         LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
    ) t;
    RETURN jsonb_build_object('ok', true, 'reports', v_rows);
END $$;
REVOKE ALL ON FUNCTION public.list_content_reports(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_content_reports(TEXT, TEXT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_content_report(
    p_auth_id TEXT,
    p_report_id UUID,
    p_resolution TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_admin RECORD;
    v_status TEXT;
BEGIN
    SELECT u.id, u.email, u.is_admin INTO v_admin FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_admin.id IS NULL OR v_admin.is_admin IS NOT TRUE THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
    END IF;
    IF p_resolution IS NULL OR length(btrim(p_resolution)) NOT BETWEEN 3 AND 500 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'RESOLUTION_REQUIRED');
    END IF;
    SELECT r.status INTO v_status FROM public.content_reports r WHERE r.id = p_report_id FOR UPDATE;
    IF v_status IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'REPORT_NOT_FOUND');
    END IF;
    IF v_status <> 'open' THEN
        RETURN jsonb_build_object('ok', true, 'report_id', p_report_id, 'replayed', true);
    END IF;
    UPDATE public.content_reports
       SET status = 'resolved', resolved_at = now(), resolved_by = left(coalesce(v_admin.email, p_auth_id), 120), resolution = btrim(p_resolution)
     WHERE id = p_report_id;
    RETURN jsonb_build_object('ok', true, 'report_id', p_report_id, 'replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.resolve_content_report(TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_content_report(TEXT, UUID, TEXT) TO service_role;

-- ── list_content_violations: 0146's signature, now every content-side row ──
CREATE OR REPLACE FUNCTION public.list_content_violations(
    p_auth_id TEXT,
    p_user_id UUID DEFAULT NULL,
    p_limit INTEGER DEFAULT 50
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_admin BOOLEAN;
    v_rows JSONB;
BEGIN
    SELECT u.is_admin INTO v_admin FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_admin IS NOT TRUE THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
    END IF;
    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_rows
    FROM (
        SELECT a.id, a.user_id, u.email, a.action, a.actor, a.reason, a.job_id, j.model_id, a.hold_until, a.created_at
          FROM public.account_actions a
          JOIN public.users u ON u.id = a.user_id
          LEFT JOIN public.jobs j ON j.id = a.job_id
         WHERE (a.action IN ('warning', 'takedown', 'csam_escalation', 'evidence_released', 'appeal_upheld', 'appeal_rejected')
                OR (a.action IN ('freeze', 'unfreeze') AND (a.reason LIKE 'content:%' OR a.reason LIKE 'appeal:%')))
           AND (p_user_id IS NULL OR a.user_id = p_user_id)
         ORDER BY a.created_at DESC
         LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
    ) t;
    RETURN v_rows;
END $$;

REVOKE ALL ON FUNCTION public.list_content_violations(TEXT, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_content_violations(TEXT, UUID, INTEGER) TO service_role;
