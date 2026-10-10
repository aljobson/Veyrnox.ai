-- S20 / Track A8: the hourly watcher sees allowance and referral drift.
-- Add counts only; retain the 45-minute freshness guard, snapshot-only public
-- read, service-only refresh, RLS and all five existing measurements.
-- Existing clients may ignore the additive fields. Measure before commit;
-- never publish unmeasured default zeroes. No money or feature flags change.
BEGIN;

ALTER TABLE public.reconciliation_snapshot
    ADD COLUMN IF NOT EXISTS free_allowance_drift INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS referral_drift INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conname = 'reconciliation_snapshot_free_allowance_drift_check'
          AND conrelid = 'public.reconciliation_snapshot'::regclass) THEN
        ALTER TABLE public.reconciliation_snapshot ADD CONSTRAINT reconciliation_snapshot_free_allowance_drift_check CHECK (free_allowance_drift >= 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conname = 'reconciliation_snapshot_referral_drift_check'
          AND conrelid = 'public.reconciliation_snapshot'::regclass) THEN
        ALTER TABLE public.reconciliation_snapshot ADD CONSTRAINT reconciliation_snapshot_referral_drift_check CHECK (referral_drift >= 0);
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_reconciliation_snapshot()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    INSERT INTO public.reconciliation_snapshot
        (singleton, observed_at, balance_drift, free_credit_drift, top_up_drift, failed_refund_drift,
         subscription_credit_drift, free_allowance_drift, referral_drift)
    SELECT true, statement_timestamp(),
        (SELECT count(*) FROM public.reconcile_balances())::INTEGER,
        (SELECT count(*) FROM public.reconcile_free_credits())::INTEGER,
        (SELECT count(*) FROM public.reconcile_top_ups())::INTEGER,
        (SELECT count(*) FROM public.reconcile_failed_refunds())::INTEGER,
        (SELECT count(*) FROM public.reconcile_subscription_credits())::INTEGER,
        (SELECT count(*) FROM public.reconcile_free_allowance())::INTEGER,
        (SELECT count(*) FROM public.reconcile_referrals())::INTEGER
    ON CONFLICT (singleton) DO UPDATE SET
        observed_at = EXCLUDED.observed_at,
        balance_drift = EXCLUDED.balance_drift,
        free_credit_drift = EXCLUDED.free_credit_drift,
        top_up_drift = EXCLUDED.top_up_drift,
        failed_refund_drift = EXCLUDED.failed_refund_drift,
        subscription_credit_drift = EXCLUDED.subscription_credit_drift,
        free_allowance_drift = EXCLUDED.free_allowance_drift,
        referral_drift = EXCLUDED.referral_drift;
$$;

-- The return type gains two columns, so the old function is dropped first. A
-- dropped function loses its grants; they are restated below. Counts only,
-- read from the snapshot, never the live aggregates (0128).
DROP FUNCTION IF EXISTS public.reconcile_status();

CREATE FUNCTION public.reconcile_status()
RETURNS TABLE (balance_drift INTEGER, free_credit_drift INTEGER, top_up_drift INTEGER, failed_refund_drift INTEGER,
               subscription_credit_drift INTEGER, free_allowance_drift INTEGER, referral_drift INTEGER)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    RETURN QUERY SELECT s.balance_drift, s.free_credit_drift, s.top_up_drift, s.failed_refund_drift,
                        s.subscription_credit_drift, s.free_allowance_drift, s.referral_drift
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

-- Populate with all seven measured counts before committing, so the watcher never reads
-- a default zero that was not measured.
SELECT public.refresh_reconciliation_snapshot();

REVOKE ALL ON FUNCTION public.refresh_reconciliation_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_reconciliation_snapshot() TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
