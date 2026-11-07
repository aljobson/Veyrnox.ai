-- ADR-0083 amendment 4: recheck under lock and defer instead of spend an attempt.
-- Lock order: pg_advisory_xact_lock(278, key) (clawback only) -> credit_balances
-- by user_id ascending -> users by id -> jobs -> social_post_targets -> assets
-- by id ascending -> content_scans -> evidence_holds / content_reports / asset_reap_queue.
-- Expiry uses SKIP LOCKED; defer_content_scan locks only a scan. Clawback reads
-- target state without a new lock, under the balance lock also used by its writers.
-- Existing erase_account deviations remain: users before credit_balances, and
-- assets before posts/targets. Detected deadlocks are retryable; erasure is unchanged.
BEGIN;

-- R2: expire only rows locked and deleted.
CREATE OR REPLACE FUNCTION public.expire_assets(p_batch_size INT DEFAULT 500)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_moved INT;
BEGIN
    WITH doomed AS (
        SELECT id, r2_key FROM public.assets
         WHERE expires_at IS NOT NULL AND expires_at <= now() AND held_at IS NULL
         ORDER BY expires_at, id LIMIT p_batch_size FOR UPDATE SKIP LOCKED
    ), gone AS (
        DELETE FROM public.assets
         WHERE id IN (SELECT id FROM doomed) AND held_at IS NULL
        RETURNING r2_key
    ), queued AS (
        INSERT INTO public.asset_reap_queue (r2_key)
        SELECT r2_key FROM gone ON CONFLICT (r2_key) DO NOTHING
    )
    SELECT count(*) INTO v_moved FROM gone;
    RETURN v_moved;
