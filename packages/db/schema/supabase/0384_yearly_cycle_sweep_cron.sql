-- 0384 — Run the yearly cycle sweep every hour (0383, ADR-0037 amendment).
--
-- grant_due_yearly_cycles() grants months 2 to 12 of a paid yearly Credit Subscription as each month
-- starts. It follows expire_subscription_credits' hourly job (0184, minute 7) at minute 12, so an
-- expiring remainder is swept before the new month lands, and a sweep that runs late still grants the
-- month in progress. Skipped where pg_cron is not installed (a plain test database), like 0184.
--
-- The yearly plans stay INACTIVE: this migration changes nothing a customer can buy. Turning them on
-- is a separate, deliberate step after the checkout wording has been reviewed.
--
-- Idempotent: the job is unscheduled and scheduled again under the same name.
-- Rollback: SELECT cron.unschedule('veyrnox-grant-yearly-cycles').

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RETURN;
    END IF;

    PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'veyrnox-grant-yearly-cycles';

    PERFORM cron.schedule(
        'veyrnox-grant-yearly-cycles',
        '12 * * * *',
        $cmd$ SELECT public.grant_due_yearly_cycles(); $cmd$
    );
END $$;
