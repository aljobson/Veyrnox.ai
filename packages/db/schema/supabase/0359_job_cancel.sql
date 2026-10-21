-- ADR-0243: cancel only a durable intent that has never crossed the claim fence.
CREATE OR REPLACE FUNCTION public.cancel_user_job(p_auth_id TEXT, p_job_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user public.users%ROWTYPE;
    v_job public.jobs%ROWTYPE;
    v_dispatch public.fal_dispatch%ROWTYPE;
    v_result JSONB;
BEGIN
    SELECT * INTO v_user FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    v_result := public.consume_job_read_request(v_user.id);
    IF v_result->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_result; END IF;

    SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id AND user_id = v_user.id FOR UPDATE;
    IF NOT FOUND OR v_job.deleted_at IS NOT NULL OR v_job.inputs->>'kind' = 'chat' THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    END IF;
    IF v_job.state = 'REFUNDED' AND v_job.error_code = 'user_cancelled' THEN
        RETURN pg_catalog.jsonb_build_object('ok', true, 'replayed', true, 'credits', v_job.credits);
    END IF;
    IF v_job.state IN ('STORED', 'FAILED', 'REFUNDED') THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'JOB_FINISHED');
    END IF;

    -- Same job -> outbox -> balance order as claim/recovery and ledger_refund.
    SELECT * INTO v_dispatch FROM public.fal_dispatch WHERE job_id = v_job.id FOR UPDATE;
    IF NOT FOUND OR v_job.state <> 'DEBITED' OR v_job.provider_job_id IS NOT NULL OR v_dispatch.state <> 'READY' THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'JOB_STARTED');
    END IF;
    PERFORM 1 FROM public.credit_balances WHERE user_id = v_user.id FOR UPDATE;
    -- Re-read after the balance lock: every Freeze takes that lock too.
    IF EXISTS (SELECT 1 FROM public.users WHERE id = v_user.id AND frozen_at IS NOT NULL) THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN');
    END IF;

    UPDATE public.jobs SET error_code = 'user_cancelled' WHERE id = v_job.id;
    UPDATE public.fal_dispatch SET state = 'CLOSED', resolved_at = pg_catalog.now()
     WHERE job_id = v_job.id AND state = 'READY';
    v_result := public.ledger_refund(v_job.id, v_user.id, v_job.credits, 'refund:user_cancelled');
    IF v_result->>'ok' IS DISTINCT FROM 'true' OR v_result->>'idempotent' = 'true' THEN
        RAISE EXCEPTION 'JOB_CANCEL_REFUND_INVARIANT';
    END IF;
    RETURN pg_catalog.jsonb_build_object('ok', true, 'replayed', false, 'credits', v_job.credits);
END $$;
REVOKE ALL ON FUNCTION public.cancel_user_job(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_user_job(TEXT, UUID) TO service_role;

-- Advisory: consumes only the read quota, takes no job/outbox/balance locks.
CREATE OR REPLACE FUNCTION public.get_user_job_cancel(p_auth_id TEXT, p_job_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user public.users%ROWTYPE;
    v_job public.jobs%ROWTYPE;
    v_rate JSONB;
BEGIN
    SELECT * INTO v_user FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    v_rate := public.consume_job_read_request(v_user.id);
    IF v_rate->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_rate; END IF;
    SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id AND user_id = v_user.id;
    IF NOT FOUND OR v_job.deleted_at IS NOT NULL OR v_job.inputs->>'kind' = 'chat' THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    END IF;
    RETURN pg_catalog.jsonb_build_object('ok', true, 'credits', v_job.credits, 'cancellable',
        v_job.state = 'DEBITED' AND v_job.provider_job_id IS NULL AND v_user.frozen_at IS NULL
        AND EXISTS (SELECT 1 FROM public.fal_dispatch WHERE job_id = v_job.id AND state = 'READY'));
END $$;
REVOKE ALL ON FUNCTION public.get_user_job_cancel(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_job_cancel(TEXT, UUID) TO service_role;

-- 0348's function verbatim, with only the user_cancelled exclusion added.
CREATE OR REPLACE FUNCTION public.push_enqueue_job_events(p_limit INTEGER DEFAULT 200)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_n INTEGER;
BEGIN
    WITH people AS (
        SELECT DISTINCT t.user_id FROM public.push_tokens t
         WHERE t.disabled_at IS NULL AND t.notify_jobs
    ), due AS (
        SELECT j.user_id, j.id AS job_id,
               CASE WHEN j.state = 'STORED' THEN 'job_done' ELSE 'job_failed' END AS kind
          FROM people p
          JOIN public.jobs j ON j.user_id = p.user_id
         WHERE j.created_at > now() - interval '2 hours'
           AND j.updated_at > now() - interval '15 minutes'
           AND j.state IN ('STORED', 'FAILED', 'REFUNDED')
           AND j.error_code IS DISTINCT FROM 'user_cancelled'
           AND COALESCE(j.provider, '') <> 'openrouter-chat'
         ORDER BY j.updated_at
         LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000))
    ), ins AS (
        INSERT INTO public.push_outbox (user_id, job_id, kind)
        SELECT user_id, job_id, kind FROM due
        ON CONFLICT (job_id, kind) DO NOTHING
        RETURNING 1
    )
    SELECT count(*) INTO v_n FROM ins;
    RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.push_enqueue_job_events(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_enqueue_job_events(INTEGER) TO service_role;
