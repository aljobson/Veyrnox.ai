-- 0157_social_publish_sweep_health.sql — names the publish sweep to the
-- Worker heartbeat (0131, most recently widened by 0145). Kept separate from
-- 0156's own tables and RPCs: this file's CREATE OR REPLACE FUNCTION touches
-- worker_task_health, cinema_uploads, asset_reap_queue, jobs, top_ups and
-- more, spanning nearly the whole schema, so — like 0145 before it — it is
-- verified by the full migration replay (scripts/replay-migrations.mjs) and
-- scripts/test-recovery-health.mjs, not by a scoped *.acceptance.test.ts
-- that only wants 0156's own objects.

-- worker_task_health (0131, widened by 0145) bounds task names with an
-- inline CHECK. Widen it for the publish sweep; dropping by the generated
-- name and re-adding keeps the migration replayable.
ALTER TABLE public.worker_task_health DROP CONSTRAINT IF EXISTS worker_task_health_task_check;
ALTER TABLE public.worker_task_health
    ADD CONSTRAINT worker_task_health_task_check
    CHECK (task IN ('top_up_backfill', 'upload_sweep', 'auto_short', 'asset_reap', 'grsai', 'byteplus', 'publish_sweep'));

-- The snapshot only expects a heartbeat once a brand has a due-able post, so
-- an idle Publish feature never reads as unhealthy. Body is the 0145
-- definition (byteplus line included) plus the publish_sweep line; a later
-- redefinition must carry this line forward.
CREATE OR REPLACE FUNCTION public.refresh_recovery_health()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    INSERT INTO public.recovery_health_snapshot(singleton, observed_at, summary)
    SELECT true, statement_timestamp(), jsonb_build_object(
        'unhealthy_tasks', (SELECT COALESCE(jsonb_agg(t.task ORDER BY t.task), '[]'::jsonb)
            FROM (SELECT unnest(ARRAY['top_up_backfill','upload_sweep','asset_reap']) AS task
                UNION ALL SELECT 'grsai' WHERE EXISTS (SELECT 1 FROM public.model_catalog WHERE active AND provider = 'grsai')
                UNION ALL SELECT 'byteplus' WHERE EXISTS (SELECT 1 FROM public.model_catalog WHERE active AND provider = 'byteplus')
                UNION ALL SELECT 'auto_short' WHERE EXISTS (SELECT 1 FROM public.model_catalog WHERE active AND id = 'auto-short-32s')
                UNION ALL SELECT 'publish_sweep' WHERE EXISTS (SELECT 1 FROM public.social_posts WHERE status = 'scheduled' AND scheduled_at <= statement_timestamp() - interval '20 minutes')) t
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
