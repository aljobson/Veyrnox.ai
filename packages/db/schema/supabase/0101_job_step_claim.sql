-- Claim a step before paying a provider for it (audit 2026-09-23, #230).
--
-- Two callers can hold the same finished step at once: a provider callback
-- and lib/autoShortSweep.js, which re-reads a step still SUBMITTED after 12
-- minutes. providerCompletion.dedup() returns 'retry' (not 'duplicate') while
-- the webhook_events row is unprocessed, so both proceed, both store the
-- output, and both compute the same next step and submit it. Two provider
-- jobs are billed, and job_step_submitted overwrote the first id with the
-- second, orphaning a call no webhook can ever match.
--
-- The fix is the row itself: UNIQUE (job_id, step, ordinal) already exists,
-- so an INSERT that loses the race loses it before any money is spent. The
-- claim row carries no provider_job_id yet; job_step_submitted attaches it
-- once the provider has accepted the work.
--
-- Idempotent: CREATE OR REPLACE, and the 6-argument job_step_submitted is
-- replaced in place (same arguments, same names).

-- ── claim ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.job_step_claim(
    p_job_id UUID,
    p_step TEXT,
    p_ordinal SMALLINT,
    p_provider TEXT,
    p_provider_endpoint TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row public.job_steps%ROWTYPE;
BEGIN
    -- The parent must be paid for and still live, exactly as for a submit.
    PERFORM 1 FROM public.jobs WHERE id = p_job_id AND state IN ('DEBITED', 'SUBMITTED') FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'JOB_NOT_FOUND_OR_BAD_STATE');
    END IF;

    INSERT INTO public.job_steps (job_id, step, ordinal, provider, provider_endpoint, state)
    VALUES (p_job_id, p_step, p_ordinal, p_provider, p_provider_endpoint, 'SUBMITTED')
    ON CONFLICT (job_id, step, ordinal) DO NOTHING
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
        -- Someone else owns this step: a racing caller, or a retry of a step
        -- that already ran. Never an error, and never a provider call.
        RETURN jsonb_build_object('ok', true, 'claimed', false);
    END IF;
    RETURN jsonb_build_object('ok', true, 'claimed', true, 'step_id', v_row.id);
END $$;

REVOKE ALL ON FUNCTION public.job_step_claim(UUID, TEXT, SMALLINT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.job_step_claim(UUID, TEXT, SMALLINT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.job_step_claim(UUID, TEXT, SMALLINT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.job_step_claim(UUID, TEXT, SMALLINT, TEXT, TEXT) TO service_role;

-- ── attach the provider's id to a claimed step ───────────────────────────
-- 0091's body, plus one branch: a claimed row has no provider_job_id yet, so
-- the first submit fills it in without spending an attempt. Everything else
-- (replay, finished, the two-attempt retry) is unchanged.
CREATE OR REPLACE FUNCTION public.job_step_submitted(
    p_job_id UUID,
    p_step TEXT,
    p_ordinal SMALLINT,
    p_provider TEXT,
    p_provider_endpoint TEXT,
    p_provider_job_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row public.job_steps%ROWTYPE;
BEGIN
    IF p_provider_job_id IS NULL OR p_provider_job_id !~ '^[A-Za-z0-9_-]{1,128}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_PROVIDER_JOB_ID');
    END IF;
    PERFORM 1 FROM public.jobs WHERE id = p_job_id AND state IN ('DEBITED', 'SUBMITTED') FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'JOB_NOT_FOUND_OR_BAD_STATE');
    END IF;

    SELECT * INTO v_row FROM public.job_steps
    WHERE job_id = p_job_id AND step = p_step AND ordinal = p_ordinal
    FOR UPDATE;

    IF NOT FOUND THEN
        INSERT INTO public.job_steps (job_id, step, ordinal, provider, provider_endpoint, provider_job_id, state)
        VALUES (p_job_id, p_step, p_ordinal, p_provider, p_provider_endpoint, p_provider_job_id, 'SUBMITTED')
        RETURNING * INTO v_row;
        RETURN jsonb_build_object('ok', true, 'step_id', v_row.id, 'attempts', v_row.attempts);
    END IF;

    IF v_row.provider_job_id = p_provider_job_id THEN
        RETURN jsonb_build_object('ok', true, 'replay', true, 'step_id', v_row.id, 'attempts', v_row.attempts);
    END IF;
    IF v_row.state <> 'SUBMITTED' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'STEP_FINISHED', 'state', v_row.state);
    END IF;

    -- A claimed row: this caller won job_step_claim and has now been given a
    -- provider job id for the work. Not an attempt — the first one.
    IF v_row.provider_job_id IS NULL THEN
        UPDATE public.job_steps
        SET provider_job_id = p_provider_job_id, provider = p_provider,
            provider_endpoint = p_provider_endpoint, updated_at = now()
        WHERE id = v_row.id
        RETURNING * INTO v_row;
        RETURN jsonb_build_object('ok', true, 'step_id', v_row.id, 'attempts', v_row.attempts);
    END IF;

    IF v_row.attempts >= 2 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ATTEMPTS_EXHAUSTED');
    END IF;

    UPDATE public.job_steps
    SET provider_job_id = p_provider_job_id, attempts = attempts + 1, updated_at = now()
    WHERE id = v_row.id
    RETURNING * INTO v_row;
    RETURN jsonb_build_object('ok', true, 'step_id', v_row.id, 'attempts', v_row.attempts);
END $$;

REVOKE ALL ON FUNCTION public.job_step_submitted(UUID, TEXT, SMALLINT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.job_step_submitted(UUID, TEXT, SMALLINT, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.job_step_submitted(UUID, TEXT, SMALLINT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.job_step_submitted(UUID, TEXT, SMALLINT, TEXT, TEXT, TEXT) TO service_role;
