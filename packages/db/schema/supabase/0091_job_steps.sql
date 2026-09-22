-- ADR-0029: composite jobs. One parent `jobs` row carries the debit, the
-- idempotency key and the final asset; each provider call is a `job_steps`
-- row. Shared by the Clip Editor (docs/editor/PRD.md) and Auto Short
-- (docs/auto-short/SPEC.md).
--
-- Steps run in stages: every step of stage n is ready once every step of
-- stages < n is STORED. That covers the editor's chain (trims -> merge ->
-- audio) and Auto Short's fan-out/fan-in (script -> voice + 4 scenes ->
-- stitch) with one rule.
--
-- States, forward only:
--   PENDING -> CLAIMED -> SUBMITTED -> STORED
--                 |           |
--                 +-----------+--> FAILED   (or back to PENDING to retry,
--                                             at most 2 attempts)
-- CLAIMED exists so two webhooks finishing a stage at the same moment
-- cannot both submit the next step: job_steps_claim_ready hands each ready
-- step to exactly one caller.
--
-- The parent keeps its existing states. It moves DEBITED -> SUBMITTED on
-- the first step submit and gets updated_at bumped on every step
-- transition, so sweep_stuck_jobs (120 min without progress) only ever
-- catches a pipeline that has really stalled. Every function here checks
-- the parent is still DEBITED/SUBMITTED, so a pipeline the sweep has
-- failed and refunded stops instead of storing into a refunded job.
--
-- Service-role only, like webhook_events: RLS forced, no browser policy,
-- explicit revokes on the table and every function. Idempotent throughout.

CREATE TABLE IF NOT EXISTS public.job_steps (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id            UUID        NOT NULL REFERENCES public.jobs(id),
    step              TEXT        NOT NULL CHECK (step IN
                          ('script', 'voice', 'scene', 'stitch', 'trim', 'merge', 'audio')),
    stage             SMALLINT    NOT NULL CHECK (stage BETWEEN 0 AND 20),
    ordinal           SMALLINT    NOT NULL DEFAULT 0 CHECK (ordinal BETWEEN 0 AND 50),
    provider          TEXT        NOT NULL,
    provider_endpoint TEXT        NOT NULL,
    params            JSONB       NOT NULL DEFAULT '{}'::jsonb,
    provider_job_id   TEXT,
    state             TEXT        NOT NULL DEFAULT 'PENDING'
                          CHECK (state IN ('PENDING', 'CLAIMED', 'SUBMITTED', 'STORED', 'FAILED')),
    attempts          SMALLINT    NOT NULL DEFAULT 0,
    claimed_at        TIMESTAMPTZ,
    submitted_at      TIMESTAMPTZ,
    output_r2_key     TEXT,
    output_mime       TEXT,
    output_size       BIGINT,
    output_sha256     TEXT,
    output_text       JSONB,
    error_code        TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (job_id, stage, ordinal)
);

CREATE UNIQUE INDEX IF NOT EXISTS job_steps_provider_job
    ON public.job_steps (provider, provider_job_id) WHERE provider_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS job_steps_job ON public.job_steps (job_id, stage);
CREATE INDEX IF NOT EXISTS job_steps_inflight ON public.job_steps (state, updated_at)
    WHERE state IN ('CLAIMED', 'SUBMITTED');

ALTER TABLE public.job_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_steps FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_steps FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.job_steps TO service_role;

