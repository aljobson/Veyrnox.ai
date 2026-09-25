-- Keep replay tombstones; only provider-confirmed removal releases active capacity.
ALTER TABLE public.cinema_uploads DROP CONSTRAINT IF EXISTS cinema_uploads_state_check;
ALTER TABLE public.cinema_uploads ADD CONSTRAINT cinema_uploads_state_check
  CHECK(state IN ('provisioning','uploading','processing','ready','error','deleting','deleted'));
ALTER TABLE public.cinema_uploads DROP CONSTRAINT IF EXISTS cinema_uploads_content_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS cinema_upload_active_content_idx ON public.cinema_uploads(content_id) WHERE state<>'deleted';
ALTER TABLE public.cinema_uploads ADD COLUMN IF NOT EXISTS delete_key UUID;
ALTER TABLE public.cinema_uploads ADD COLUMN IF NOT EXISTS delete_requested_at TIMESTAMPTZ;
ALTER TABLE public.cinema_uploads ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.cinema_uploads ADD COLUMN IF NOT EXISTS delete_claim UUID;
ALTER TABLE public.cinema_uploads ADD COLUMN IF NOT EXISTS delete_claimed_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS cinema_upload_delete_key_idx ON public.cinema_uploads(creator_id,delete_key) WHERE delete_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS cinema_upload_delete_queue_idx ON public.cinema_uploads(delete_claimed_at NULLS FIRST,id) WHERE state='deleting';

