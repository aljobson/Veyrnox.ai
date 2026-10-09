-- 0229_video_agent_sweep_health.sql — names the video agent's sweep to the Worker heartbeat (ADR-0074,
-- docs/montage/RUNBOOK-production.md gate G7).
--
-- lib/montageSweep.js refunds a run that never reports and heals a step left FAILED under a live job. Until now it
-- ran outside the heartbeat, so a sweep that stopped running (runner secrets missing, a thrown error) was visible
-- only as `stale_jobs` three hours later. It now reports as `video_agent`, and is expected only while the
-- `video-agent` catalog row is active, so an environment without the feature never reads as unhealthy.
--
-- The task-name CHECK is widened by READING what it allows and adding to it, not by restating the list: a fixed list
-- would drop a name another migration added (the mistake 0227 nearly made with job_steps). Idempotent.
--
-- refresh_recovery_health() cannot be widened in place; its body is the 0157 definition plus the `video_agent` line.
-- A later redefinition must carry that line forward. Like 0145 and 0157 it spans most of the schema, so it is verified
-- by the full migration replay and scripts/test-video-agent-sweep-health.mjs, not by a scoped acceptance test.

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
    IF def NOT LIKE '%''video_agent''%' THEN
        SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO names
        FROM regexp_matches(def, '''([a-z_]+)''::text', 'g') AS m;
        names := array_append(names, 'video_agent');
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
                UNION ALL SELECT 'video_agent' WHERE EXISTS (SELECT 1 FROM public.model_catalog WHERE active AND id = 'video-agent')) t
            LEFT JOIN public.worker_task_health h ON h.task = t.task
            WHERE h.last_success IS NULL OR NOT h.last_ok OR h.last_success < statement_timestamp() - INTERVAL '20 minutes'),
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
