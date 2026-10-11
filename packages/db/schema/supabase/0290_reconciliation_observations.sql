-- Keep measured count history when hourly Actions scheduling is delayed.
-- The existing cron still refreshes every fifteen minutes; public reads still
-- use only the latest snapshot. No historical zeroes are inferred or backfilled.
BEGIN;

CREATE TABLE IF NOT EXISTS private.reconciliation_observations (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    observed_at TIMESTAMPTZ NOT NULL,
    balance_drift INTEGER NOT NULL CHECK (balance_drift >= 0),
    free_credit_drift INTEGER NOT NULL CHECK (free_credit_drift >= 0),
    top_up_drift INTEGER NOT NULL CHECK (top_up_drift >= 0),
    failed_refund_drift INTEGER NOT NULL CHECK (failed_refund_drift >= 0),
    subscription_credit_drift INTEGER NOT NULL CHECK (subscription_credit_drift >= 0),
    free_allowance_drift INTEGER NOT NULL CHECK (free_allowance_drift >= 0),
    referral_drift INTEGER NOT NULL CHECK (referral_drift >= 0)
);
CREATE INDEX IF NOT EXISTS reconciliation_observations_time_idx
    ON private.reconciliation_observations (observed_at);
ALTER TABLE private.reconciliation_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.reconciliation_observations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.reconciliation_observations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE private.reconciliation_observations TO service_role;
GRANT USAGE ON SCHEMA private TO service_role;
REVOKE ALL ON SEQUENCE private.reconciliation_observations_id_seq FROM PUBLIC, anon, authenticated, service_role;
DROP POLICY IF EXISTS reconciliation_observations_service_read ON private.reconciliation_observations;
CREATE POLICY reconciliation_observations_service_read ON private.reconciliation_observations
    FOR SELECT TO service_role USING (true);

CREATE OR REPLACE FUNCTION private.reconciliation_observations_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    RAISE EXCEPTION 'reconciliation observations are append-only' USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION private.reconciliation_observations_append_only() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.reconciliation_observations_append_only() TO service_role;
DROP TRIGGER IF EXISTS reconciliation_observations_append_only ON private.reconciliation_observations;
CREATE TRIGGER reconciliation_observations_append_only
    BEFORE UPDATE OR DELETE OR TRUNCATE ON private.reconciliation_observations
    FOR EACH STATEMENT EXECUTE FUNCTION private.reconciliation_observations_append_only();

CREATE OR REPLACE FUNCTION public.refresh_reconciliation_snapshot()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    WITH recorded AS (
        INSERT INTO private.reconciliation_observations
            (observed_at, balance_drift, free_credit_drift, top_up_drift, failed_refund_drift,
             subscription_credit_drift, free_allowance_drift, referral_drift)
        SELECT statement_timestamp(),
            (SELECT count(*) FROM public.reconcile_balances())::INTEGER,
            (SELECT count(*) FROM public.reconcile_free_credits())::INTEGER,
            (SELECT count(*) FROM public.reconcile_top_ups())::INTEGER,
            (SELECT count(*) FROM public.reconcile_failed_refunds())::INTEGER,
            (SELECT count(*) FROM public.reconcile_subscription_credits())::INTEGER,
            (SELECT count(*) FROM public.reconcile_free_allowance())::INTEGER,
            (SELECT count(*) FROM public.reconcile_referrals())::INTEGER
        RETURNING observed_at, balance_drift, free_credit_drift, top_up_drift, failed_refund_drift,
                  subscription_credit_drift, free_allowance_drift, referral_drift
    )
    INSERT INTO public.reconciliation_snapshot
        (singleton, observed_at, balance_drift, free_credit_drift, top_up_drift, failed_refund_drift,
         subscription_credit_drift, free_allowance_drift, referral_drift)
    SELECT true, observed_at, balance_drift, free_credit_drift, top_up_drift, failed_refund_drift,
           subscription_credit_drift, free_allowance_drift, referral_drift FROM recorded
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
REVOKE ALL ON FUNCTION public.refresh_reconciliation_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_reconciliation_snapshot() TO service_role;

-- Start history with a real measurement; replay appends another real sample.
-- Older snapshots and successful cron executions cannot establish prior counts.
SELECT public.refresh_reconciliation_snapshot();
COMMIT;
