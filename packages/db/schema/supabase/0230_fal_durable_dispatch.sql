-- ADR-0076: atomic admission and a single, irreversible fal submission attempt.
-- Service-only outbox. No browser grants, no provider retries, no production activation.
CREATE TABLE IF NOT EXISTS public.fal_dispatch (
    job_id UUID PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL CHECK (endpoint ~ '^[A-Za-z0-9/_.-]{3,128}$'),
    payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 16384),
    state TEXT NOT NULL DEFAULT 'READY' CHECK (state IN ('READY','STARTED','ACCEPTED','REJECTED','UNKNOWN','CLOSED')),
    attempt_token UUID,
    provider_job_id TEXT CHECK (provider_job_id ~ '^[A-Za-z0-9._-]{1,128}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    projected_at TIMESTAMPTZ,
    recovery_checked_at TIMESTAMPTZ
);
ALTER TABLE public.fal_dispatch ADD COLUMN IF NOT EXISTS recovery_checked_at TIMESTAMPTZ;
ALTER TABLE public.fal_dispatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fal_dispatch FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.fal_dispatch FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fal_dispatch TO service_role;
CREATE INDEX IF NOT EXISTS fal_dispatch_ready_idx ON public.fal_dispatch(created_at, job_id) WHERE state = 'READY';
CREATE INDEX IF NOT EXISTS fal_dispatch_recovery_idx ON public.fal_dispatch(created_at, job_id)
    WHERE state IN ('STARTED','ACCEPTED','REJECTED');

CREATE OR REPLACE FUNCTION public.admit_fal_dispatch(
    p_user_id UUID, p_idempotency_key TEXT, p_model_id TEXT, p_inputs JSONB,
    p_payload JSONB, p_endpoint TEXT, p_allow_free BOOLEAN DEFAULT false
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_job public.jobs%ROWTYPE;
    v_model public.model_catalog%ROWTYPE;
    v_result JSONB;
    v_balance INTEGER;
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
                      AND (d.payload IS DISTINCT FROM p_payload OR d.endpoint IS DISTINCT FROM p_endpoint)) THEN
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
    SELECT balance - CASE WHEN subscription_expires_at > now() THEN 0 ELSE subscription_balance END
    INTO v_balance FROM public.credit_balances WHERE user_id = p_user_id;
    RETURN v_result || jsonb_build_object('state', 'DEBITED', 'balance_after', v_balance,
        'free', COALESCE((v_result->>'taken')::boolean, false));