END $$;
REVOKE ALL ON FUNCTION public.expire_assets(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_assets(INT) TO service_role;

-- R1 / R4: authorize sources and preserve submitted state.
CREATE OR REPLACE FUNCTION public.authorize_social_target_dispatch(p_target_id UUID,p_claim_key UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.social_post_targets%ROWTYPE; v_held BOOLEAN := false; v_scanning BOOLEAN := false; v_reset BOOLEAN := false; v_asset RECORD; v_code TEXT;
BEGIN
 IF p_claim_key IS NULL THEN RETURN jsonb_build_object('ok',false,'code','CLAIM_KEY_REQUIRED'); END IF;
 SELECT * INTO v FROM public.social_post_targets WHERE id=p_target_id FOR UPDATE;
 IF v.id IS NULL OR v.publish_status <> 'publishing' OR NOT (v.claim_key IS NOT DISTINCT FROM p_claim_key) THEN
  RETURN jsonb_build_object('ok',false,'code','CLAIM_LOST');
 END IF;
 FOR v_asset IN SELECT a.held_at FROM public.assets a JOIN public.social_post_media m ON m.source_job_id=a.job_id
  WHERE m.post_id=v.post_id ORDER BY a.id FOR UPDATE OF a
 LOOP
  v_held := v_held OR v_asset.held_at IS NOT NULL;
 END LOOP;
 IF v_held THEN
  v_code := 'MEDIA_HELD';
 ELSIF EXISTS (SELECT 1 FROM public.social_post_media m JOIN public.evidence_holds h ON h.job_id=m.source_job_id
  WHERE m.post_id=v.post_id AND m.source_job_id IS NOT NULL AND h.released_at IS NULL) THEN
  v_code := 'MEDIA_EVIDENCE_HELD';
 ELSIF EXISTS (SELECT 1 FROM public.social_post_media m JOIN public.social_posts p ON p.id=m.post_id
  WHERE m.post_id=v.post_id AND m.source_job_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM public.assets a JOIN public.jobs j ON j.id=a.job_id
   WHERE a.job_id=m.source_job_id AND j.deleted_at IS NULL AND j.user_id=p.created_by_user_id)) THEN
  v_code := 'MEDIA_REMOVED';
 ELSE
  v_scanning := public.social_post_media_unscanned(v.post_id);
  IF v_scanning THEN v_code := 'MEDIA_SCANNING'; END IF;
 END IF;
 IF v_code IS NOT NULL THEN
  -- Restart unpublished Meta containers on first deferral, preserving submission markers.
  v_reset := v.network IN ('threads','instagram')
   AND (COALESCE(v.claimed_provider_state,'{}'::jsonb) ?| ARRAY['container_id','children','creating']
    OR COALESCE(v.provider_state,'{}'::jsonb) ?| ARRAY['container_id','children','creating'])
   AND NOT (COALESCE(v.claimed_provider_state,'{}'::jsonb) ?| ARRAY['post_id','submission_started'])
   AND NOT (COALESCE(v.provider_state,'{}'::jsonb) ?| ARRAY['post_id','submission_started']);
  UPDATE public.social_post_targets
   SET publish_status=CASE WHEN claimed_from_status='publishing' OR v_reset THEN 'pending' ELSE COALESCE(claimed_from_status,'pending') END,
    attempts=COALESCE(claimed_attempts,GREATEST(attempts-1,0)),
    provider_state=CASE WHEN v_reset THEN '{}'::jsonb WHEN provider_state ?| ARRAY['post_id','submission_started'] THEN provider_state ELSE COALESCE(claimed_provider_state,provider_state) END,
    next_attempt_at=CASE WHEN claimed_from_status='submitted' AND NOT v_reset THEN now()+interval '5 minutes' WHEN claimed_from_status='publishing' OR v_reset THEN now() ELSE next_attempt_at END,
    claim_key=NULL,claimed_from_status=NULL,claimed_attempts=NULL,claimed_provider_state=NULL WHERE id=p_target_id;
  RETURN jsonb_build_object('ok',false,'code',v_code);
 END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.authorize_social_target_dispatch(UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_social_target_dispatch(UUID,UUID) TO service_role;

-- R3: recheck target eligibility after replay.
CREATE OR REPLACE FUNCTION public.admin_credit_clawback_guarded(
    p_auth_id TEXT,
    p_aal TEXT,
    p_mfa_at BIGINT,
    p_user_id UUID,
    p_credits INTEGER,
    p_reason TEXT,
    p_idempotency_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_admin RECORD;
    v_actor TEXT;
    v_seen RECORD;
    v_pack INTEGER;
    v_entry_id UUID;
    v_after INTEGER;
    v_action_id UUID;
    v_target RECORD;
BEGIN
    SELECT u.id, u.email, u.is_admin, u.frozen_at INTO v_admin FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_admin.id IS NULL OR v_admin.is_admin IS NOT TRUE OR v_admin.frozen_at IS NOT NULL OR NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id::text = p_auth_id) THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
    END IF;
    IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,128}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_INVALID');
    END IF;
    IF p_credits IS NULL OR p_credits < 1 OR p_credits > 100000 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CREDITS_INVALID');
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 200 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
    END IF;
    IF p_aal IS DISTINCT FROM 'aal2' OR p_mfa_at IS NULL OR p_mfa_at NOT BETWEEN extract(epoch FROM clock_timestamp())-300 AND extract(epoch FROM clock_timestamp())+5 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'MFA_REQUIRED');
    END IF;
    -- '#' separates the key in a ledger reason, so the actor must not carry one.
    v_actor := left(replace(coalesce(v_admin.email, p_auth_id), '#', '_'), 120);
    IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    -- ADR-0111: a deleted account is a tombstone and its balance is left as it is, with no ledger row.
    IF EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.deleted_at IS NOT NULL) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_DELETED');
    END IF;

    -- The key is globally unique on account_actions; serialise even different targets.
    PERFORM pg_advisory_xact_lock(278, hashtext(p_idempotency_key));
    -- Same locks as financial freezes, in a fixed order, followed by role/Auth locks.
    PERFORM 1 FROM public.credit_balances b WHERE b.user_id IN (v_admin.id,p_user_id) ORDER BY b.user_id FOR UPDATE;
    PERFORM 1 FROM public.users u WHERE u.id=v_admin.id FOR SHARE;
    PERFORM 1 FROM auth.users a WHERE a.id::text=p_auth_id FOR SHARE;
    IF NOT EXISTS(SELECT 1 FROM public.users u JOIN auth.users a ON a.id::text=u.auth_id
        WHERE u.id=v_admin.id AND u.auth_id=p_auth_id AND u.is_admin AND u.frozen_at IS NULL) THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE='42501';
    END IF;
    -- Waiting for a contended lock may have exhausted the MFA freshness window.
    IF p_aal IS DISTINCT FROM 'aal2' OR p_mfa_at IS NULL OR p_mfa_at NOT BETWEEN extract(epoch FROM clock_timestamp())-300 AND extract(epoch FROM clock_timestamp())+5 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'MFA_REQUIRED');
    END IF;
    SELECT a.id, a.ledger_entry_id, a.credits_delta, a.user_id, a.actor_user_id, a.reason, a.action, a.balance_after INTO v_seen
      FROM public.account_actions a WHERE a.idempotency_key = p_idempotency_key;
    IF v_seen.id IS NOT NULL THEN
        IF v_seen.user_id <> p_user_id OR v_seen.credits_delta IS DISTINCT FROM -p_credits OR v_seen.actor_user_id IS DISTINCT FROM v_admin.id
            OR v_seen.action <> 'credit_clawback' OR v_seen.reason IS DISTINCT FROM btrim(p_reason) THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REUSED');
        END IF;
        v_after := v_seen.balance_after;
        RETURN jsonb_build_object('ok', true, 'replayed', true, 'action_id', v_seen.id,
                                   'entry_id', v_seen.ledger_entry_id, 'credits_delta', v_seen.credits_delta,
                                   'balance_after', v_after);
    END IF;

    -- Target state is re-read under the balance lock, after idempotent replay.
    SELECT u.frozen_at, u.deleted_at INTO v_target FROM public.users u WHERE u.id = p_user_id;
    IF v_target.deleted_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_DELETED');
    END IF;
    IF v_target.frozen_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN');
    END IF;

    SELECT b.balance - COALESCE(b.free_balance, 0) - b.subscription_balance INTO v_pack
      FROM public.credit_balances b WHERE b.user_id = p_user_id;
    IF COALESCE(v_pack, 0) < p_credits THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_PACK_CREDITS', 'pack_credits', COALESCE(v_pack, 0));
    END IF;
    INSERT INTO public.ledger_entries(user_id, delta, free_delta, subscription_delta, reason)
    VALUES (p_user_id, -p_credits, 0, 0, 'reverse:admin ' || v_actor || '#' || p_idempotency_key)
    RETURNING id INTO v_entry_id;
    UPDATE public.credit_balances SET balance = balance - p_credits, updated_at = now() WHERE user_id = p_user_id RETURNING balance INTO v_after;

    INSERT INTO public.account_actions (user_id, action, actor, reason, top_up_id, idempotency_key, ledger_entry_id, credits_delta, actor_user_id, balance_after)
    VALUES (p_user_id, 'credit_clawback', v_actor, btrim(p_reason), NULL, p_idempotency_key, v_entry_id, -p_credits, v_admin.id, v_after)
    RETURNING id INTO v_action_id;

    RETURN jsonb_build_object('ok', true, 'replayed', false, 'action_id', v_action_id,
                               'entry_id', v_entry_id, 'credits_delta', -p_credits, 'balance_after', v_after);
