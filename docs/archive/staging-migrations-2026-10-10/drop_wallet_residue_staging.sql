-- Staging only. Removes objects from the sibling Veyrnox wallet product that
-- production (veyrnox-ai-production-eu) never had, so staging matches it.
-- Hard wall between the two products (CLAUDE.md). Both tables were empty when
-- this ran; no CASCADE, so nothing outside this list can go with them.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.events) OR EXISTS (SELECT 1 FROM public.funnel_dropoff_alert_log) THEN
        RAISE EXCEPTION 'refusing to drop wallet residue: events or funnel_dropoff_alert_log hold rows';
    END IF;
    PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'veyrnox-funnel-dropoff-hourly';
END $$;

DROP VIEW IF EXISTS public.funnel_dropoff_hotspots;
DROP VIEW IF EXISTS public.cohort_retention_weekly;
DROP VIEW IF EXISTS public.onboarding_funnel_dropoff;
DROP VIEW IF EXISTS public.device_cohorts;

DROP FUNCTION IF EXISTS public.check_funnel_dropoff_alerts(NUMERIC, INTEGER);
DROP FUNCTION IF EXISTS public.track_event(UUID, TEXT, JSONB);

DROP TABLE IF EXISTS public.funnel_dropoff_alert_log;
DROP TABLE IF EXISTS public.events;