-- ---------------------------------------------------------------------------
-- Internal: the parent must still be live, and every transition touches it.
CREATE OR REPLACE FUNCTION public.job_steps_touch_parent(p_job_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_ok BOOLEAN;
BEGIN
    UPDATE public.jobs SET updated_at = now()
    WHERE id = p_job_id AND state IN ('DEBITED', 'SUBMITTED')
    RETURNING true INTO v_ok;
    RETURN COALESCE(v_ok, false);
END $$;

-- ---------------------------------------------------------------------------
-- 1. Create the plan. p_steps: [{step, stage, ordinal, provider,
--    provider_endpoint, params}]. Only on a DEBITED parent with no steps
--    yet; a replay returns the existing plan unchanged.
CREATE OR REPLACE FUNCTION public.job_steps_create(p_job_id UUID, p_steps JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_state TEXT;
    v_n INTEGER;
BEGIN
    SELECT state::text INTO v_state FROM public.jobs WHERE id = p_job_id FOR UPDATE;
    IF v_state IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'JOB_NOT_FOUND');
    END IF;

    SELECT count(*) INTO v_n FROM public.job_steps WHERE job_id = p_job_id;
    IF v_n > 0 THEN
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'steps', v_n);
    END IF;

    IF v_state <> 'DEBITED' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'JOB_BAD_STATE');
    END IF;
    IF jsonb_typeof(p_steps) <> 'array' OR jsonb_array_length(p_steps) = 0
       OR jsonb_array_length(p_steps) > 40 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BAD_PLAN');
    END IF;
    -- Stages must start at 0 and have no gaps, or a stage could never become ready.
    IF (SELECT min((s->>'stage')::int) FROM jsonb_array_elements(p_steps) s) <> 0
       OR (SELECT count(DISTINCT (s->>'stage')::int) FROM jsonb_array_elements(p_steps) s)
          <> (SELECT max((s->>'stage')::int) + 1 FROM jsonb_array_elements(p_steps) s) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BAD_PLAN');
    END IF;

    INSERT INTO public.job_steps (job_id, step, stage, ordinal, provider, provider_endpoint, params)
    SELECT p_job_id, s->>'step', (s->>'stage')::smallint, COALESCE((s->>'ordinal')::smallint, 0),
           s->>'provider', s->>'provider_endpoint', COALESCE(s->'params', '{}'::jsonb)
    FROM jsonb_array_elements(p_steps) s;

    RETURN jsonb_build_object('ok', true, 'steps', jsonb_array_length(p_steps));
EXCEPTION WHEN check_violation OR not_null_violation OR unique_violation OR invalid_text_representation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_PLAN');
END $$;

-- ---------------------------------------------------------------------------
-- 2. Claim every step that is ready now: PENDING, and every step of an
--    earlier stage STORED. Each ready step goes to exactly one caller.
--    Also reports whether the whole plan is STORED (time to finalise).
CREATE OR REPLACE FUNCTION public.job_steps_claim_ready(p_job_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_claimed JSONB;
    v_open INTEGER;
    v_failed INTEGER;
BEGIN
    IF NOT public.job_steps_touch_parent(p_job_id) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'JOB_NOT_LIVE');
    END IF;

    SELECT count(*) FILTER (WHERE state = 'FAILED'),
           count(*) FILTER (WHERE state <> 'STORED')
    INTO v_failed, v_open
    FROM public.job_steps WHERE job_id = p_job_id;

    IF v_failed > 0 THEN
        RETURN jsonb_build_object('ok', true, 'claimed', '[]'::jsonb, 'failed', true, 'complete', false);
    END IF;

    WITH ready AS (
        SELECT s.id FROM public.job_steps s
        WHERE s.job_id = p_job_id
          AND s.state = 'PENDING'
          AND NOT EXISTS (SELECT 1 FROM public.job_steps e
                          WHERE e.job_id = s.job_id AND e.stage < s.stage AND e.state <> 'STORED')
        FOR UPDATE SKIP LOCKED
    ), upd AS (
        UPDATE public.job_steps s
        SET state = 'CLAIMED', claimed_at = now(), updated_at = now()
        FROM ready WHERE s.id = ready.id
        RETURNING s.id, s.step, s.stage, s.ordinal, s.provider, s.provider_endpoint, s.params, s.attempts
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(upd) ORDER BY upd.stage, upd.ordinal), '[]'::jsonb)
    INTO v_claimed FROM upd;

    RETURN jsonb_build_object('ok', true, 'claimed', v_claimed, 'failed', false, 'complete', v_open = 0);
END $$;

