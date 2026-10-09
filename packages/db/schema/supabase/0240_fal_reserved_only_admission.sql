-- Reserved-only admission when the bounded capacity policy is enabled.
-- No policy change on apply; all earlier defaults and operator values survive.
CREATE OR REPLACE FUNCTION private.fal_admission_paused(p_model_id TEXT, p_reserved BOOLEAN)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_capacity BOOLEAN; v_paused BOOLEAN;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.model_catalog
        WHERE id = p_model_id AND provider IN ('fal','veyrnox')) THEN
        RETURN false;
    END IF;
    -- Balance -> capacity -> admission control matches durable admission.
    -- Policy updates must be standalone transactions with no later job locks.
    SELECT enabled INTO v_capacity FROM public.fal_capacity_policy WHERE singleton FOR SHARE;
    SELECT paused INTO v_paused FROM public.fal_admission_control WHERE singleton FOR SHARE;
    RETURN COALESCE(v_paused, true) OR v_capacity IS NULL
        OR (v_capacity AND NOT COALESCE(p_reserved, false));
END $$;
REVOKE ALL ON FUNCTION private.fal_admission_paused(TEXT,BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.fal_admission_paused(p_model_id TEXT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    SELECT private.fal_admission_paused(p_model_id, false);
$$;
REVOKE ALL ON FUNCTION private.fal_admission_paused(TEXT) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.ledger_debit_for_admission(
    p_user_id UUID,
    p_idempotency_key TEXT,
    p_credits INTEGER,
    p_reason TEXT,
    p_model_id TEXT,
    p_inputs JSONB,
    p_limit_per_window INTEGER DEFAULT 0,
    p_window_seconds INTEGER DEFAULT 60,
    p_reserved BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_existing UUID;
    v_current_balance INTEGER;
    v_free_balance INTEGER;
    v_free_part INTEGER;
    v_sub_balance INTEGER;
    v_sub_expires TIMESTAMPTZ;
    v_sub_cycle INTEGER;
    v_sub_live INTEGER;
    v_sub_part INTEGER;
    v_spendable INTEGER;
    v_new_job_id UUID;
    v_count INTEGER;
    v_reset_seconds INTEGER;
BEGIN
    IF p_credits IS NULL OR p_credits <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CREDITS',
                                   'message', format('credits must be a positive integer (got %s)', p_credits));
    END IF;

    SELECT balance, free_balance, subscription_balance, subscription_expires_at, subscription_cycle
    INTO v_current_balance, v_free_balance, v_sub_balance, v_sub_expires, v_sub_cycle
    FROM public.credit_balances
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF v_current_balance IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NO_BALANCE_ROW',
                                   'message', format('no credit_balances row for user %s', p_user_id));
    END IF;

    -- Subscription Credits past their cycle end are not spendable; the sweep
    -- removes them. Everything below works on what can actually be spent.
    v_sub_live := CASE WHEN v_sub_expires > now() THEN v_sub_balance ELSE 0 END;
    v_spendable := v_current_balance - (v_sub_balance - v_sub_live);

    SELECT id INTO v_existing FROM public.jobs
    WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
    IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'job_id', v_existing,
                                   'idempotent', true, 'balance_after', v_spendable);
    END IF;

    -- Under the balance lock every Freeze also takes, so none races this.
    IF private.fal_admission_paused(p_model_id,p_reserved) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PROVIDER_ADMISSION_PAUSED', 'retry_after_seconds', 60);
    END IF;

    IF EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.frozen_at IS NOT NULL) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN');
    END IF;

    IF p_limit_per_window IS NOT NULL AND p_limit_per_window > 0 THEN
        SELECT count(*) INTO v_count FROM public.jobs
        WHERE user_id = p_user_id
          AND created_at > now() - make_interval(secs => p_window_seconds);
        IF v_count >= p_limit_per_window THEN
            SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
                MIN(created_at) + make_interval(secs => p_window_seconds) - now()
            ))))::int INTO v_reset_seconds
            FROM public.jobs
            WHERE user_id = p_user_id
              AND created_at > now() - make_interval(secs => p_window_seconds);
            RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED',
                                       'count', v_count, 'limit', p_limit_per_window,
                                       'retry_after_seconds', COALESCE(v_reset_seconds, p_window_seconds));
        END IF;
    END IF;

    IF v_spendable < p_credits THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_BALANCE',
                                   'message', format('insufficient balance: have %s, need %s', v_spendable, p_credits),
                                   'balance', v_spendable);
    END IF;

    BEGIN
        INSERT INTO public.jobs (user_id, idempotency_key, model_id, credits, inputs, state)
        VALUES (p_user_id, p_idempotency_key, p_model_id, p_credits, p_inputs, 'DEBITED')
        RETURNING id INTO v_new_job_id;
    EXCEPTION WHEN unique_violation THEN
        SELECT id INTO v_existing FROM public.jobs
        WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
        RETURN jsonb_build_object('ok', true, 'job_id', v_existing,
                                   'idempotent', true, 'balance_after', v_spendable);
    END;

    -- ADR-0064 spend order: Subscription, then Free, then Pack.
    v_sub_part := LEAST(v_sub_live, p_credits);
    v_free_part := LEAST(v_free_balance, p_credits - v_sub_part);

    INSERT INTO public.ledger_entries (user_id, delta, free_delta, subscription_delta, subscription_cycle, reason, job_id)
    VALUES (p_user_id, -p_credits, -v_free_part, -v_sub_part,
            CASE WHEN v_sub_part > 0 THEN v_sub_cycle END, p_reason, v_new_job_id);

    UPDATE public.credit_balances
    SET balance = balance - p_credits, free_balance = free_balance - v_free_part,
        subscription_balance = subscription_balance - v_sub_part, updated_at = now()
    WHERE user_id = p_user_id;

    RETURN jsonb_build_object('ok', true, 'job_id', v_new_job_id,
                               'idempotent', false, 'balance_after', v_spendable - p_credits);
