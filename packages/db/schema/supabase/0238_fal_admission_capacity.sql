-- ADR-0079 first slice: local-account durable-image reservations, default deny.
-- No live policy activation; legacy/multi-step producers are not covered yet.
CREATE TABLE IF NOT EXISTS public.fal_capacity_policy (
    singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
    enabled BOOLEAN NOT NULL DEFAULT false,
    provider_account TEXT CHECK (provider_account ~ '^[A-Za-z0-9._-]{1,128}$'),
    model_id TEXT NOT NULL DEFAULT 'flux-2-pro' REFERENCES public.model_catalog(id),
    outstanding_limit INTEGER NOT NULL DEFAULT 2 CHECK (outstanding_limit BETWEEN 1 AND 2),
    daily_limit INTEGER NOT NULL DEFAULT 10 CHECK (daily_limit BETWEEN 1 AND 10),
    daily_budget_microusd INTEGER NOT NULL DEFAULT 300000 CHECK (daily_budget_microusd BETWEEN 1 AND 300000),
    CHECK (NOT enabled OR provider_account IS NOT NULL)
);
INSERT INTO public.fal_capacity_policy(singleton) VALUES (true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.fal_capacity_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID UNIQUE REFERENCES public.fal_dispatch(job_id) ON DELETE SET NULL,
    admission_day DATE NOT NULL,
    cost_microusd INTEGER NOT NULL CHECK (cost_microusd = 30000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    released_at TIMESTAMPTZ,
    release_reason TEXT CHECK (release_reason IN ('REJECTED','NOT_SUBMITTED','STORED')),
    CHECK ((released_at IS NULL) = (release_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS fal_capacity_held_idx ON public.fal_capacity_reservations(created_at) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS fal_capacity_day_idx ON public.fal_capacity_reservations(admission_day);
ALTER TABLE public.fal_capacity_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fal_capacity_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fal_capacity_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fal_capacity_reservations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.fal_capacity_policy, public.fal_capacity_reservations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.fal_capacity_policy, public.fal_capacity_reservations TO service_role;

-- Terminal evidence is monotonic. This only locks reservation rows, never job,
-- balance, outbox or pool rows, so it cannot invert existing refund lock order.
-- UNKNOWN/refunded/FAILED alone never frees a slot. Exposure is never returned
-- in this conservative slice, even for rejection or pre-submission closure.
CREATE OR REPLACE FUNCTION public.release_fal_capacity(p_limit INTEGER DEFAULT 25)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count INTEGER;
BEGIN
    WITH eligible AS (
        SELECT r.job_id, CASE WHEN d.state = 'REJECTED' THEN 'REJECTED'
            WHEN d.state = 'CLOSED' THEN 'NOT_SUBMITTED' ELSE 'STORED' END AS reason
        FROM public.fal_capacity_reservations r
        JOIN public.fal_dispatch d ON d.job_id = r.job_id
        JOIN public.jobs j ON j.id = r.job_id
        WHERE r.released_at IS NULL AND (
            d.state = 'REJECTED'
            OR (d.state = 'CLOSED' AND d.attempt_token IS NULL)
            OR (d.state = 'ACCEPTED' AND j.state = 'STORED'
                AND d.provider_job_id IS NOT NULL AND j.provider = 'fal'
                AND j.provider_job_id = d.provider_job_id))
        ORDER BY r.created_at, r.job_id
        LIMIT GREATEST(1, LEAST(COALESCE(p_limit,25),25))
    )
    UPDATE public.fal_capacity_reservations r SET released_at = now(), release_reason = e.reason
    FROM eligible e WHERE r.job_id = e.job_id AND r.released_at IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.release_fal_capacity(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_fal_capacity(INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.admit_fal_dispatch(
    p_user_id UUID, p_idempotency_key TEXT, p_model_id TEXT, p_inputs JSONB,
    p_payload JSONB, p_endpoint TEXT, p_allow_free BOOLEAN DEFAULT false
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_job public.jobs%ROWTYPE;
    v_model public.model_catalog%ROWTYPE;
    v_result JSONB;
    v_balance INTEGER;
    v_policy public.fal_capacity_policy%ROWTYPE;
    v_day DATE := (statement_timestamp() AT TIME ZONE 'UTC')::date;
    v_held BIGINT; v_untracked BIGINT; v_daily BIGINT; v_cost BIGINT;
BEGIN
    IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,128}$'
       OR p_inputs IS NULL OR jsonb_typeof(p_inputs) <> 'object' OR octet_length(p_inputs::text) > 16384
       OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' OR octet_length(p_payload::text) > 16384
       OR p_inputs ?| ARRAY['source_keys','source_assets','edit'] THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    -- Same serialization boundary as ledger_debit and submit_free_job. A replay
    -- never locks/changes the old job, and never upgrades a legacy job into dispatch.
    SELECT balance - CASE WHEN subscription_expires_at > now() THEN 0 ELSE subscription_balance END
    INTO v_balance FROM public.credit_balances WHERE user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NO_BALANCE_ROW'); END IF;
    SELECT * INTO v_job FROM public.jobs WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_job.model_id IS DISTINCT FROM p_model_id OR v_job.inputs IS DISTINCT FROM p_inputs
           OR EXISTS (SELECT 1 FROM public.fal_dispatch d WHERE d.job_id = v_job.id
                      AND (d.payload IS DISTINCT FROM CASE WHEN EXISTS (
                          SELECT 1 FROM public.fal_capacity_reservations r WHERE r.job_id = v_job.id)
                          THEN p_payload || '{"image_size":{"width":1024,"height":768}}'::jsonb
                          ELSE p_payload END
                          OR (EXISTS (SELECT 1 FROM public.fal_capacity_reservations r WHERE r.job_id = v_job.id)
                              AND p_payload - ARRAY['prompt','seed'] <> '{}'::jsonb) OR d.endpoint IS DISTINCT FROM p_endpoint)) THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
        END IF;
        RETURN jsonb_build_object('ok', true, 'job_id', v_job.id, 'idempotent', true,
            'state', v_job.state, 'free', v_job.free_allowance, 'balance_after', v_balance);
    END IF;
    SELECT * INTO v_model FROM public.model_catalog WHERE id = p_model_id FOR SHARE;
    IF NOT FOUND OR NOT v_model.active OR v_model.gated_flag OR v_model.provider <> 'fal'
       OR v_model.modality <> 'text-to-image' OR v_model.provider_endpoint IS DISTINCT FROM p_endpoint
       OR v_model.credits_5s IS NULL OR v_model.credits_5s <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'MODEL_UNAVAILABLE');
    END IF;
    -- Existing replay above remains valid even when this policy is paused.
    -- This helper holds no job/balance locks; completed reservations can drain.
    PERFORM public.release_fal_capacity(25);
    SELECT * INTO v_policy FROM public.fal_capacity_policy WHERE singleton FOR UPDATE;
    IF NOT FOUND OR NOT v_policy.enabled THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PROVIDER_ADMISSION_PAUSED', 'retry_after_seconds', 60);
    END IF;
    IF p_model_id IS DISTINCT FROM v_policy.model_id OR p_endpoint <> 'fal-ai/flux-2-pro'
       OR v_model.provider_cost_per_unit IS DISTINCT FROM 0.03::numeric
       OR p_payload - ARRAY['prompt','seed'] <> '{}'::jsonb
       OR jsonb_typeof(p_payload->'prompt') IS DISTINCT FROM 'string'
       OR btrim(p_payload->>'prompt') = '' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'MODEL_UNAVAILABLE');
    END IF;
    SELECT count(*) INTO v_held FROM public.fal_capacity_reservations WHERE released_at IS NULL;
    -- Older outbox work is not grandfathered out of the admission bound.
    SELECT count(*) INTO v_untracked FROM public.fal_dispatch d JOIN public.jobs j ON j.id = d.job_id
    WHERE NOT EXISTS (SELECT 1 FROM public.fal_capacity_reservations r WHERE r.job_id = d.job_id)
      AND (d.state IN ('READY','STARTED','UNKNOWN') OR (d.state = 'ACCEPTED'
          AND NOT (j.state = 'STORED' AND d.provider_job_id IS NOT NULL
              AND j.provider_job_id IS NOT DISTINCT FROM d.provider_job_id)));
    SELECT count(*), COALESCE(sum(cost_microusd),0) INTO v_daily, v_cost
    FROM public.fal_capacity_reservations WHERE admission_day = v_day;
    IF v_held + v_untracked >= v_policy.outstanding_limit OR v_daily >= v_policy.daily_limit
       OR v_cost + 30000 > v_policy.daily_budget_microusd THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PROVIDER_CAPACITY_UNAVAILABLE', 'retry_after_seconds', 60);
    END IF;
    -- Size is pinned by this transaction; only prompt/seed inputs are admitted.
    p_payload := p_payload || '{"image_size":{"width":1024,"height":768}}'::jsonb;
    IF p_allow_free THEN
        v_result := public.submit_free_job(p_user_id, p_idempotency_key, p_model_id, p_inputs, 10, 60);
        IF v_result->>'ok' = 'false' THEN RETURN v_result; END IF;
    END IF;
    IF v_result IS NULL OR v_result->>'taken' IS DISTINCT FROM 'true' THEN
        v_result := public.ledger_debit(p_user_id, p_idempotency_key, v_model.credits_5s,
            'debit:generation', p_model_id, p_inputs, 10, 60);
    END IF;
    IF v_result->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_result; END IF;
    -- Any failure here rolls back the job AND debit/allowance in this RPC.
    INSERT INTO public.fal_dispatch(job_id, endpoint, payload)
    VALUES ((v_result->>'job_id')::uuid, p_endpoint, p_payload);
    INSERT INTO public.fal_capacity_reservations(job_id, admission_day, cost_microusd)
    VALUES ((v_result->>'job_id')::uuid, v_day, 30000);
    SELECT balance - CASE WHEN subscription_expires_at > now() THEN 0 ELSE subscription_balance END
    INTO v_balance FROM public.credit_balances WHERE user_id = p_user_id;
    RETURN v_result || jsonb_build_object('state', 'DEBITED', 'balance_after', v_balance,
        'free', COALESCE((v_result->>'taken')::boolean, false));
END $$;
REVOKE ALL ON FUNCTION public.admit_fal_dispatch(UUID,TEXT,TEXT,JSONB,JSONB,TEXT,BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_fal_dispatch(UUID,TEXT,TEXT,JSONB,JSONB,TEXT,BOOLEAN) TO service_role;