-- ---------------------------------------------------------------------------
-- 3. A claimed step was accepted by its provider. Moves the parent
--    DEBITED -> SUBMITTED on the first submit.
CREATE OR REPLACE FUNCTION public.job_step_submitted(p_step_id UUID, p_provider_job_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_job UUID;
BEGIN
    UPDATE public.job_steps
    SET state = 'SUBMITTED', provider_job_id = p_provider_job_id, attempts = attempts + 1,
        submitted_at = now(), updated_at = now()
    WHERE id = p_step_id AND state = 'CLAIMED'
    RETURNING job_id INTO v_job;

    IF v_job IS NULL THEN
        IF EXISTS (SELECT 1 FROM public.job_steps WHERE id = p_step_id
                   AND provider_job_id = p_provider_job_id AND state IN ('SUBMITTED', 'STORED')) THEN
            RETURN jsonb_build_object('ok', true, 'idempotent', true);
        END IF;
        RETURN jsonb_build_object('ok', false, 'code', 'STEP_BAD_STATE');
    END IF;

    UPDATE public.jobs SET state = 'SUBMITTED', updated_at = now()
    WHERE id = v_job AND state = 'DEBITED';
    PERFORM public.job_steps_touch_parent(v_job);
    RETURN jsonb_build_object('ok', true, 'job_id', v_job);
END $$;

-- ---------------------------------------------------------------------------
-- 4. A step's output is in R2. Matched by (provider, provider_job_id), never
--    by anything in the callback payload. A replay for a STORED step is a
--    no-op that still returns the job id so the caller can re-drive.
CREATE OR REPLACE FUNCTION public.job_step_stored(
    p_provider TEXT, p_provider_job_id TEXT,
    p_r2_key TEXT, p_mime TEXT, p_size BIGINT, p_sha256 TEXT, p_output_text JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_step RECORD;
BEGIN
    SELECT id, job_id, state INTO v_step FROM public.job_steps
    WHERE provider = p_provider AND provider_job_id = p_provider_job_id
    FOR UPDATE;

    IF v_step.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'STEP_NOT_FOUND');
    END IF;
    IF v_step.state = 'STORED' THEN
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'job_id', v_step.job_id);
    END IF;
    IF v_step.state <> 'SUBMITTED' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'STEP_BAD_STATE', 'job_id', v_step.job_id);
    END IF;
    IF NOT public.job_steps_touch_parent(v_step.job_id) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'JOB_NOT_LIVE', 'job_id', v_step.job_id);
    END IF;

    UPDATE public.job_steps
    SET state = 'STORED', output_r2_key = p_r2_key, output_mime = p_mime, output_size = p_size,
        output_sha256 = p_sha256, output_text = p_output_text, error_code = NULL, updated_at = now()
    WHERE id = v_step.id;

    RETURN jsonb_build_object('ok', true, 'job_id', v_step.job_id);
END $$;

-- ---------------------------------------------------------------------------
-- 5. A step failed. Retryable and under 2 attempts: back to PENDING with
--    its provider id cleared, so a late callback for the dead attempt
--    matches nothing. Otherwise the step and the parent are FAILED and the
--    caller refunds the parent through ledger_refund (idempotent per job).
--    Identified by step id: a submit that never got a provider id fails too.
CREATE OR REPLACE FUNCTION public.job_step_failed(p_step_id UUID, p_error_code TEXT, p_retryable BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_step RECORD;
    v_parent RECORD;
BEGIN
    SELECT id, job_id, state, attempts INTO v_step FROM public.job_steps WHERE id = p_step_id FOR UPDATE;
    IF v_step.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'STEP_NOT_FOUND');
    END IF;
    IF v_step.state IN ('STORED', 'PENDING') THEN
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'job_id', v_step.job_id);
    END IF;

    IF v_step.state IN ('CLAIMED', 'SUBMITTED') AND p_retryable AND v_step.attempts < 2
       AND public.job_steps_touch_parent(v_step.job_id) THEN
        UPDATE public.job_steps
        SET state = 'PENDING', provider_job_id = NULL, claimed_at = NULL, submitted_at = NULL,
            error_code = left(p_error_code, 128), updated_at = now()
        WHERE id = v_step.id;
        RETURN jsonb_build_object('ok', true, 'retry', true, 'job_id', v_step.job_id);
    END IF;

    UPDATE public.job_steps
    SET state = 'FAILED', error_code = left(p_error_code, 128), updated_at = now()
    WHERE id = v_step.id AND state <> 'FAILED';

    UPDATE public.jobs
    SET state = 'FAILED', error_code = left('step_' || COALESCE(p_error_code, 'failed'), 128), updated_at = now()
    WHERE id = v_step.job_id AND state IN ('DEBITED', 'SUBMITTED');

    SELECT id, user_id, credits INTO v_parent FROM public.jobs WHERE id = v_step.job_id;
    RETURN jsonb_build_object('ok', true, 'retry', false, 'job_id', v_parent.id,
                              'user_id', v_parent.user_id, 'credits', v_parent.credits);
END $$;

