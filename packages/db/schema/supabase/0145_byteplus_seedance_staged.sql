-- Stage the BytePlus ModelArk Seedance rows INACTIVE (ADR-0058) and let the
-- Worker heartbeat name its new polling task.
--
-- Costs are the BytePlus resource-pack rates read on 2026-09-26
-- (docs.byteplus.com/en/docs/ModelArk/2191775, /1544106), one 5s 16:9 720p
-- clip with no video input: Seedance 2.0 Fast $3.30/M tokens -> $0.35,
-- 2.0 Mini $2.10/M -> $0.23, 2.0 $4.30/M -> $0.47, 2.5 $6.40/M -> $0.69,
-- Seedance 1.0 Pro Fast PAYG $1.00/M -> $0.10. Credits are the ADR-0037
-- floor ceil(cost / 0.01796) at the $129 / 3000 pack: 20, 13, 27, 39, 6.
-- The pack rate is only true while a pack has balance; the activating
-- migration must cite the pack purchase and the byteplus_pack_balance check.
--
-- Nothing here activates a row, changes an existing row, or changes any
-- price. Activation is a separate migration after every item in ADR-0058
-- "Before activating any row" is met, including the R2 output host.
INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('seedance-2.0-fast-byteplus',     'Seedance 2.0 Fast (BytePlus)',     'byteplus', 'byteplus:seedance-2.0-fast',     'text-to-video', 20, 0.3500, 'per_second', 5, false, false),
    ('seedance-2.0-mini-byteplus',     'Seedance 2.0 Mini (BytePlus)',     'byteplus', 'byteplus:seedance-2.0-mini',     'text-to-video', 13, 0.2300, 'per_second', 5, false, false),
    ('seedance-2.0-byteplus',          'Seedance 2.0 (BytePlus)',          'byteplus', 'byteplus:seedance-2.0',          'text-to-video', 27, 0.4700, 'per_second', 5, false, false),
    ('seedance-2.5-byteplus',          'Seedance 2.5 (BytePlus)',          'byteplus', 'byteplus:seedance-2.5',          'text-to-video', 39, 0.6900, 'per_second', 5, false, false),
    ('seedance-1.0-pro-fast-byteplus', 'Seedance 1.0 Pro Fast (BytePlus)', 'byteplus', 'byteplus:seedance-1.0-pro-fast', 'text-to-video',  6, 0.1000, 'per_second', 5, false, false)
ON CONFLICT (id) DO NOTHING;

-- worker_task_health (0131) bounds task names with an inline CHECK. Widen it
-- for the byteplus sweep; dropping by the generated name and re-adding keeps
-- the migration replayable.
ALTER TABLE public.worker_task_health DROP CONSTRAINT IF EXISTS worker_task_health_task_check;
ALTER TABLE public.worker_task_health
    ADD CONSTRAINT worker_task_health_task_check
    CHECK (task IN ('top_up_backfill','upload_sweep','auto_short','asset_reap','grsai','byteplus'));

-- The snapshot only expects a heartbeat for a provider with an active row,
-- so a staged-but-inactive byteplus catalog never reads as unhealthy. Body
-- is the 0139 definition (cinema counts included) plus the byteplus line;
-- a later redefinition must carry the byteplus line forward.
CREATE OR REPLACE FUNCTION public.refresh_recovery_health()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    INSERT INTO public.recovery_health_snapshot(singleton, observed_at, summary)
    SELECT true, statement_timestamp(), jsonb_build_object(
        'unhealthy_tasks', (SELECT COALESCE(jsonb_agg(t.task ORDER BY t.task), '[]'::jsonb)
            FROM (SELECT unnest(ARRAY['top_up_backfill','upload_sweep','asset_reap']) AS task
                UNION ALL SELECT 'grsai' WHERE EXISTS (SELECT 1 FROM public.model_catalog WHERE active AND provider = 'grsai')
                UNION ALL SELECT 'byteplus' WHERE EXISTS (SELECT 1 FROM public.model_catalog WHERE active AND provider = 'byteplus')
                UNION ALL SELECT 'auto_short' WHERE EXISTS (SELECT 1 FROM public.model_catalog WHERE active AND id = 'auto-short-32s')) t
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
