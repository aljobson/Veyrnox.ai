-- ADR-0116: a person deletes one of their own creations.
--
-- The generated file and the prompt go; the job row, its state, model, credits and every ledger
-- entry stay, so balance = SUM(ledger) and every reconcile_*() is untouched. No refund. Nothing in
-- this file writes ledger_entries or credit_balances.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, REVOKE/GRANT re-run.

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

-- ── Reads: a deleted job is gone for its owner ───────────────────────────────
-- get_user_job (0115) feeds GET /jobs/:id and /jobs/:id/provenance; list_user_jobs (0289) feeds the Library.
CREATE OR REPLACE FUNCTION public.get_user_job(
    p_auth_id TEXT,
    p_job_id  UUID
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rate JSONB;
    v_user_id UUID;
    v_row     public.jobs%ROWTYPE;
BEGIN
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    END IF;

    v_rate := public.consume_job_read_request(v_user_id);
    IF v_rate->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_rate; END IF;

    SELECT * INTO v_row FROM public.jobs
    WHERE id = p_job_id AND user_id = v_user_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'state', v_row.state,
        'credits', v_row.credits,
        'model_id', v_row.model_id,
        'provider', v_row.provider,
        'provider_job_id', v_row.provider_job_id,
        'error_code', v_row.error_code,
        'created_at', v_row.created_at,
        'updated_at', v_row.updated_at
    );
END $$;
REVOKE ALL ON FUNCTION public.get_user_job(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_job(TEXT, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.list_user_jobs(p_auth_id TEXT, p_limit INTEGER DEFAULT 24, p_before_created_at TIMESTAMPTZ DEFAULT NULL, p_before_id UUID DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_rate JSONB; v_user_id UUID;
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 24), 1), 50); v_rows JSONB;
BEGIN
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id;
    IF v_user_id IS NULL THEN RETURN jsonb_build_object('ok', true, 'jobs', '[]'::jsonb); END IF;
    v_rate := public.consume_job_read_request(v_user_id);
    IF v_rate->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_rate; END IF;
    SELECT COALESCE(jsonb_agg(j ORDER BY j.created_at DESC, j.id DESC), '[]'::jsonb) INTO v_rows FROM (
        SELECT jsonb_build_object(
                   'job_id', b.id, 'state', b.state, 'credits', b.credits, 'model_id', b.model_id, 'error_code', b.error_code, 'created_at', b.created_at,
                   'label', left(COALESCE(b.inputs->>'prompt', b.inputs->>'topic', ''), 60),
                   'asset_expires_at', (SELECT min(a.expires_at) FROM public.assets a WHERE a.job_id = b.id),
                   'has_asset', EXISTS (SELECT 1 FROM public.assets a WHERE a.job_id = b.id AND a.held_at IS NULL),
                   'held', EXISTS (SELECT 1 FROM public.assets a WHERE a.job_id = b.id AND a.held_at IS NOT NULL)
               ) AS j,
               b.created_at,
               b.id FROM public.jobs b WHERE b.user_id = v_user_id
          AND b.deleted_at IS NULL
          AND b.inputs->>'kind' IS DISTINCT FROM 'chat'
          AND (p_before_created_at IS NULL
               OR (b.created_at, b.id) < (p_before_created_at, COALESCE(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid))) ORDER BY b.created_at DESC, b.id DESC LIMIT v_limit
    ) j;
    RETURN jsonb_build_object('ok', true, 'jobs', v_rows);
