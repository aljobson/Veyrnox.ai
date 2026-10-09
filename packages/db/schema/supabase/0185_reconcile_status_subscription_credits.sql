-- The hourly watcher learns about Subscription Credit drift (ADR-0064).
--
-- 0184 added reconcile_subscription_credits() to the nightly job only. The
-- snapshot that reconcile-watch reads every hour (0128) still had four
-- counts, so drift in the new bucket could sit unseen until 03:17. This adds
-- the fifth count before anything grants Subscription Credits.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, a guarded constraint, CREATE OR
-- REPLACE, and DROP ... IF EXISTS before the function whose return type
-- gains a column (as 0100 did).

ALTER TABLE public.reconciliation_snapshot
    ADD COLUMN IF NOT EXISTS subscription_credit_drift INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reconciliation_snapshot_subscription_credit_drift_check') THEN
        ALTER TABLE public.reconciliation_snapshot
            ADD CONSTRAINT reconciliation_snapshot_subscription_credit_drift_check CHECK (subscription_credit_drift >= 0);
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_reconciliation_snapshot()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    INSERT INTO public.reconciliation_snapshot
        (singleton, observed_at, balance_drift, free_credit_drift, top_up_drift, failed_refund_drift,
         subscription_credit_drift)
    SELECT true, statement_timestamp(),
        (SELECT count(*) FROM public.reconcile_balances())::INTEGER,
        (SELECT count(*) FROM public.reconcile_free_credits())::INTEGER,
        (SELECT count(*) FROM public.reconcile_top_ups())::INTEGER,
        (SELECT count(*) FROM public.reconcile_failed_refunds())::INTEGER,
        (SELECT count(*) FROM public.reconcile_subscription_credits())::INTEGER
    ON CONFLICT (singleton) DO UPDATE SET
        observed_at = EXCLUDED.observed_at,
        balance_drift = EXCLUDED.balance_drift,
        free_credit_drift = EXCLUDED.free_credit_drift,
        top_up_drift = EXCLUDED.top_up_drift,
        failed_refund_drift = EXCLUDED.failed_refund_drift,
        subscription_credit_drift = EXCLUDED.subscription_credit_drift;
$$;

-- The return type gains a column, so the old function is dropped first. A
-- dropped function loses its grants; they are restated below. Counts only,
-- read from the snapshot, never the live aggregates (0128).
DROP FUNCTION IF EXISTS public.reconcile_status();

CREATE FUNCTION public.reconcile_status()
RETURNS TABLE (balance_drift INTEGER, free_credit_drift INTEGER, top_up_drift INTEGER, failed_refund_drift INTEGER,
               subscription_credit_drift INTEGER)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    RETURN QUERY SELECT s.balance_drift, s.free_credit_drift, s.top_up_drift, s.failed_refund_drift,
                        s.subscription_credit_drift
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

-- Populate with the fifth count before committing, so the watcher never reads
-- a default zero that was not measured.
SELECT public.refresh_reconciliation_snapshot();
