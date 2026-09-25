-- Recovery claims hold no user capability and never release storage capacity.
ALTER TABLE public.cinema_uploads ADD COLUMN IF NOT EXISTS recovery_claim UUID;
ALTER TABLE public.cinema_uploads ADD COLUMN IF NOT EXISTS recovery_claimed_at TIMESTAMPTZ;
ALTER TABLE public.cinema_uploads ADD COLUMN IF NOT EXISTS recovery_checked_at TIMESTAMPTZ;
ALTER TABLE public.cinema_uploads ADD COLUMN IF NOT EXISTS recovery_failed BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS cinema_upload_recovery_idx ON public.cinema_uploads(recovery_claimed_at NULLS FIRST,id)
  WHERE stream_uid IS NOT NULL AND state IN ('uploading','processing');

-- Five-minute claims and oldest-claimed ordering keep failures from starving
-- newer uploads. Replaying a current claim returns its same minimal work list.
CREATE OR REPLACE FUNCTION public.claim_cinema_upload_checks(p_key UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_items JSONB;
BEGIN
  IF p_key IS NULL THEN RETURN jsonb_build_object('error','invalid_claim'); END IF;
  -- Serialize retries of the same key; other claimers use SKIP LOCKED.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_key::TEXT,138));
  IF NOT EXISTS (SELECT 1 FROM public.cinema_uploads WHERE recovery_claim=p_key) THEN
    WITH candidates AS (
      SELECT id FROM public.cinema_uploads
      WHERE stream_uid IS NOT NULL AND state IN ('uploading','processing')
        AND (recovery_claimed_at IS NULL OR recovery_claimed_at <= now()-interval '5 minutes')
      ORDER BY recovery_claimed_at NULLS FIRST,id LIMIT 20 FOR UPDATE SKIP LOCKED
    )
    UPDATE public.cinema_uploads u SET recovery_claim=p_key,recovery_claimed_at=now()
      FROM candidates c WHERE u.id=c.id;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'stream_uid',stream_uid) ORDER BY id),'[]'::JSONB)
    INTO v_items FROM public.cinema_uploads WHERE recovery_claim=p_key;
  RETURN jsonb_build_object('items',v_items);
END $$;

CREATE OR REPLACE FUNCTION public.finish_cinema_upload_check(p_id UUID,p_key UUID,p_ok BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_id IS NULL OR p_key IS NULL OR p_ok IS NULL THEN RETURN jsonb_build_object('error','invalid_claim'); END IF;
  UPDATE public.cinema_uploads SET recovery_checked_at=clock_timestamp(),recovery_failed=NOT p_ok
    WHERE id=p_id AND recovery_claim=p_key
      AND (recovery_checked_at IS NULL OR recovery_checked_at < recovery_claimed_at);
  -- Completion is once per claim, including failed attempts; a late result
  -- from an older claim cannot overwrite a newer check's health.
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.claim_cinema_upload_checks(UUID),public.finish_cinema_upload_check(UUID,UUID,BOOLEAN) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_cinema_upload_checks(UUID),public.finish_cinema_upload_check(UUID,UUID,BOOLEAN) TO service_role;

-- Keep existing recovery signals intact; the public snapshot adds only counts.
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
        'cinema_poll_overdue', (SELECT count(*) FROM public.cinema_uploads WHERE state IN ('uploading','processing') AND stream_uid IS NOT NULL
            AND COALESCE(recovery_checked_at,created_at) < statement_timestamp()-interval '40 minutes'),
        'cinema_poll_failed', (SELECT count(*) FROM public.cinema_uploads WHERE state IN ('uploading','processing') AND recovery_failed),
        'cinema_provisioning_stuck', (SELECT count(*) FROM public.cinema_uploads WHERE state='provisioning' AND created_at < statement_timestamp()-interval '5 minutes'),
        'cinema_processing_stuck', (SELECT count(*) FROM public.cinema_uploads WHERE state='processing' AND created_at < statement_timestamp()-interval '3 hours'),
        'cinema_cleanup_required', (SELECT count(*) FROM public.cinema_uploads WHERE state='error'
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
SELECT public.refresh_recovery_health();