CREATE OR REPLACE FUNCTION public.reserve_cinema_upload(p_auth_id TEXT,p_content_id UUID,p_key UUID,p_size BIGINT,p_fingerprint TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_row public.cinema_uploads%ROWTYPE;
BEGIN
  -- One small, fixed global lock makes the preview account/storage cap exact.
  PERFORM pg_advisory_xact_lock(137,1);
  v_user:=public.cinema_upload_owner(p_auth_id,p_content_id);
  IF v_user IS NULL THEN RETURN jsonb_build_object('error','upload_not_allowed'); END IF;
  PERFORM 1 FROM public.cinema_memberships WHERE user_id=v_user FOR UPDATE;
  IF public.cinema_upload_owner(p_auth_id,p_content_id) IS NULL THEN RETURN jsonb_build_object('error','upload_not_allowed'); END IF;
  IF p_key IS NULL OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 2147483648 OR p_fingerprint IS NULL OR p_fingerprint !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('error','invalid_upload'); END IF;
  SELECT * INTO v_row FROM public.cinema_uploads WHERE creator_id=v_user AND create_key=p_key;
  IF FOUND AND (v_row.content_id<>p_content_id OR v_row.file_size<>p_size OR v_row.fingerprint<>p_fingerprint) THEN RETURN jsonb_build_object('error','idempotency_conflict'); END IF;
  IF FOUND AND v_row.state='deleted' THEN RETURN jsonb_build_object('error','upload_removed'); END IF;
  SELECT * INTO v_row FROM public.cinema_uploads WHERE content_id=p_content_id AND state<>'deleted';
  IF FOUND THEN
    IF v_row.file_size<>p_size OR v_row.fingerprint<>p_fingerprint THEN RETURN jsonb_build_object('error','upload_exists'); END IF;
    RETURN to_jsonb(v_row)||jsonb_build_object('claimed',false);
  END IF;
  IF (SELECT count(*) FROM public.cinema_uploads WHERE state<>'deleted')>=100 OR (SELECT count(*) FROM public.cinema_uploads WHERE creator_id=v_user AND state<>'deleted')>=10
    OR (SELECT count(*) FROM public.cinema_uploads WHERE created_at>now()-interval '24 hours')>=100
    OR (SELECT count(*) FROM public.cinema_uploads WHERE creator_id=v_user AND created_at>now()-interval '24 hours')>=10 THEN RETURN jsonb_build_object('error','upload_capacity_reached'); END IF;
  INSERT INTO public.cinema_uploads(content_id,creator_id,create_key,file_size,fingerprint)
    VALUES(p_content_id,v_user,p_key,p_size,p_fingerprint) RETURNING * INTO v_row;
  RETURN to_jsonb(v_row)||jsonb_build_object('claimed',true);
END $$;

CREATE OR REPLACE FUNCTION public.attach_cinema_upload(p_id UUID,p_uid TEXT,p_url TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row public.cinema_uploads%ROWTYPE;
BEGIN
  IF p_uid IS NULL OR p_uid !~ '^[A-Za-z0-9]{32}$' OR p_url IS NULL OR length(p_url)>2048
    OR p_url !~ '^https://upload\.(videodelivery\.net|cloudflarestream\.com)/[^[:space:]#]+$' THEN RETURN jsonb_build_object('error','invalid_upload'); END IF;
  SELECT * INTO v_row FROM public.cinema_uploads WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','upload_not_found'); END IF;
  IF v_row.state IN ('deleting','deleted') THEN RETURN jsonb_build_object('error','upload_removed'); END IF;
  IF v_row.stream_uid IS NOT NULL THEN
    IF v_row.stream_uid<>p_uid OR v_row.upload_url<>p_url THEN RETURN jsonb_build_object('error','idempotency_conflict'); END IF;
    RETURN jsonb_build_object('ok',true);
  END IF;
  UPDATE public.cinema_uploads SET stream_uid=p_uid,upload_url=p_url,state='uploading' WHERE id=p_id;
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.read_cinema_upload(p_auth_id TEXT,p_content_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row public.cinema_uploads%ROWTYPE;
BEGIN
  IF public.cinema_upload_owner(p_auth_id,p_content_id) IS NULL THEN RETURN jsonb_build_object('error','upload_not_allowed'); END IF;
  SELECT * INTO v_row FROM public.cinema_uploads WHERE content_id=p_content_id AND state<>'deleted';
  RETURN jsonb_build_object('upload',CASE WHEN FOUND THEN to_jsonb(v_row) ELSE NULL END);
END $$;

CREATE OR REPLACE FUNCTION public.observe_cinema_upload(p_uid TEXT,p_state TEXT,p_observed_at TIMESTAMPTZ,p_duration NUMERIC,p_width INTEGER,p_height INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row public.cinema_uploads%ROWTYPE;
BEGIN
  IF p_uid IS NULL OR p_state IS NULL OR p_state NOT IN ('processing','ready','error') OR p_observed_at IS NULL
    OR p_observed_at>now()+interval '5 seconds' THEN RETURN jsonb_build_object('error','invalid_observation'); END IF;
  IF p_state='ready' AND (p_duration IS NULL OR p_duration NOT BETWEEN 0.1 AND 600 OR p_width IS NULL OR p_width<1 OR p_height IS NULL OR p_height<1) THEN RETURN jsonb_build_object('error','invalid_observation'); END IF;
  SELECT * INTO v_row FROM public.cinema_uploads WHERE stream_uid=p_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ignored',true); END IF;
  IF v_row.state IN ('ready','error','deleting','deleted') OR (v_row.observed_at IS NOT NULL AND v_row.observed_at>=p_observed_at) THEN RETURN jsonb_build_object('ok',true,'idempotent',true); END IF;
  UPDATE public.cinema_uploads SET state=p_state,observed_at=p_observed_at,duration_seconds=p_duration,width=p_width,height=p_height,
    upload_url=CASE WHEN p_state IN ('ready','error') THEN NULL ELSE upload_url END WHERE id=v_row.id;
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.reserve_cinema_upload(TEXT,UUID,UUID,BIGINT,TEXT),public.attach_cinema_upload(UUID,TEXT,TEXT),public.read_cinema_upload(TEXT,UUID),public.observe_cinema_upload(TEXT,TEXT,TIMESTAMPTZ,NUMERIC,INTEGER,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_cinema_upload(TEXT,UUID,UUID,BIGINT,TEXT),public.attach_cinema_upload(UUID,TEXT,TEXT),public.read_cinema_upload(TEXT,UUID),public.observe_cinema_upload(TEXT,TEXT,TIMESTAMPTZ,NUMERIC,INTEGER,INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.request_cinema_upload_removal(p_auth_id TEXT,p_content_id UUID,p_upload_id UUID,p_key UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_row public.cinema_uploads%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(137,1);
  v_user:=public.cinema_upload_owner(p_auth_id,p_content_id);
  IF v_user IS NULL THEN RETURN jsonb_build_object('error','upload_not_allowed'); END IF;
  PERFORM 1 FROM public.cinema_memberships WHERE user_id=v_user FOR UPDATE;
  IF public.cinema_upload_owner(p_auth_id,p_content_id) IS NULL THEN RETURN jsonb_build_object('error','upload_not_allowed'); END IF;
  IF p_key IS NULL OR p_upload_id IS NULL THEN RETURN jsonb_build_object('error','invalid_upload'); END IF;
  IF EXISTS(SELECT 1 FROM public.cinema_uploads WHERE creator_id=v_user AND delete_key=p_key AND id<>p_upload_id) THEN
    RETURN jsonb_build_object('error','idempotency_conflict');
  END IF;
  SELECT * INTO v_row FROM public.cinema_uploads WHERE id=p_upload_id AND content_id=p_content_id AND creator_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','upload_not_allowed'); END IF;
  IF v_row.state IN ('deleting','deleted') THEN RETURN jsonb_build_object('ok',true); END IF;
  -- An unknown provisioning outcome must never be mistaken for absent media.
  IF v_row.stream_uid IS NULL THEN RETURN jsonb_build_object('error','upload_needs_reconciliation'); END IF;
  UPDATE public.cinema_uploads SET state='deleting',upload_url=NULL,delete_key=p_key,delete_requested_at=now(),
    recovery_claim=NULL,recovery_claimed_at=NULL,recovery_checked_at=NULL,recovery_failed=false WHERE id=p_upload_id;
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.claim_cinema_upload_removals(p_key UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_items JSONB;
BEGIN
  IF p_key IS NULL THEN RETURN jsonb_build_object('error','invalid_claim'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_key::TEXT,139));
  IF NOT EXISTS(SELECT 1 FROM public.cinema_uploads WHERE delete_claim=p_key) THEN
    WITH candidates AS (
      SELECT id FROM public.cinema_uploads WHERE state='deleting' AND stream_uid IS NOT NULL
        AND (delete_claimed_at IS NULL OR delete_claimed_at<=now()-interval '5 minutes')
      ORDER BY delete_claimed_at NULLS FIRST,id LIMIT 10 FOR UPDATE SKIP LOCKED
    ) UPDATE public.cinema_uploads u SET delete_claim=p_key,delete_claimed_at=now() FROM candidates c WHERE u.id=c.id;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'stream_uid',stream_uid) ORDER BY id),'[]'::JSONB)
    INTO v_items FROM public.cinema_uploads WHERE delete_claim=p_key AND state='deleting';
  RETURN jsonb_build_object('items',v_items);
END $$;

-- Called only after an affirmative successful provider DELETE response.
CREATE OR REPLACE FUNCTION public.finish_cinema_upload_removal(p_id UUID,p_key UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(137,1);
  UPDATE public.cinema_uploads SET state='deleted',deleted_at=clock_timestamp(),stream_uid=NULL,upload_url=NULL,
    duration_seconds=NULL,width=NULL,height=NULL
    WHERE id=p_id AND state='deleting' AND delete_claim=p_key;
  IF FOUND OR EXISTS(SELECT 1 FROM public.cinema_uploads WHERE id=p_id AND state='deleted' AND delete_claim=p_key) THEN
    RETURN jsonb_build_object('ok',true);
  END IF;
  RETURN jsonb_build_object('error','stale_claim');
END $$;
REVOKE ALL ON FUNCTION public.request_cinema_upload_removal(TEXT,UUID,UUID,UUID),public.claim_cinema_upload_removals(UUID),public.finish_cinema_upload_removal(UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_cinema_upload_removal(TEXT,UUID,UUID,UUID),public.claim_cinema_upload_removals(UUID),public.finish_cinema_upload_removal(UUID,UUID) TO service_role;

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
SELECT public.refresh_recovery_health();
