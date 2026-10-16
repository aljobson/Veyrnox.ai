-- Provider-specific spend and ambiguous-submit guards.
--
-- 0327 provides a strict global supplier budget. This adds a lower budget for
-- GrsAI itself ($1 rolling hour / $5 UTC day), and $10/hour / $25/day for
-- fal, KIE and OpenRouter, so no single production key can consume the broader
-- $250 daily supplier allowance. Chat and Help have separate OpenRouter keys
-- and policy rows. Reservations are still irreversible: refunds never reopen
-- wholesale budget.
--
-- A lost submit acknowledgement is financially ambiguous. The Worker keeps
-- the customer debit and annotates the job. The stuck-job sweep must not later
-- refund that job while the supplier may also have accepted and billed it. A
-- service-only reconciliation RPC resolves it after checking the supplier.

CREATE TABLE IF NOT EXISTS public.provider_spend_provider_policy (
    provider TEXT PRIMARY KEY CHECK (provider ~ '^[A-Za-z0-9._:-]{2,64}$'),
    admission_open BOOLEAN NOT NULL DEFAULT true,
    hour_microusd BIGINT NOT NULL CHECK (hour_microusd > 0),
    day_microusd BIGINT NOT NULL CHECK (day_microusd >= hour_microusd),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.provider_spend_provider_policy(provider, admission_open, hour_microusd, day_microusd)
VALUES ('grsai', true, 1000000, 5000000),
       ('fal', true, 10000000, 25000000),
       ('kie', true, 10000000, 25000000),
       ('openrouter', true, 10000000, 25000000),
       ('openrouter-chat', true, 10000000, 25000000),
       ('openrouter-help', true, 1000000, 5000000)
ON CONFLICT (provider) DO NOTHING;

CREATE INDEX IF NOT EXISTS provider_spend_reservations_provider_hour_idx
    ON public.provider_spend_reservations(provider, admitted_at);

ALTER TABLE public.provider_spend_provider_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_spend_provider_policy FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.provider_spend_provider_policy FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.provider_spend_reserve(
    p_user_id UUID, p_effect_key TEXT, p_model_id TEXT,
    p_provider TEXT, p_purpose TEXT, p_cost_microusd BIGINT
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_policy public.provider_spend_policy%ROWTYPE;
    v_provider_policy public.provider_spend_provider_policy%ROWTYPE;
    v_existing public.provider_spend_reservations%ROWTYPE;
    v_now TIMESTAMPTZ := statement_timestamp();
    v_day_start TIMESTAMPTZ := date_trunc('day', statement_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    v_user_hour BIGINT;
    v_user_day BIGINT;
    v_provider_hour BIGINT;
    v_provider_day BIGINT;
    v_global_hour BIGINT;
    v_global_day BIGINT;
    v_retry INTEGER;
    v_has_provider_policy BOOLEAN := false;
BEGIN
    IF p_user_id IS NULL OR p_effect_key IS NULL OR p_effect_key !~ '^[A-Za-z0-9._:-]{8,160}$'
       OR p_provider IS NULL OR p_provider !~ '^[A-Za-z0-9._:-]{2,64}$'
       OR p_purpose IS NULL OR p_purpose !~ '^[a-z0-9._:-]{2,64}$'
       OR p_cost_microusd IS NULL OR p_cost_microusd <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PROVIDER_SPEND_INVALID');
    END IF;

    SELECT * INTO v_existing FROM public.provider_spend_reservations
     WHERE user_id = p_user_id AND effect_key = p_effect_key;
    IF FOUND THEN
        IF v_existing.model_id IS DISTINCT FROM p_model_id
           OR v_existing.provider IS DISTINCT FROM p_provider
           OR v_existing.purpose IS DISTINCT FROM p_purpose
           OR v_existing.estimated_cost_microusd IS DISTINCT FROM p_cost_microusd THEN
            RETURN jsonb_build_object('ok', false, 'code', 'PROVIDER_SPEND_CONFLICT');
        END IF;
        RETURN jsonb_build_object('ok', true, 'idempotent', true,
            'estimated_cost_microusd', v_existing.estimated_cost_microusd);
    END IF;

    -- Preserve 0327's one-row global serialization boundary, then lock an
    -- optional provider row in a fixed order. Missing rows inherit only the
    -- global policy; configured providers fail closed when admission is off.
    SELECT * INTO v_policy FROM public.provider_spend_policy WHERE singleton FOR UPDATE;
    IF NOT FOUND OR NOT v_policy.admission_open THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PROVIDER_SPEND_UNAVAILABLE',
            'scope', 'closed', 'retry_after_seconds', 60);
    END IF;
    SELECT * INTO v_provider_policy FROM public.provider_spend_provider_policy
     WHERE provider = p_provider FOR UPDATE;
    v_has_provider_policy := FOUND;
    IF v_has_provider_policy AND NOT v_provider_policy.admission_open THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PROVIDER_SPEND_UNAVAILABLE',
            'scope', 'closed', 'retry_after_seconds', 60);
    END IF;
    IF p_cost_microusd > v_policy.max_job_microusd THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PROVIDER_SPEND_LIMIT',
            'scope', 'single', 'retry_after_seconds', 3600);
    END IF;

    SELECT COALESCE(sum(estimated_cost_microusd), 0) INTO v_global_hour
      FROM public.provider_spend_reservations WHERE admitted_at > v_now - interval '1 hour';
    SELECT COALESCE(sum(estimated_cost_microusd), 0) INTO v_global_day
      FROM public.provider_spend_reservations WHERE admitted_at >= v_day_start;
    SELECT COALESCE(sum(estimated_cost_microusd), 0) INTO v_user_hour
      FROM public.provider_spend_reservations
     WHERE user_id = p_user_id AND admitted_at > v_now - interval '1 hour';
    SELECT COALESCE(sum(estimated_cost_microusd), 0) INTO v_user_day
      FROM public.provider_spend_reservations
     WHERE user_id = p_user_id AND admitted_at >= v_day_start;

    IF v_global_hour + p_cost_microusd > v_policy.global_hour_microusd THEN
        SELECT GREATEST(1, CEIL(EXTRACT(epoch FROM (min(admitted_at) + interval '1 hour' - v_now))))::integer
          INTO v_retry FROM public.provider_spend_reservations WHERE admitted_at > v_now - interval '1 hour';
        RETURN jsonb_build_object('ok', false, 'code', 'PROVIDER_SPEND_LIMIT', 'scope', 'global_hour',
            'retry_after_seconds', COALESCE(v_retry, 60));
    END IF;
    IF v_global_day + p_cost_microusd > v_policy.global_day_microusd THEN
        v_retry := GREATEST(1, CEIL(EXTRACT(epoch FROM (v_day_start + interval '1 day' - v_now))))::integer;
        RETURN jsonb_build_object('ok', false, 'code', 'PROVIDER_SPEND_LIMIT', 'scope', 'global_day',
            'retry_after_seconds', v_retry);
    END IF;
    IF v_has_provider_policy THEN
        SELECT COALESCE(sum(estimated_cost_microusd), 0) INTO v_provider_hour
          FROM public.provider_spend_reservations
         WHERE provider = p_provider AND admitted_at > v_now - interval '1 hour';
        SELECT COALESCE(sum(estimated_cost_microusd), 0) INTO v_provider_day
          FROM public.provider_spend_reservations
         WHERE provider = p_provider AND admitted_at >= v_day_start;
        IF v_provider_hour + p_cost_microusd > v_provider_policy.hour_microusd THEN
            SELECT GREATEST(1, CEIL(EXTRACT(epoch FROM (min(admitted_at) + interval '1 hour' - v_now))))::integer
              INTO v_retry FROM public.provider_spend_reservations
             WHERE provider = p_provider AND admitted_at > v_now - interval '1 hour';
            RETURN jsonb_build_object('ok', false, 'code', 'PROVIDER_SPEND_LIMIT', 'scope', 'provider_hour',
                'retry_after_seconds', COALESCE(v_retry, 60));
        END IF;
        IF v_provider_day + p_cost_microusd > v_provider_policy.day_microusd THEN
            v_retry := GREATEST(1, CEIL(EXTRACT(epoch FROM (v_day_start + interval '1 day' - v_now))))::integer;
            RETURN jsonb_build_object('ok', false, 'code', 'PROVIDER_SPEND_LIMIT', 'scope', 'provider_day',
                'retry_after_seconds', v_retry);
        END IF;
    END IF;
    IF v_user_hour + p_cost_microusd > v_policy.user_hour_microusd THEN
        SELECT GREATEST(1, CEIL(EXTRACT(epoch FROM (min(admitted_at) + interval '1 hour' - v_now))))::integer
          INTO v_retry FROM public.provider_spend_reservations
         WHERE user_id = p_user_id AND admitted_at > v_now - interval '1 hour';
        RETURN jsonb_build_object('ok', false, 'code', 'PROVIDER_SPEND_LIMIT', 'scope', 'user_hour',
            'retry_after_seconds', COALESCE(v_retry, 60));
    END IF;
    IF v_user_day + p_cost_microusd > v_policy.user_day_microusd THEN
        v_retry := GREATEST(1, CEIL(EXTRACT(epoch FROM (v_day_start + interval '1 day' - v_now))))::integer;
        RETURN jsonb_build_object('ok', false, 'code', 'PROVIDER_SPEND_LIMIT', 'scope', 'user_day',
            'retry_after_seconds', v_retry);
    END IF;

    INSERT INTO public.provider_spend_reservations
        (user_id, effect_key, model_id, provider, purpose, estimated_cost_microusd, admitted_at)
    VALUES (p_user_id, p_effect_key, p_model_id, p_provider, p_purpose, p_cost_microusd, v_now);
    RETURN jsonb_build_object('ok', true, 'idempotent', false,
        'estimated_cost_microusd', p_cost_microusd);