END $$;
REVOKE ALL ON FUNCTION public.list_user_jobs(TEXT, INTEGER, TIMESTAMPTZ, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_user_jobs(TEXT, INTEGER, TIMESTAMPTZ, UUID) TO service_role;

-- ── The deletion ─────────────────────────────────────────────────────────────
-- Result: {ok:true, replayed} or {ok:false, code} with code one of
-- NOT_FOUND, RATE_LIMITED, ACCOUNT_FROZEN, IN_PROGRESS, ON_HOLD, USED_BY_POST, USED_BY_CINEMA, USED_BY_LIBRARY.
CREATE OR REPLACE FUNCTION public.delete_user_job(p_auth_id TEXT, p_job_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user public.users%ROWTYPE;
    v_job  public.jobs%ROWTYPE;
    v_rate JSONB;
BEGIN
    SELECT * INTO v_user FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;

    v_rate := public.consume_job_read_request(v_user.id);
    IF v_rate->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_rate; END IF;

    -- Owner only; the lock serialises two deletes of the same job, so the second sees the first.
    SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id AND user_id = v_user.id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;

    IF v_job.deleted_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'replayed', true);
    END IF;
    -- A chat reply is not a creation (the Library never lists it); chat has its own delete.
    IF v_job.inputs->>'kind' = 'chat' THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;

    -- A person cannot delete their way out of a dispute (ADR-0111).
    IF v_user.frozen_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN'); END IF;

    -- Only a settled job. SUCCEEDED means the file is still being copied; a fal request that has not
    -- closed still holds the prompt, and the sweep will close it.
    IF v_job.state NOT IN ('STORED', 'FAILED', 'REFUNDED')
       OR EXISTS (SELECT 1 FROM public.fal_dispatch d WHERE d.job_id = v_job.id AND d.state <> 'CLOSED') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'IN_PROGRESS');
    END IF;

    -- Preserved material and open reports are not erased on request (ADR-0083).
    IF EXISTS (SELECT 1 FROM public.evidence_holds h WHERE h.job_id = v_job.id AND h.released_at IS NULL)
       OR EXISTS (SELECT 1 FROM public.assets a WHERE a.job_id = v_job.id AND a.held_at IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.content_reports r
                   WHERE r.subject_kind = 'job' AND r.subject_id = v_job.id AND r.status = 'open') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ON_HOLD');
    END IF;

    -- Still in use. A post that failed or was cancelled no longer needs the file.
    IF EXISTS (SELECT 1 FROM public.social_post_media m JOIN public.social_posts p ON p.id = m.post_id
                WHERE m.source_job_id = v_job.id AND p.status IN ('draft', 'scheduled', 'published')) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USED_BY_POST');
    END IF;
    IF EXISTS (SELECT 1 FROM public.cinema_uploads u WHERE u.source_job_id = v_job.id) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USED_BY_CINEMA');
    END IF;
    IF EXISTS (SELECT 1 FROM public.film_library_masters m WHERE m.source_job_id = v_job.id) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USED_BY_LIBRARY');
    END IF;

    -- The files: queued for the reaper (ADR-0008), then the rows go.
    INSERT INTO public.asset_reap_queue (r2_key)
    SELECT a.r2_key FROM public.assets a WHERE a.job_id = v_job.id
    ON CONFLICT (r2_key) DO NOTHING;
    DELETE FROM public.assets WHERE job_id = v_job.id;

    -- Intermediate output of a multi-step job (script text, scene and voice files).
    INSERT INTO public.asset_reap_queue (r2_key)
    SELECT s.output_r2_key FROM public.job_steps s WHERE s.job_id = v_job.id AND s.output_r2_key IS NOT NULL
    ON CONFLICT (r2_key) DO NOTHING;
    UPDATE public.job_steps SET output_r2_key = NULL, output_text = NULL WHERE job_id = v_job.id;

    -- The prompt, wherever it is kept. The job row, its state, model and credits stay: they back the ledger.
    UPDATE public.fal_dispatch SET payload = '{}'::jsonb WHERE job_id = v_job.id;
    UPDATE public.jobs SET inputs = '{}'::jsonb, deleted_at = now(), updated_at = now() WHERE id = v_job.id;

    RETURN jsonb_build_object('ok', true, 'replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.delete_user_job(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_job(TEXT, UUID) TO service_role;