END $$;
REVOKE ALL ON FUNCTION public.admin_credit_clawback_guarded(TEXT,TEXT,BIGINT,UUID,INTEGER,TEXT,TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_credit_clawback_guarded(TEXT,TEXT,BIGINT,UUID,INTEGER,TEXT,TEXT) TO service_role;

-- R2: recheck job holds under the asset locks.
CREATE OR REPLACE FUNCTION public.delete_user_job(p_auth_id TEXT, p_job_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user public.users%ROWTYPE;
    v_job  public.jobs%ROWTYPE;
    v_rate JSONB;
BEGIN
    SELECT * INTO v_user FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;

    v_rate := public.consume_job_read_request(v_user.id);
    IF v_rate->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_rate; END IF;

    -- Owner only; the lock serialises two deletes of the same job, so the second sees the first.
    SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id AND user_id = v_user.id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;

    IF v_job.deleted_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'replayed', true);
    END IF;
    -- A chat reply is not a creation (the Library never lists it); chat has its own delete.
    IF v_job.inputs->>'kind' = 'chat' THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;

    -- A person cannot delete their way out of a dispute (ADR-0111).
    IF v_user.frozen_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN'); END IF;

    -- Only a settled job. SUCCEEDED means the file is still being copied; a fal request that has not
    -- closed still holds the prompt, and the sweep will close it.
    IF v_job.state NOT IN ('STORED', 'FAILED', 'REFUNDED')
       OR EXISTS (SELECT 1 FROM public.fal_dispatch d WHERE d.job_id = v_job.id AND d.state <> 'CLOSED') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'IN_PROGRESS');
    END IF;

    -- Preserved material and open reports are not erased on request (ADR-0083).
    IF EXISTS (SELECT 1 FROM public.evidence_holds h WHERE h.job_id = v_job.id AND h.released_at IS NULL)
       OR EXISTS (SELECT 1 FROM public.assets a WHERE a.job_id = v_job.id AND a.held_at IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.content_reports r
                   WHERE r.subject_kind = 'job' AND r.subject_id = v_job.id AND r.status = 'open') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ON_HOLD');
    END IF;

    -- Still in use. A post that failed or was cancelled no longer needs the file.
    IF EXISTS (SELECT 1 FROM public.social_post_media m JOIN public.social_posts p ON p.id = m.post_id
                WHERE m.source_job_id = v_job.id AND p.status IN ('draft', 'scheduled', 'published')) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USED_BY_POST');
    END IF;
    IF EXISTS (SELECT 1 FROM public.cinema_uploads u WHERE u.source_job_id = v_job.id) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USED_BY_CINEMA');
    END IF;
    IF EXISTS (SELECT 1 FROM public.film_library_masters m WHERE m.source_job_id = v_job.id) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USED_BY_LIBRARY');
    END IF;

    -- Recheck held material after acquiring every source asset in a stable order.
    PERFORM 1 FROM public.assets WHERE job_id = v_job.id ORDER BY id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.evidence_holds h WHERE h.job_id = v_job.id AND h.released_at IS NULL)
       OR EXISTS (SELECT 1 FROM public.assets a WHERE a.job_id = v_job.id AND a.held_at IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.content_reports r
                   WHERE r.subject_kind = 'job' AND r.subject_id = v_job.id AND r.status = 'open') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ON_HOLD');
    END IF;

    WITH gone AS (
        DELETE FROM public.assets WHERE job_id = v_job.id AND held_at IS NULL RETURNING r2_key
    )
    INSERT INTO public.asset_reap_queue (r2_key)
    SELECT r2_key FROM gone ON CONFLICT (r2_key) DO NOTHING;

    -- Intermediate output of a multi-step job (script text, scene and voice files).
    INSERT INTO public.asset_reap_queue (r2_key)
    SELECT s.output_r2_key FROM public.job_steps s WHERE s.job_id = v_job.id AND s.output_r2_key IS NOT NULL
    ON CONFLICT (r2_key) DO NOTHING;
    UPDATE public.job_steps SET output_r2_key = NULL, output_text = NULL WHERE job_id = v_job.id;

    -- The prompt, wherever it is kept. The job row, its state, model and credits stay: they back the ledger.
    UPDATE public.fal_dispatch SET payload = '{}'::jsonb WHERE job_id = v_job.id;
    UPDATE public.jobs SET inputs = '{}'::jsonb, deleted_at = now(), updated_at = now() WHERE id = v_job.id;

    RETURN jsonb_build_object('ok', true, 'replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.delete_user_job(TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_job(TEXT,UUID) TO service_role;

-- R5: assets before report resolution.
CREATE OR REPLACE FUNCTION public.resolve_content_report(
    p_auth_id TEXT,
    p_report_id UUID,
    p_resolution TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_admin RECORD;
    v_status TEXT;
    v_report RECORD;
BEGIN
    SELECT u.id, u.email, u.is_admin INTO v_admin FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_admin.id IS NULL OR v_admin.is_admin IS NOT TRUE THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
    END IF;
    IF p_resolution IS NULL OR length(btrim(p_resolution)) NOT BETWEEN 3 AND 500 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'RESOLUTION_REQUIRED');
    END IF;
    SELECT r.source, r.subject_kind, r.subject_id INTO v_report FROM public.content_reports r WHERE r.id = p_report_id;
    IF v_report.source = 'scanner' AND v_report.subject_kind = 'job' THEN
        PERFORM 1 FROM public.assets WHERE job_id = v_report.subject_id ORDER BY id FOR UPDATE;
    END IF;
    SELECT r.status INTO v_status FROM public.content_reports r WHERE r.id = p_report_id FOR UPDATE;
    IF v_status IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'REPORT_NOT_FOUND');
    END IF;
    IF v_status <> 'open' THEN
        RETURN jsonb_build_object('ok', true, 'report_id', p_report_id, 'replayed', true);
    END IF;
    IF v_report.source = 'scanner' AND v_report.subject_kind = 'job'
       AND EXISTS (SELECT 1 FROM public.assets WHERE job_id = v_report.subject_id AND held_at IS NOT NULL) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'HOLD_ACTIVE');
    END IF;
    UPDATE public.content_reports
       SET status = 'resolved', resolved_at = now(), resolved_by = left(coalesce(v_admin.email, p_auth_id), 120), resolution = btrim(p_resolution)
     WHERE id = p_report_id;
    RETURN jsonb_build_object('ok', true, 'report_id', p_report_id, 'replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.resolve_content_report(TEXT,UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_content_report(TEXT,UUID,TEXT) TO service_role;

-- R6: return the attempt once and retain outage visibility.
CREATE OR REPLACE FUNCTION public.defer_content_scan(p_scan_id UUID, p_claim_token UUID, p_backoff_seconds INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v public.content_scans%ROWTYPE;
    v_backoff INTEGER := greatest(30, least(coalesce(p_backoff_seconds, 300), 1800));
BEGIN
    SELECT * INTO v FROM public.content_scans WHERE id = p_scan_id FOR UPDATE;
    IF v.id IS NULL OR v.status <> 'scanning' OR p_claim_token IS NULL OR v.claim_token IS DISTINCT FROM p_claim_token THEN
        RETURN jsonb_build_object('ok', false, 'code', 'STALE_CLAIM');
    END IF;
    UPDATE public.content_scans
       SET attempts = greatest(attempts - 1, 0), claim_token = NULL,
           lease_until = clock_timestamp() + make_interval(secs => v_backoff)
     WHERE id = p_scan_id;
    RETURN jsonb_build_object('ok', true, 'backoff_seconds', v_backoff);
END $$;
REVOKE ALL ON FUNCTION public.defer_content_scan(UUID,UUID,INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.defer_content_scan(UUID,UUID,INTEGER) TO service_role;

-- R6: deferred scans remain visible during backoff.
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
                UNION ALL SELECT 'video_agent' WHERE EXISTS (SELECT 1 FROM public.model_catalog WHERE active AND id = 'video-agent')
                UNION ALL SELECT 'fal_dispatch' WHERE EXISTS (SELECT 1 FROM public.fal_dispatch d JOIN public.jobs j ON j.id = d.job_id WHERE j.state = 'DEBITED')
                UNION ALL SELECT 'content_scan' WHERE EXISTS (SELECT 1 FROM public.content_scan_monitor m WHERE m.armed
                    AND (m.armed_at < statement_timestamp()-interval '20 minutes' OR EXISTS (SELECT 1 FROM public.worker_task_health sh
                        WHERE sh.task='content_scan' AND sh.last_attempt > m.armed_at AND NOT sh.last_ok)))) t
            LEFT JOIN public.worker_task_health h ON h.task = t.task
            WHERE h.last_success IS NULL OR NOT h.last_ok OR h.last_success < statement_timestamp() - INTERVAL '20 minutes'),
        'content_scan_overdue', (SELECT count(*) FROM public.content_scan_monitor m LEFT JOIN public.worker_task_health h ON h.task='content_scan'
            WHERE m.armed AND greatest(m.armed_at,h.last_success) < statement_timestamp()-interval '20 minutes'),
        'content_scan_claimable', (SELECT count(*) FROM public.content_scans s
            WHERE s.status='queued' OR (s.status='scanning' AND s.lease_until < statement_timestamp())),
        'content_scan_backlogged', (SELECT count(*) FROM public.content_scans s WHERE EXISTS(SELECT 1 FROM public.content_scan_monitor WHERE armed)
            AND (((s.status='queued' OR (s.status='scanning' AND s.lease_until < statement_timestamp())) AND s.queued_at < statement_timestamp()-interval '30 minutes')
                OR (s.status='scanning' AND s.claim_token IS NULL AND s.lease_until > statement_timestamp()))),
        'content_scan_exhausted', (SELECT CASE WHEN count(*) > 20 THEN count(*) ELSE 0 END FROM public.content_scans s
            WHERE EXISTS(SELECT 1 FROM public.content_scan_monitor WHERE armed) AND s.status='unavailable' AND s.scores->>'reason' IS DISTINCT FROM 'asset_gone' AND s.decided_at > statement_timestamp()-interval '24 hours'),
        'fal_dispatch_unknown', (SELECT count(*) FROM public.fal_dispatch d JOIN public.jobs j ON j.id = d.job_id
            WHERE j.state = 'DEBITED' AND (d.state = 'UNKNOWN' OR (d.state = 'STARTED' AND d.started_at < statement_timestamp() - interval '2 minutes'))),
        'fal_dispatch_overdue', (SELECT count(*) FROM public.fal_dispatch d JOIN public.jobs j ON j.id = d.job_id
            WHERE j.state = 'DEBITED' AND ((d.state = 'READY' AND d.created_at < statement_timestamp() - interval '10 minutes')
                OR (d.state = 'ACCEPTED' AND d.projected_at IS NULL AND d.resolved_at < statement_timestamp() - interval '5 minutes'))),
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

COMMIT;