END $$;
REVOKE ALL ON FUNCTION public.admit_fal_dispatch(UUID,TEXT,TEXT,JSONB,JSONB,TEXT,BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_fal_dispatch(UUID,TEXT,TEXT,JSONB,JSONB,TEXT,BOOLEAN) TO service_role;

-- Claim ONE job immediately before its network call. There is deliberately no
-- reclaimable lease: STARTED can only gain evidence, never become READY again.
CREATE OR REPLACE FUNCTION public.start_fal_dispatch()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job UUID; v_dispatch public.fal_dispatch%ROWTYPE;
BEGIN
    SELECT j.id INTO v_job FROM public.jobs j JOIN public.fal_dispatch d ON d.job_id = j.id
    WHERE d.state = 'READY' AND j.state = 'DEBITED' AND j.provider_job_id IS NULL
      AND j.updated_at > now() - interval '14 minutes'
    ORDER BY d.created_at, d.job_id LIMIT 1 FOR UPDATE OF j SKIP LOCKED;
    IF NOT FOUND THEN RETURN NULL; END IF;
    UPDATE public.fal_dispatch SET state = 'STARTED', started_at = now(), attempt_token = gen_random_uuid()
    WHERE job_id = v_job AND state = 'READY' RETURNING * INTO v_dispatch;
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN jsonb_build_object('job_id', v_job, 'attempt_token', v_dispatch.attempt_token,
        'endpoint', v_dispatch.endpoint, 'payload', v_dispatch.payload);
END $$;
REVOKE ALL ON FUNCTION public.start_fal_dispatch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_fal_dispatch() TO service_role;

-- Commit accepted-handle evidence before projecting onto jobs. If projection
-- fails, a later cron reads this durable evidence without calling fal again.
CREATE OR REPLACE FUNCTION public.record_fal_dispatch(
    p_job_id UUID, p_attempt_token UUID, p_outcome TEXT, p_provider_job_id TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_dispatch public.fal_dispatch%ROWTYPE;
BEGIN
    IF p_outcome IS NULL OR p_outcome NOT IN ('ACCEPTED','REJECTED','UNKNOWN')
       OR (p_outcome = 'ACCEPTED' AND (p_provider_job_id IS NULL OR p_provider_job_id !~ '^[A-Za-z0-9._-]{1,128}$'))
       OR (p_outcome <> 'ACCEPTED' AND p_provider_job_id IS NOT NULL) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_OUTCOME');
    END IF;
    PERFORM 1 FROM public.jobs WHERE id = p_job_id FOR UPDATE;
    SELECT * INTO v_dispatch FROM public.fal_dispatch WHERE job_id = p_job_id FOR UPDATE;
    IF NOT FOUND OR v_dispatch.attempt_token IS DISTINCT FROM p_attempt_token OR p_attempt_token IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ATTEMPT_MISMATCH');
    END IF;
    IF v_dispatch.state = p_outcome AND v_dispatch.provider_job_id IS NOT DISTINCT FROM p_provider_job_id THEN
        RETURN jsonb_build_object('ok', true, 'idempotent', true);
    END IF;
    -- Late evidence may resolve UNKNOWN, including an accepted response whose
    -- first evidence-write acknowledgement was lost. Conflicting evidence is refused.
    IF v_dispatch.state NOT IN ('STARTED','UNKNOWN') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'OUTCOME_CONFLICT');
    END IF;
    UPDATE public.fal_dispatch SET state = p_outcome, provider_job_id = p_provider_job_id, resolved_at = now(), recovery_checked_at = NULL
    WHERE job_id = p_job_id;
    IF p_outcome = 'UNKNOWN' THEN
        UPDATE public.jobs SET error_code = 'provider_outcome_unknown'
        WHERE id = p_job_id AND state = 'DEBITED' AND provider_job_id IS NULL;
    END IF;
    RETURN jsonb_build_object('ok', true, 'idempotent', false);
END $$;
REVOKE ALL ON FUNCTION public.record_fal_dispatch(UUID,UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_fal_dispatch(UUID,UUID,TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.recover_fal_dispatch(p_limit INTEGER DEFAULT 10)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v RECORD; v_result JSONB; v_count INTEGER := 0; v_failed INTEGER := 0;
BEGIN
    -- Lock jobs before outbox, matching job_submitted/refund/sweep order.
    FOR v IN SELECT j.id, j.user_id, j.credits, j.state AS job_state, d.state,
                    d.provider_job_id, j.provider_job_id AS job_handle
        FROM public.jobs j JOIN public.fal_dispatch d ON d.job_id = j.id
        WHERE (d.recovery_checked_at IS NULL OR d.recovery_checked_at < now() - interval '2 minutes')
          AND ((d.state = 'ACCEPTED' AND d.projected_at IS NULL)
           OR (d.state = 'REJECTED' AND d.projected_at IS NULL)
           OR (d.state = 'STARTED' AND d.started_at < now() - interval '2 minutes')
           OR (d.state = 'READY' AND j.state <> 'DEBITED'))
        ORDER BY COALESCE(d.recovery_checked_at, d.created_at), d.job_id LIMIT GREATEST(1, LEAST(COALESCE(p_limit,10),25))
        FOR UPDATE OF j SKIP LOCKED
    LOOP
        PERFORM 1 FROM public.fal_dispatch WHERE job_id = v.id FOR UPDATE;
        BEGIN
        IF v.state = 'STARTED' THEN
            UPDATE public.fal_dispatch SET state = 'UNKNOWN', resolved_at = now() WHERE job_id = v.id AND state = 'STARTED';
            -- Do not extend the existing stuck-job refund deadline.
            UPDATE public.jobs SET error_code = 'provider_outcome_unknown'
            WHERE id = v.id AND state = 'DEBITED' AND provider_job_id IS NULL;
        ELSIF v.state = 'ACCEPTED' THEN
            IF v.job_state = 'DEBITED' AND v.job_handle IS NULL THEN
                v_result := public.job_submitted(v.id, 'fal', v.provider_job_id);
                IF v_result->>'ok' IS DISTINCT FROM 'true' THEN
                    RAISE EXCEPTION 'fal dispatch projection refused for %', v.id;
                END IF;
            END IF;
            -- A refund/terminal transition wins; retain evidence but never revive
            -- or charge a refunded job. A differing handle is an operator incident.
            IF v.job_handle IS NOT NULL AND v.job_handle IS DISTINCT FROM v.provider_job_id THEN
                RAISE EXCEPTION 'fal dispatch handle conflict for %', v.id;
            END IF;
            UPDATE public.fal_dispatch SET projected_at = now() WHERE job_id = v.id;
        ELSIF v.state = 'REJECTED' THEN
            IF v.job_state = 'DEBITED' THEN
                UPDATE public.jobs SET error_code = 'provider_submit_failed' WHERE id = v.id;
                v_result := public.ledger_refund(v.id, v.user_id, v.credits, 'refund:submit_failed');
                IF v_result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'fal dispatch refund refused for %', v.id; END IF;
            END IF;
            UPDATE public.fal_dispatch SET projected_at = now() WHERE job_id = v.id;
        ELSE
            UPDATE public.fal_dispatch SET state = 'CLOSED', resolved_at = now() WHERE job_id = v.id AND state = 'READY';
        END IF;
        EXCEPTION WHEN OTHERS THEN
            -- One conflicting/poisoned job cannot block other durable handles.
            -- The evidence remains, with a bounded retry cadence and failed heartbeat.
            v_failed := v_failed + 1;
        END;
        UPDATE public.fal_dispatch SET recovery_checked_at = now() WHERE job_id = v.id;
        v_count := v_count + 1;
    END LOOP;
    RETURN jsonb_build_object('ok', v_failed = 0, 'processed', v_count, 'failed', v_failed);
END $$;
REVOKE ALL ON FUNCTION public.recover_fal_dispatch(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_fal_dispatch(INTEGER) TO service_role;

DO $$
DECLARE
    def text;
    names text[];
BEGIN
    SELECT pg_get_constraintdef(c.oid) INTO def
    FROM pg_constraint c
    WHERE c.conrelid = 'public.worker_task_health'::regclass AND c.conname = 'worker_task_health_task_check';
    IF def IS NULL THEN
        RAISE EXCEPTION 'worker_task_health_task_check is missing; 0131 must be applied first';
    END IF;
    IF def NOT LIKE '%''fal_dispatch''%' THEN
        SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO names
        FROM regexp_matches(def, '''([a-z_]+)''::text', 'g') AS m;
        names := array_append(names, 'fal_dispatch');
        ALTER TABLE public.worker_task_health DROP CONSTRAINT worker_task_health_task_check;
        EXECUTE format(
            'ALTER TABLE public.worker_task_health ADD CONSTRAINT worker_task_health_task_check CHECK (task IN (%s))',
            (SELECT string_agg(quote_literal(k), ', ' ORDER BY k) FROM unnest(names) AS k)
        );
    END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.refresh_recovery_health()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    INSERT INTO public.recovery_health_snapshot(singleton, observed_at, summary)
    SELECT true, statement_timestamp(), jsonb_build_object(
        'unhealthy_tasks', (SELECT COALESCE(jsonb_agg(t.task ORDER BY t.task), '[]'::jsonb)
            FROM (SELECT unnest(ARRAY['top_up_backfill','upload_sweep','asset_reap']) AS task
                UNION ALL SELECT 'grsai' WHERE EXISTS (SELECT 1 FROM public.model_catalog WHERE active AND provider = 'grsai')
                UNION ALL SELECT 'byteplus' WHERE EXISTS (SELECT 1 FROM public.model_catalog WHERE active AND provider = 'byteplus')
                UNION ALL SELECT 'auto_short' WHERE EXISTS (SELECT 1 FROM public.model_catalog WHERE active AND id = 'auto-short-32s')
                UNION ALL SELECT 'publish_sweep' WHERE EXISTS (SELECT 1 FROM public.social_posts WHERE status = 'scheduled' AND scheduled_at <= statement_timestamp() - interval '20 minutes')
                UNION ALL SELECT 'video_agent' WHERE EXISTS (SELECT 1 FROM public.model_catalog WHERE active AND id = 'video-agent')
                UNION ALL SELECT 'fal_dispatch' WHERE EXISTS (SELECT 1 FROM public.fal_dispatch d JOIN public.jobs j ON j.id = d.job_id WHERE j.state = 'DEBITED')) t
            LEFT JOIN public.worker_task_health h ON h.task = t.task
            WHERE h.last_success IS NULL OR NOT h.last_ok OR h.last_success < statement_timestamp() - INTERVAL '20 minutes'),
        'fal_dispatch_unknown', (SELECT count(*) FROM public.fal_dispatch d JOIN public.jobs j ON j.id = d.job_id
            WHERE j.state = 'DEBITED' AND (d.state = 'UNKNOWN' OR (d.state = 'STARTED' AND d.started_at < statement_timestamp() - interval '2 minutes'))),
        'fal_dispatch_overdue', (SELECT count(*) FROM public.fal_dispatch d JOIN public.jobs j ON j.id = d.job_id
            WHERE j.state = 'DEBITED' AND ((d.state = 'READY' AND d.created_at < statement_timestamp() - interval '10 minutes')
                OR (d.state = 'ACCEPTED' AND d.projected_at IS NULL AND d.resolved_at < statement_timestamp() - interval '5 minutes'))),
        'cinema_poll_overdue', (SELECT count(*) FROM public.cinema_uploads WHERE state IN ('uploading','processing') AND stream_uid IS NOT NULL
            AND COALESCE(recovery_checked_at,created_at) < statement_timestamp()-interval '40 minutes'),
        'cinema_poll_failed', (SELECT count(*) FROM public.cinema_uploads WHERE state IN ('uploading','processing') AND recovery_failed),
        'cinema_provisioning_stuck', (SELECT count(*) FROM public.cinema_uploads WHERE state='provisioning' AND created_at < statement_timestamp()-interval '5 minutes'),
        'cinema_processing_stuck', (SELECT count(*) FROM public.cinema_uploads WHERE state='processing' AND created_at < statement_timestamp()-interval '3 hours'),
        'cinema_cleanup_required', (SELECT count(*) FROM public.cinema_uploads WHERE state='error'
            OR (state='deleting' AND delete_requested_at < statement_timestamp()-interval '30 minutes')
            OR (state='uploading' AND expires_at < statement_timestamp()-interval '15 minutes')),
        'reap_exhausted', (SELECT count(*) FROM public.asset_reap_queue WHERE attempts >= 8),
        'reap_overdue', (SELECT count(*) FROM public.asset_reap_queue WHERE queued_at < statement_timestamp() - INTERVAL '1 hour'),
        'stale_jobs', (SELECT count(*) FROM public.jobs WHERE state IN ('DEBITED','SUBMITTED','SUCCEEDED','FAILOVER','FAILED')
            AND updated_at < statement_timestamp() - INTERVAL '3 hours'),
        'stale_top_up_returns', (SELECT count(*) FROM public.top_ups WHERE status = 'pending' AND return_order_id IS NOT NULL AND return_closed_at IS NULL
            AND COALESCE(backfill_checked_at, returned_at + INTERVAL '10 minutes') < statement_timestamp() - INTERVAL '8 hours'),
        'unreviewed_flagged_orders', (SELECT count(*) FROM public.top_up_flagged_orders f WHERE NOT EXISTS
            (SELECT 1 FROM public.recovery_alert_reviews r WHERE r.kind = 'flagged_order' AND r.incident_key = f.order_id)),
        'unreviewed_order_collisions', (SELECT count(*) FROM public.top_up_order_collisions c WHERE NOT EXISTS
            (SELECT 1 FROM public.recovery_alert_reviews r WHERE r.kind = 'order_collision' AND r.incident_key = c.id::TEXT))
    ) ON CONFLICT(singleton) DO UPDATE SET observed_at = EXCLUDED.observed_at, summary = EXCLUDED.summary;
$$;
REVOKE ALL ON FUNCTION public.refresh_recovery_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_recovery_health() TO service_role;
