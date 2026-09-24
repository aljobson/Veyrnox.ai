-- Anonymous callers read one fresh snapshot, never aggregate live money data.
-- The existing four-column watcher contract stays intact; stale is an error.
CREATE TABLE IF NOT EXISTS public.reconciliation_snapshot (
    singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
    observed_at TIMESTAMPTZ NOT NULL,
    balance_drift INTEGER NOT NULL CHECK (balance_drift >= 0),
    free_credit_drift INTEGER NOT NULL CHECK (free_credit_drift >= 0),
    top_up_drift INTEGER NOT NULL CHECK (top_up_drift >= 0),
    failed_refund_drift INTEGER NOT NULL CHECK (failed_refund_drift >= 0)
);
ALTER TABLE public.reconciliation_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_snapshot FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reconciliation_snapshot FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.reconciliation_snapshot TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_reconciliation_snapshot()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    INSERT INTO public.reconciliation_snapshot
        (singleton, observed_at, balance_drift, free_credit_drift, top_up_drift, failed_refund_drift)
    SELECT true, statement_timestamp(),
        (SELECT count(*) FROM public.reconcile_balances())::INTEGER,
        (SELECT count(*) FROM public.reconcile_free_credits())::INTEGER,
        (SELECT count(*) FROM public.reconcile_top_ups())::INTEGER,
        (SELECT count(*) FROM public.reconcile_failed_refunds())::INTEGER
    ON CONFLICT (singleton) DO UPDATE SET
        observed_at = EXCLUDED.observed_at,
        balance_drift = EXCLUDED.balance_drift,
        free_credit_drift = EXCLUDED.free_credit_drift,
        top_up_drift = EXCLUDED.top_up_drift,
        failed_refund_drift = EXCLUDED.failed_refund_drift;
$$;
REVOKE ALL ON FUNCTION public.refresh_reconciliation_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_reconciliation_snapshot() TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_status()
RETURNS TABLE (balance_drift INTEGER, free_credit_drift INTEGER, top_up_drift INTEGER, failed_refund_drift INTEGER)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    RETURN QUERY SELECT s.balance_drift, s.free_credit_drift, s.top_up_drift, s.failed_refund_drift
    FROM public.reconciliation_snapshot s
    WHERE s.singleton AND s.observed_at >= statement_timestamp() - INTERVAL '45 minutes'
        AND s.observed_at <= statement_timestamp();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'reconciliation snapshot unavailable or stale';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_status() TO anon, service_role;

-- Populate before committing the replacement, so the watcher is never blinded.
SELECT public.refresh_reconciliation_snapshot();
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN RETURN; END IF;
    PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'veyrnox-reconciliation-snapshot';
    PERFORM cron.schedule('veyrnox-reconciliation-snapshot', '*/15 * * * *',
        'SELECT public.refresh_reconciliation_snapshot()');
END $$;
-- The independent nightly drift-raising reconciliation job is unchanged.
