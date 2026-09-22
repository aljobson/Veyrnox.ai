-- Auto Short, slice 2 (ADR-0029, docs/auto-short/SPEC.md §4): job_steps.
--
-- One Auto Short is one parent `jobs` row (one debit, one refund at most)
-- and up to seven provider calls: script, voice, four scenes, stitch. Each
-- call is a job_steps row. Nothing here touches jobs, ledger_entries or
-- credit_balances; the parent's debit and refund stay on the existing RPCs.
--
-- Writes go only through three SECURITY DEFINER functions, and a step only
-- ever moves forward:
--
--   job_step_submitted  (new) ─► SUBMITTED; SUBMITTED ─► SUBMITTED on a
--                       re-submit with a new provider_job_id, attempts + 1,
--                       at most 2 attempts
--   job_step_stored     SUBMITTED ─► STORED (a synchronous step, the script,
--                       may go straight from nothing to STORED)
--   job_step_failed     SUBMITTED ─► FAILED
--
-- STORED and FAILED are terminal. A replayed webhook (same provider_job_id
-- submitted twice, a second "stored" or "failed") returns ok with
-- `replay: true` and changes nothing.
--
-- Service-role only: RLS on and forced with no policy, every browser role
-- revoked, and service_role may read the table but not write it directly.
--
-- Idempotent: IF NOT EXISTS, OR REPLACE, REVOKE/GRANT re-run.

CREATE TABLE IF NOT EXISTS public.job_steps (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id            UUID        NOT NULL REFERENCES public.jobs(id),
    step              TEXT        NOT NULL CHECK (step IN ('script', 'voice', 'scene', 'stitch')),
    ordinal           SMALLINT    NOT NULL DEFAULT 0
                      CHECK ((step = 'scene' AND ordinal BETWEEN 0 AND 3) OR (step <> 'scene' AND ordinal = 0)),
    provider          TEXT        NOT NULL CHECK (provider IN ('fal', 'kie', 'openrouter')),
    provider_endpoint TEXT        NOT NULL CHECK (provider_endpoint ~ '^[A-Za-z0-9:/_.-]{3,128}$'),
    provider_job_id   TEXT        NULL CHECK (provider_job_id ~ '^[A-Za-z0-9_-]{1,128}$'),
    state             TEXT        NOT NULL CHECK (state IN ('SUBMITTED', 'STORED', 'FAILED')),
    attempts          SMALLINT    NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 2),
    output_r2_key     TEXT        NULL CHECK (output_r2_key ~ '^[A-Za-z0-9/_.-]{1,255}$' AND output_r2_key !~ '\.\.'),
    output_text       JSONB       NULL,
    error_code        TEXT        NULL CHECK (error_code ~ '^[a-z0-9_]{1,64}$'),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (job_id, step, ordinal)
);

-- Webhooks find a step by the id the provider called back with.
CREATE UNIQUE INDEX IF NOT EXISTS job_steps_provider_job_idx
    ON public.job_steps (provider, provider_job_id) WHERE provider_job_id IS NOT NULL;
-- The sweep looks for steps stuck in SUBMITTED.
CREATE INDEX IF NOT EXISTS job_steps_submitted_idx
    ON public.job_steps (updated_at) WHERE state = 'SUBMITTED';

ALTER TABLE public.job_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_steps FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_steps FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.job_steps TO service_role;


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
    -- The parent must be paid for and still live.
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
    IF v_row.attempts >= 2 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ATTEMPTS_EXHAUSTED');
    END IF;

    UPDATE public.job_steps
    SET provider_job_id = p_provider_job_id, attempts = attempts + 1, updated_at = now()
    WHERE id = v_row.id
    RETURNING * INTO v_row;
    RETURN jsonb_build_object('ok', true, 'step_id', v_row.id, 'attempts', v_row.attempts);
END $$;


-- Finds the step by (job, step, ordinal). The webhook reads job_id, step and
-- ordinal from the row it matched on (provider, provider_job_id), never from
-- the payload. A step that never had a provider call (the synchronous
-- script) is created here as STORED.
CREATE OR REPLACE FUNCTION public.job_step_stored(
    p_job_id UUID,
    p_step TEXT,
    p_ordinal SMALLINT,
    p_provider TEXT,
    p_provider_endpoint TEXT,
    p_output_r2_key TEXT,
    p_output_text JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row public.job_steps%ROWTYPE;
BEGIN
    IF p_output_r2_key IS NULL AND p_output_text IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NO_OUTPUT');
    END IF;
    PERFORM 1 FROM public.jobs WHERE id = p_job_id AND state IN ('DEBITED', 'SUBMITTED') FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'JOB_NOT_FOUND_OR_BAD_STATE');
    END IF;

    SELECT * INTO v_row FROM public.job_steps
    WHERE job_id = p_job_id AND step = p_step AND ordinal = p_ordinal
    FOR UPDATE;

    IF NOT FOUND THEN
        IF p_step <> 'script' THEN
            RETURN jsonb_build_object('ok', false, 'code', 'STEP_NOT_SUBMITTED');
        END IF;
        INSERT INTO public.job_steps (job_id, step, ordinal, provider, provider_endpoint, state, output_r2_key, output_text)
        VALUES (p_job_id, p_step, p_ordinal, p_provider, p_provider_endpoint, 'STORED', p_output_r2_key, p_output_text)
        RETURNING * INTO v_row;
        RETURN jsonb_build_object('ok', true, 'step_id', v_row.id);
    END IF;

    IF v_row.state = 'STORED' THEN
        RETURN jsonb_build_object('ok', true, 'replay', true, 'step_id', v_row.id);
    END IF;
    IF v_row.state = 'FAILED' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'STEP_FINISHED', 'state', v_row.state);
    END IF;

    UPDATE public.job_steps
    SET state = 'STORED', output_r2_key = p_output_r2_key, output_text = p_output_text, updated_at = now()
    WHERE id = v_row.id;
    RETURN jsonb_build_object('ok', true, 'step_id', v_row.id);
END $$;


CREATE OR REPLACE FUNCTION public.job_step_failed(
    p_job_id UUID,
    p_step TEXT,
    p_ordinal SMALLINT,
    p_error_code TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row public.job_steps%ROWTYPE;
BEGIN
    IF p_error_code IS NULL OR p_error_code !~ '^[a-z0-9_]{1,64}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_ERROR_CODE');
    END IF;

    SELECT * INTO v_row FROM public.job_steps
    WHERE job_id = p_job_id AND step = p_step AND ordinal = p_ordinal
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'STEP_NOT_SUBMITTED');
    END IF;
    IF v_row.state = 'FAILED' THEN
        RETURN jsonb_build_object('ok', true, 'replay', true, 'step_id', v_row.id);
    END IF;
    IF v_row.state = 'STORED' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'STEP_FINISHED', 'state', v_row.state);
    END IF;

    UPDATE public.job_steps
    SET state = 'FAILED', error_code = p_error_code, updated_at = now()
    WHERE id = v_row.id;
    RETURN jsonb_build_object('ok', true, 'step_id', v_row.id);
END $$;


DO $$
DECLARE fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.job_step_submitted(UUID, TEXT, SMALLINT, TEXT, TEXT, TEXT)',
        'public.job_step_stored(UUID, TEXT, SMALLINT, TEXT, TEXT, TEXT, JSONB)',
        'public.job_step_failed(UUID, TEXT, SMALLINT, TEXT)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END $$;