-- ---------------------------------------------------------------------------
-- 6. Every step STORED: the last stage's single step is the result. Parent
--    SUBMITTED -> STORED and its asset row, as job_stored does for a
--    single-provider job.
CREATE OR REPLACE FUNCTION public.job_composite_stored(p_job_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_final RECORD;
    v_asset UUID;
    v_open INTEGER;
    v_state TEXT;
BEGIN
    SELECT state::text INTO v_state FROM public.jobs WHERE id = p_job_id FOR UPDATE;
    IF v_state = 'STORED' THEN
        SELECT id INTO v_asset FROM public.assets WHERE job_id = p_job_id LIMIT 1;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'asset_id', v_asset);
    END IF;
    IF v_state IS DISTINCT FROM 'SUBMITTED' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'JOB_NOT_LIVE');
    END IF;

    SELECT count(*) INTO v_open FROM public.job_steps WHERE job_id = p_job_id AND state <> 'STORED';
    IF v_open > 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'STEPS_OPEN');
    END IF;

    SELECT output_r2_key, output_mime, output_size, output_sha256 INTO v_final
    FROM public.job_steps WHERE job_id = p_job_id
    ORDER BY stage DESC, ordinal DESC LIMIT 1;
    IF v_final.output_r2_key IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NO_OUTPUT');
    END IF;

    UPDATE public.jobs SET state = 'STORED', updated_at = now() WHERE id = p_job_id;
    INSERT INTO public.assets (job_id, r2_key, mime_type, size_bytes, sha256)
    VALUES (p_job_id, v_final.output_r2_key, v_final.output_mime, v_final.output_size, v_final.output_sha256)
    ON CONFLICT (r2_key) DO NOTHING
    RETURNING id INTO v_asset;
    IF v_asset IS NULL THEN
        SELECT id INTO v_asset FROM public.assets WHERE r2_key = v_final.output_r2_key;
    END IF;

    RETURN jsonb_build_object('ok', true, 'asset_id', v_asset);
END $$;

-- ---------------------------------------------------------------------------
-- 7. Sweep companion. Frees steps stranded in CLAIMED (a worker died
--    between claim and submit) and lists SUBMITTED steps past their
--    timeout for the app to re-poll at the provider. Returns the parents
--    that have work, so the app can re-drive them.
CREATE OR REPLACE FUNCTION public.job_steps_due(
    p_submitted_minutes INTEGER DEFAULT 12,
    p_claimed_minutes INTEGER DEFAULT 5,
    p_limit INTEGER DEFAULT 100
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_released INTEGER;
    v_stale JSONB;
    v_jobs JSONB;
BEGIN
    WITH freed AS (
        UPDATE public.job_steps SET state = 'PENDING', claimed_at = NULL, updated_at = now()
        WHERE state = 'CLAIMED' AND claimed_at < now() - make_interval(mins => p_claimed_minutes)
        RETURNING 1
    ) SELECT count(*) INTO v_released FROM freed;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'step_id', s.id, 'job_id', s.job_id, 'provider', s.provider,
               'provider_endpoint', s.provider_endpoint, 'provider_job_id', s.provider_job_id,
               'attempts', s.attempts)), '[]'::jsonb)
    INTO v_stale
    FROM (SELECT * FROM public.job_steps
          WHERE state = 'SUBMITTED' AND submitted_at < now() - make_interval(mins => p_submitted_minutes)
          ORDER BY submitted_at LIMIT p_limit) s;

    SELECT COALESCE(jsonb_agg(DISTINCT s.job_id), '[]'::jsonb) INTO v_jobs
    FROM public.job_steps s JOIN public.jobs j ON j.id = s.job_id
    WHERE s.state = 'PENDING' AND j.state IN ('DEBITED', 'SUBMITTED');

    RETURN jsonb_build_object('ok', true, 'released', v_released, 'stale', v_stale, 'redrive', v_jobs);
END $$;

-- ---------------------------------------------------------------------------
DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.job_steps_touch_parent(UUID)',
        'public.job_steps_create(UUID, JSONB)',
        'public.job_steps_claim_ready(UUID)',
        'public.job_step_submitted(UUID, TEXT)',
        'public.job_step_stored(TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, JSONB)',
        'public.job_step_failed(UUID, TEXT, BOOLEAN)',
        'public.job_composite_stored(UUID)',
        'public.job_steps_due(INTEGER, INTEGER, INTEGER)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END $$;
