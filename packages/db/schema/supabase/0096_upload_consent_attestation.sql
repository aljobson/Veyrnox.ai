-- Consent attestation for jobs that carry an upload.
--
-- Every merchant of record that accepts AI generation (Stripe, Dodo, Creem,
-- Polar) bans impersonation, face swaps and voice cloning. Our lip-sync and
-- image-edit models take a real person's face or voice as the input, so the
-- gateway now refuses such a job unless the caller states they own the
-- material or have the consent of everyone identifiable in it, and that
-- statement is recorded against the job for an auditor to read.
--
-- A column on jobs, not a new table: it is one fact per job, written once and
-- never changed, like error_code. The write goes through an RPC because the
-- Worker never writes jobs directly (CLAUDE.md, RPC-only writers).
--
-- Idempotent: IF NOT EXISTS, OR REPLACE, REVOKE/GRANT re-run.

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS consent_attested_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.jobs.consent_attested_at IS
    'When the user confirmed they own, or have consent for, the upload this job used. Set once by job_consent_attested; null for jobs with no upload.';

CREATE OR REPLACE FUNCTION public.job_consent_attested(
    p_job_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_at TIMESTAMPTZ;
BEGIN
    -- Write-once: a replay returns the first timestamp rather than moving it.
    SELECT consent_attested_at INTO v_at FROM public.jobs WHERE id = p_job_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'JOB_NOT_FOUND');
    END IF;
    IF v_at IS NULL THEN
        UPDATE public.jobs SET consent_attested_at = now() WHERE id = p_job_id
        RETURNING consent_attested_at INTO v_at;
    END IF;
    RETURN jsonb_build_object('ok', true, 'attested_at', v_at);
END $$;

REVOKE ALL ON FUNCTION public.job_consent_attested(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.job_consent_attested(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.job_consent_attested(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.job_consent_attested(UUID) TO service_role;