END $$;

REVOKE ALL ON FUNCTION private.provider_spend_reserve(UUID,TEXT,TEXT,TEXT,TEXT,BIGINT) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reconcile_provider_submit_unknown(
    p_job_id UUID, p_outcome TEXT, p_provider_job_id TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job public.jobs%ROWTYPE; v_result JSONB;
BEGIN
    IF p_outcome NOT IN ('ACCEPTED','REJECTED')
       OR (p_outcome = 'ACCEPTED' AND (p_provider_job_id IS NULL OR p_provider_job_id !~ '^[A-Za-z0-9._-]{1,128}$'))
       OR (p_outcome = 'REJECTED' AND p_provider_job_id IS NOT NULL) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_OUTCOME');
    END IF;
    SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
    IF NOT FOUND OR v_job.state <> 'DEBITED' OR v_job.error_code IS DISTINCT FROM 'provider_outcome_unknown'
       OR NOT EXISTS (SELECT 1 FROM public.provider_spend_reservations r
                      WHERE r.user_id = v_job.user_id AND r.effect_key = v_job.idempotency_key
                        AND r.provider IN ('grsai','fal','kie','openrouter')) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'JOB_NOT_RECONCILABLE');
    END IF;
    IF p_outcome = 'ACCEPTED' THEN
        v_result := public.job_submitted(v_job.id, (
            SELECT r.provider FROM public.provider_spend_reservations r
             WHERE r.user_id = v_job.user_id AND r.effect_key = v_job.idempotency_key
               AND r.provider IN ('grsai','fal','kie','openrouter')
        ), p_provider_job_id);
        IF v_result->>'ok' = 'true' THEN
            UPDATE public.jobs SET error_code = NULL WHERE id = v_job.id;
        END IF;
        RETURN v_result;
    END IF;
    UPDATE public.jobs SET error_code = 'provider_submit_failed', updated_at = now() WHERE id = v_job.id;
    v_result := public.ledger_refund(v_job.id, v_job.user_id, v_job.credits, 'refund:submit_rejected_reconciled');
    RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.reconcile_provider_submit_unknown(UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_provider_submit_unknown(UUID,TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.sweep_stuck_jobs(
    p_debited_minutes INTEGER DEFAULT 15,
    p_submitted_minutes INTEGER DEFAULT 120,
    p_limit INTEGER DEFAULT 200,
    p_succeeded_minutes INTEGER DEFAULT 60
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_job RECORD; v_refunded INTEGER := 0; v_failed INTEGER := 0;
    v_unstored INTEGER := 0; v_unpaid INTEGER := 0; v_res JSONB;
BEGIN
    FOR v_job IN
        SELECT j.id, j.user_id, j.credits, j.state
        FROM public.jobs j
        WHERE (j.state = 'DEBITED'
               AND j.updated_at < now() - make_interval(mins => p_debited_minutes)
               AND NOT (j.error_code = 'provider_outcome_unknown' AND EXISTS (
                   SELECT 1 FROM public.provider_spend_reservations r
                    WHERE r.user_id = j.user_id AND r.effect_key = j.idempotency_key
                      AND r.provider IN ('grsai','fal','kie','openrouter'))))
           OR (j.state IN ('SUBMITTED', 'FAILOVER') AND j.updated_at < now() - make_interval(mins => p_submitted_minutes))
           OR (j.state = 'SUCCEEDED' AND j.updated_at < now() - make_interval(mins => p_succeeded_minutes)
               AND NOT EXISTS (SELECT 1 FROM public.assets a WHERE a.job_id = j.id))
           OR (j.state = 'FAILED' AND j.credits > 0
               AND j.updated_at < now() - make_interval(mins => p_debited_minutes)
               AND NOT EXISTS (SELECT 1 FROM public.ledger_entries le WHERE le.job_id = j.id AND le.delta > 0))
        ORDER BY j.updated_at LIMIT p_limit FOR UPDATE OF j SKIP LOCKED
    LOOP
        IF v_job.state IN ('SUBMITTED', 'FAILOVER') THEN
            UPDATE public.jobs SET state = 'FAILED', error_code = 'stuck_timeout', updated_at = now() WHERE id = v_job.id;
            v_failed := v_failed + 1;
        ELSIF v_job.state = 'SUCCEEDED' THEN
            UPDATE public.jobs SET state = 'FAILED', error_code = 'asset_store_failed', updated_at = now() WHERE id = v_job.id;
            v_unstored := v_unstored + 1;
        ELSIF v_job.state = 'FAILED' THEN
            v_unpaid := v_unpaid + 1;
        END IF;
        v_res := public.ledger_refund(v_job.id, v_job.user_id, v_job.credits,
            CASE v_job.state WHEN 'DEBITED' THEN 'refund:stuck_debited'
                WHEN 'SUCCEEDED' THEN 'refund:asset_store_failed'
                WHEN 'FAILED' THEN 'refund:failed_unpaid' ELSE 'refund:stuck_submitted' END);
        IF (v_res->>'ok')::boolean AND NOT COALESCE((v_res->>'idempotent')::boolean, false) THEN
            v_refunded := v_refunded + 1;
        END IF;
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'failed', v_failed, 'unstored', v_unstored,
                              'unpaid_failures', v_unpaid, 'refunded', v_refunded);
END $$;

REVOKE ALL ON FUNCTION public.sweep_stuck_jobs(INTEGER,INTEGER,INTEGER,INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_stuck_jobs(INTEGER,INTEGER,INTEGER,INTEGER) TO service_role;
