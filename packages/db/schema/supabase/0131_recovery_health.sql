-- Bounded task heartbeats and a cheap public operational snapshot.
CREATE TABLE IF NOT EXISTS public.worker_task_health (
    task TEXT PRIMARY KEY CHECK (task IN ('top_up_backfill','upload_sweep','auto_short','asset_reap','grsai')),
    last_attempt TIMESTAMPTZ NOT NULL,
    last_success TIMESTAMPTZ,
    last_ok BOOLEAN NOT NULL
);
ALTER TABLE public.worker_task_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_task_health FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.worker_task_health FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.record_worker_task_health(p_task TEXT, p_ok BOOLEAN)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    INSERT INTO public.worker_task_health AS h(task, last_attempt, last_success, last_ok)
    VALUES(p_task, clock_timestamp(), CASE WHEN p_ok THEN clock_timestamp() ELSE NULL END, p_ok)
    ON CONFLICT(task) DO UPDATE SET last_attempt = EXCLUDED.last_attempt,
        last_success = CASE WHEN EXCLUDED.last_ok THEN EXCLUDED.last_attempt ELSE h.last_success END,
        last_ok = EXCLUDED.last_ok;
$$;
REVOKE ALL ON FUNCTION public.record_worker_task_health(TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_worker_task_health(TEXT, BOOLEAN) TO service_role;

-- A separate receipt preserves append-only payment incident records.
CREATE TABLE IF NOT EXISTS public.recovery_alert_reviews (
    kind TEXT NOT NULL CHECK (kind IN ('flagged_order','order_collision')),
    incident_key TEXT NOT NULL,
    resolution_reference TEXT NOT NULL CHECK (length(resolution_reference) BETWEEN 3 AND 160),
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(kind, incident_key)
);
ALTER TABLE public.recovery_alert_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_alert_reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.recovery_alert_reviews FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.review_recovery_alert(p_kind TEXT, p_key TEXT, p_reference TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT ((p_kind = 'flagged_order' AND EXISTS (SELECT 1 FROM public.top_up_flagged_orders WHERE order_id = p_key))
        OR (p_kind = 'order_collision' AND EXISTS (SELECT 1 FROM public.top_up_order_collisions WHERE id::TEXT = p_key))) THEN
        RETURN false;
    END IF;
    INSERT INTO public.recovery_alert_reviews(kind, incident_key, resolution_reference)
    VALUES(p_kind, p_key, p_reference) ON CONFLICT DO NOTHING;
    RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.review_recovery_alert(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_recovery_alert(TEXT, TEXT, TEXT) TO service_role;

CREATE TABLE IF NOT EXISTS public.recovery_health_snapshot (
    singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
    observed_at TIMESTAMPTZ NOT NULL,
    summary JSONB NOT NULL
);
ALTER TABLE public.recovery_health_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_health_snapshot FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.recovery_health_snapshot FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.refresh_recovery_health()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    INSERT INTO public.recovery_health_snapshot(singleton, observed_at, summary)
    SELECT true, statement_timestamp(), jsonb_build_object(
        'unhealthy_tasks', (SELECT COALESCE(jsonb_agg(t.task ORDER BY t.task), '[]'::jsonb)
            FROM (SELECT unnest(ARRAY['top_up_backfill','upload_sweep','asset_reap']) AS task
                UNION ALL SELECT 'grsai' WHERE EXISTS (SELECT 1 FROM public.model_catalog WHERE active AND provider = 'grsai')
                UNION ALL SELECT 'auto_short' WHERE EXISTS (SELECT 1 FROM public.model_catalog WHERE active AND id = 'auto-short-32s')) t
            LEFT JOIN public.worker_task_health h ON h.task = t.task
            WHERE h.last_success IS NULL OR NOT h.last_ok OR h.last_success < statement_timestamp() - INTERVAL '20 minutes'),
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
CREATE OR REPLACE FUNCTION public.recovery_status()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_summary JSONB;
BEGIN
    SELECT summary INTO v_summary FROM public.recovery_health_snapshot
    WHERE singleton AND observed_at BETWEEN statement_timestamp() - INTERVAL '45 minutes' AND statement_timestamp();
    IF NOT FOUND THEN RAISE EXCEPTION 'recovery snapshot unavailable or stale'; END IF;
    RETURN v_summary;
END $$;
REVOKE ALL ON FUNCTION public.recovery_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recovery_status() TO anon, service_role;
SELECT public.refresh_recovery_health();
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN RETURN; END IF;
    PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'veyrnox-recovery-health';
    PERFORM cron.schedule('veyrnox-recovery-health', '*/15 * * * *', 'SELECT public.refresh_recovery_health()');
END $$;