END $$;

REVOKE ALL ON FUNCTION private.ledger_debit_for_admission(UUID,TEXT,INTEGER,TEXT,TEXT,JSONB,INTEGER,INTEGER,BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ledger_debit(
    p_user_id UUID,
    p_idempotency_key TEXT,
    p_credits INTEGER,
    p_reason TEXT,
    p_model_id TEXT,
    p_inputs JSONB,
    p_limit_per_window INTEGER DEFAULT 0,
    p_window_seconds INTEGER DEFAULT 60
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN private.ledger_debit_for_admission(p_user_id,p_idempotency_key,p_credits,p_reason,p_model_id,p_inputs,p_limit_per_window,p_window_seconds,false);
END $$;

REVOKE ALL ON FUNCTION public.ledger_debit(UUID,TEXT,INTEGER,TEXT,TEXT,JSONB,INTEGER,INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ledger_debit(UUID,TEXT,INTEGER,TEXT,TEXT,JSONB,INTEGER,INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION private.submit_free_job_for_admission(
    p_user_id UUID,
    p_idempotency_key TEXT,
    p_model_id TEXT,
    p_inputs JSONB,
    p_limit_per_window INTEGER DEFAULT 0,
    p_window_seconds INTEGER DEFAULT 60,
    p_reserved BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_balance INTEGER;
    v_existing UUID;
    v_count INTEGER;
    v_reset_seconds INTEGER;
    v_take JSONB;
    v_new_job_id UUID;
BEGIN
    -- The same balance lock ledger_debit and every Freeze take, in the same order (balance first, then the
    -- allowance's per-model advisory lock inside free_allowance_take).
    SELECT balance INTO v_balance FROM public.credit_balances WHERE user_id = p_user_id FOR UPDATE;
    IF v_balance IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NO_BALANCE_ROW');
    END IF;

    SELECT id INTO v_existing FROM public.jobs WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
    IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'taken', true, 'job_id', v_existing, 'idempotent', true);
    END IF;

    IF private.fal_admission_paused(p_model_id,p_reserved) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PROVIDER_ADMISSION_PAUSED', 'retry_after_seconds', 60);
    END IF;

    IF EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.frozen_at IS NOT NULL) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN');
    END IF;

    IF p_limit_per_window IS NOT NULL AND p_limit_per_window > 0 THEN
        SELECT count(*) INTO v_count FROM public.jobs
        WHERE user_id = p_user_id AND created_at > now() - make_interval(secs => p_window_seconds);
        IF v_count >= p_limit_per_window THEN
            SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
                MIN(created_at) + make_interval(secs => p_window_seconds) - now()
            ))))::int INTO v_reset_seconds
            FROM public.jobs
            WHERE user_id = p_user_id AND created_at > now() - make_interval(secs => p_window_seconds);
            RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED',
                                       'count', v_count, 'limit', p_limit_per_window,
                                       'retry_after_seconds', COALESCE(v_reset_seconds, p_window_seconds));
        END IF;
    END IF;

    v_take := public.free_allowance_take(p_user_id, p_model_id, p_idempotency_key);
    IF v_take->>'ok' <> 'true' THEN
        RETURN v_take;
    END IF;
    IF v_take->>'taken' <> 'true' THEN
        -- No allowance left (or none offered): write nothing, the caller prices it normally.
        RETURN jsonb_build_object('ok', true, 'taken', false, 'code', v_take->>'code');
    END IF;

    INSERT INTO public.jobs (user_id, idempotency_key, model_id, credits, inputs, state, free_allowance)
    VALUES (p_user_id, p_idempotency_key, p_model_id, 0, p_inputs, 'DEBITED', true)
    RETURNING id INTO v_new_job_id;

    RETURN jsonb_build_object('ok', true, 'taken', true, 'job_id', v_new_job_id, 'idempotent', false,
                               'left', v_take->'left');
END $$;

REVOKE ALL ON FUNCTION private.submit_free_job_for_admission(UUID,TEXT,TEXT,JSONB,INTEGER,INTEGER,BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.submit_free_job(
    p_user_id UUID,
    p_idempotency_key TEXT,
    p_model_id TEXT,
    p_inputs JSONB,
    p_limit_per_window INTEGER DEFAULT 0,
    p_window_seconds INTEGER DEFAULT 60
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN private.submit_free_job_for_admission(p_user_id,p_idempotency_key,p_model_id,p_inputs,p_limit_per_window,p_window_seconds,false);
END $$;

REVOKE ALL ON FUNCTION public.submit_free_job(UUID,TEXT,TEXT,JSONB,INTEGER,INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_free_job(UUID,TEXT,TEXT,JSONB,INTEGER,INTEGER) TO service_role;

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
        v_result := private.submit_free_job_for_admission(p_user_id, p_idempotency_key, p_model_id, p_inputs, 10, 60, true);
        IF v_result->>'ok' = 'false' THEN RETURN v_result; END IF;
    END IF;
    IF v_result IS NULL OR v_result->>'taken' IS DISTINCT FROM 'true' THEN
        v_result := private.ledger_debit_for_admission(p_user_id, p_idempotency_key, v_model.credits_5s,
            'debit:generation', p_model_id, p_inputs, 10, 60, true);
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
