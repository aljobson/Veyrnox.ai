-- Crun Suno shared-state consumers (phase B2). No route is activated here.
BEGIN;

-- The existing provider policy row remains the single Crun account circuit.
-- These columns fence delayed 401/402/403 evidence across an operator resume.
ALTER TABLE public.provider_spend_provider_policy
  ADD COLUMN IF NOT EXISTS admission_fence BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS admission_observed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admission_resumed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admission_reason TEXT;

CREATE OR REPLACE FUNCTION public.pause_crun_account_admission(p_reason TEXT,p_observed_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.provider_spend_provider_policy%ROWTYPE;
BEGIN
 IF p_reason IS NULL OR p_reason !~ '^[a-z0-9_]{1,64}$' OR p_observed_at IS NULL
    OR p_observed_at>statement_timestamp()+interval '1 minute' THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
 END IF;
 SELECT * INTO v FROM public.provider_spend_provider_policy WHERE provider='crun' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','POLICY_MISSING'); END IF;
 IF p_observed_at<=COALESCE(v.admission_resumed_at,'-infinity'::timestamptz)
    OR p_observed_at<COALESCE(v.admission_observed_at,'-infinity'::timestamptz) THEN
  RETURN jsonb_build_object('ok',false,'code','STALE_EVIDENCE','fence',v.admission_fence);
 END IF;
 IF NOT v.admission_open AND p_observed_at=v.admission_observed_at THEN
  RETURN jsonb_build_object('ok',true,'idempotent',true,'fence',v.admission_fence);
 END IF;
 UPDATE public.provider_spend_provider_policy SET admission_open=false,admission_fence=admission_fence+1,
  admission_observed_at=p_observed_at,admission_reason=p_reason,updated_at=statement_timestamp()
  WHERE provider='crun' RETURNING * INTO v;
 RETURN jsonb_build_object('ok',true,'idempotent',false,'fence',v.admission_fence);
END $$;
REVOKE ALL ON FUNCTION public.pause_crun_account_admission(TEXT,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pause_crun_account_admission(TEXT,TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION public.resume_crun_account_admission(p_expected_fence BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.provider_spend_provider_policy%ROWTYPE;
BEGIN
 SELECT * INTO v FROM public.provider_spend_provider_policy WHERE provider='crun' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','POLICY_MISSING'); END IF;
 IF v.admission_open OR p_expected_fence IS NULL OR v.admission_fence<>p_expected_fence THEN
  RETURN jsonb_build_object('ok',false,'code','STALE_FENCE','fence',v.admission_fence);
 END IF;
 UPDATE public.provider_spend_provider_policy SET admission_open=true,admission_fence=admission_fence+1,
  admission_resumed_at=statement_timestamp(),admission_reason=NULL,updated_at=statement_timestamp()
  WHERE provider='crun' RETURNING * INTO v;
 RETURN jsonb_build_object('ok',true,'fence',v.admission_fence,'resumed_at',v.admission_resumed_at);
END $$;
REVOKE ALL ON FUNCTION public.resume_crun_account_admission(BIGINT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resume_crun_account_admission(BIGINT) TO service_role;

-- Account-wide TaskInfo sliding window. The advisory lock makes the count
-- exact across isolates at the one-second boundary.
CREATE TABLE IF NOT EXISTS public.crun_taskinfo_reservations(
 reservation_key TEXT PRIMARY KEY CHECK(reservation_key~'^[A-Za-z0-9._:-]{8,160}$'),
 purpose TEXT NOT NULL CHECK(purpose~'^[a-z0-9._:-]{2,64}$'),
 reserved_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);
ALTER TABLE public.crun_taskinfo_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crun_taskinfo_reservations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crun_taskinfo_reservations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON TABLE public.crun_taskinfo_reservations TO service_role;
CREATE INDEX IF NOT EXISTS crun_taskinfo_reservations_window_idx
 ON public.crun_taskinfo_reservations(reserved_at);

DO $$
DECLARE v_def TEXT; v_names TEXT[];
BEGIN
 SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c
  WHERE c.conrelid='public.worker_task_health'::regclass AND c.conname='worker_task_health_task_check';
 IF v_def IS NULL THEN RAISE EXCEPTION 'worker_task_health_task_check is missing'; END IF;
 IF v_def NOT LIKE '%''crun_dispatch''%' THEN
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_names
   FROM regexp_matches(v_def,'''([a-z_]+)''::text','g') AS m;
  v_names:=array_append(v_names,'crun_dispatch');
  ALTER TABLE public.worker_task_health DROP CONSTRAINT worker_task_health_task_check;
  EXECUTE format('ALTER TABLE public.worker_task_health ADD CONSTRAINT worker_task_health_task_check CHECK (task IN (%s))',
   (SELECT string_agg(quote_literal(k),',' ORDER BY k) FROM unnest(v_names) AS k));
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.reserve_crun_taskinfo_slot(p_reservation_key TEXT,p_purpose TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_now TIMESTAMPTZ; v_count INTEGER; v_retry INTEGER;
BEGIN
 IF p_reservation_key IS NULL OR p_reservation_key!~'^[A-Za-z0-9._:-]{8,160}$'
    OR p_purpose IS NULL OR p_purpose!~'^[a-z0-9._:-]{2,64}$' THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crun:taskinfo:account',0));
 v_now:=clock_timestamp();
 IF EXISTS(SELECT 1 FROM public.crun_taskinfo_reservations WHERE reservation_key=p_reservation_key) THEN
  RETURN jsonb_build_object('ok',true,'idempotent',true);
 END IF;
 DELETE FROM public.crun_taskinfo_reservations WHERE reserved_at<=v_now-interval '1 second';
 SELECT count(*) INTO v_count FROM public.crun_taskinfo_reservations
  WHERE reserved_at>v_now-interval '1 second';
 IF v_count>=15 THEN
  SELECT GREATEST(1,ceil(extract(epoch FROM min(reserved_at)+interval '1 second'-v_now)))::INTEGER
   INTO v_retry FROM public.crun_taskinfo_reservations WHERE reserved_at>v_now-interval '1 second';
  RETURN jsonb_build_object('ok',false,'code','CRUN_TASKINFO_RATE_LIMITED',
   'retry_after_seconds',COALESCE(v_retry,1));
 END IF;
 INSERT INTO public.crun_taskinfo_reservations(reservation_key,purpose,reserved_at)
  VALUES(p_reservation_key,p_purpose,v_now);
 RETURN jsonb_build_object('ok',true,'idempotent',false,'remaining',14-v_count);
END $$;
REVOKE ALL ON FUNCTION public.reserve_crun_taskinfo_slot(TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_crun_taskinfo_slot(TEXT,TEXT) TO service_role;

ALTER TABLE public.crun_dispatch ADD COLUMN IF NOT EXISTS last_authoritative_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.record_crun_task_status(p_job_id UUID,p_status TEXT,p_observed_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.crun_dispatch%ROWTYPE;
BEGIN
 IF p_status NOT IN ('pending','running','success','failed') OR p_observed_at IS NULL
    OR p_observed_at>statement_timestamp()+interval '1 minute' THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
 END IF;
 PERFORM 1 FROM public.jobs WHERE id=p_job_id FOR UPDATE;
 SELECT * INTO d FROM public.crun_dispatch WHERE job_id=p_job_id FOR UPDATE;
 IF NOT FOUND OR d.state NOT IN ('ACCEPTED','CLOSED') OR d.provider_job_id IS NULL THEN
  RETURN jsonb_build_object('ok',false,'code','JOB_NOT_OBSERVABLE');
 END IF;
 IF d.last_authoritative_at IS NOT NULL AND p_observed_at<d.last_authoritative_at THEN
  RETURN jsonb_build_object('ok',false,'code','STALE_EVIDENCE');
 END IF;
 IF d.last_authoritative_at=p_observed_at AND d.last_authoritative_status=p_status THEN
  RETURN jsonb_build_object('ok',true,'idempotent',true);
 END IF;
 UPDATE public.crun_dispatch SET last_authoritative_status=p_status,last_authoritative_at=p_observed_at
  WHERE job_id=p_job_id;
 RETURN jsonb_build_object('ok',true,'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.record_crun_task_status(UUID,TEXT,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_crun_task_status(UUID,TEXT,TIMESTAMPTZ) TO service_role;

-- Ages only: no prompt, lyrics or provider text crosses this ops surface.
CREATE OR REPLACE FUNCTION public.crun_dispatch_health(p_accepted_unobservable_minutes INTEGER DEFAULT 5)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
  'accepted_unobservable',count(*) FILTER(WHERE d.state='ACCEPTED' AND d.last_authoritative_at IS NULL
    AND d.resolved_at<statement_timestamp()-make_interval(mins=>GREATEST(1,LEAST(COALESCE(p_accepted_unobservable_minutes,5),60)))),
  'accepted_unobservable_max_age_minutes',COALESCE(max(floor(extract(epoch FROM statement_timestamp()-d.resolved_at)/60))
    FILTER(WHERE d.state='ACCEPTED' AND d.last_authoritative_at IS NULL),0),
  'authoritative_pending',count(*) FILTER(WHERE d.state='ACCEPTED' AND d.last_authoritative_at IS NOT NULL
    AND d.last_authoritative_status IN ('pending','running')
    AND d.resolved_at<statement_timestamp()-interval '45 minutes'),
  'authoritative_pending_max_age_minutes',COALESCE(max(floor(extract(epoch FROM statement_timestamp()-d.resolved_at)/60))
    FILTER(WHERE d.state='ACCEPTED' AND d.last_authoritative_at IS NOT NULL
      AND d.last_authoritative_status IN ('pending','running')),0),
  'unknown',count(*) FILTER(WHERE d.state='UNKNOWN' AND d.resolved_at<statement_timestamp()-interval '10 minutes'),
  'unknown_max_age_minutes',COALESCE(max(floor(extract(epoch FROM statement_timestamp()-d.resolved_at)/60))
    FILTER(WHERE d.state='UNKNOWN'),0))
 FROM public.crun_dispatch d
$$;
REVOKE ALL ON FUNCTION public.crun_dispatch_health(INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crun_dispatch_health(INTEGER) TO service_role;

-- Claims expose the durable retry data so callers can choose progressive
-- 30/60/120-second deferrals without guessing local history.
CREATE OR REPLACE FUNCTION public.claim_crun_dispatch(p_job_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.crun_dispatch%ROWTYPE; v_open BOOLEAN; v_retry_at TIMESTAMPTZ;
BEGIN
 PERFORM 1 FROM public.jobs j WHERE j.id=p_job_id AND j.state='DEBITED' AND j.provider_job_id IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO d FROM public.crun_dispatch WHERE job_id=p_job_id FOR UPDATE;
 IF NOT FOUND OR d.state NOT IN ('READY','DEFERRED') OR (d.state='DEFERRED' AND d.retry_at>statement_timestamp()) THEN RETURN NULL; END IF;
 SELECT NOT admission_open INTO v_open FROM public.provider_spend_provider_policy WHERE provider='crun';
 IF COALESCE(v_open,true) OR EXISTS(SELECT 1 FROM public.model_routes r WHERE r.supplier='crun' AND r.endpoint=d.endpoint
    AND r.breaker_opened_at IS NOT NULL) OR EXISTS(SELECT 1 FROM public.crun_suno_model_breakers b
    WHERE b.endpoint=d.endpoint AND b.is_open AND b.suno_model=COALESCE(d.payload->'input'->>'suno_model','v6')) THEN
  RETURN jsonb_build_object('held',true,'code','CRUN_UNAVAILABLE');
 END IF;
 v_retry_at:=d.retry_at;
 UPDATE public.crun_dispatch SET state='STARTED',attempt_token=gen_random_uuid(),started_at=statement_timestamp(),
  retry_at=NULL,failure_code=NULL WHERE job_id=p_job_id RETURNING * INTO d;
 RETURN jsonb_build_object('job_id',d.job_id,'attempt_token',d.attempt_token,'endpoint',d.endpoint,'payload',d.payload,
  'attempt_count',d.attempt_count,'retry_at',v_retry_at);
END $$;
REVOKE ALL ON FUNCTION public.claim_crun_dispatch(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_crun_dispatch(UUID) TO service_role;

-- Preserve the latest concurrency/admission body while enriching every replay
-- from its immutable quote. Fresh results already carry this field.
CREATE OR REPLACE FUNCTION public.music_submit_pair(p_auth_id TEXT,p_quote_id UUID,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_active INTEGER; v_replay BOOLEAN; v_result JSONB; v_contract TEXT;
BEGIN
 IF p_quote_id IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id FOR UPDATE;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_user::TEXT||':'||p_idempotency_key,0));
 SELECT EXISTS(SELECT 1 FROM public.music_generation_requests WHERE user_id=v_user AND idempotency_key=p_idempotency_key) INTO v_replay;
 IF NOT v_replay THEN
  SELECT count(*) INTO v_active FROM public.music_generation_requests WHERE user_id=v_user AND status IN ('debited','running');
  IF v_active>=4 THEN RETURN jsonb_build_object('ok',false,'code','CONCURRENCY_LIMIT'); END IF;
 END IF;
 v_result:=private.music_submit_pair_unbounded(p_auth_id,p_quote_id,p_idempotency_key);
 IF v_result->>'ok'='true' AND NOT (v_result ? 'provider_contract') THEN
  SELECT q.provider_contract INTO v_contract FROM public.music_generation_requests r
   JOIN public.music_generation_quotes q ON q.id=r.quote_id
   WHERE r.user_id=v_user AND r.id=(v_result->>'request_id')::UUID;
  v_result:=v_result||jsonb_build_object('provider_contract',v_contract);
 END IF;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.music_submit_pair(TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_submit_pair(TEXT,UUID,TEXT) TO service_role;

-- Cancellation uses the same job-then-dispatch lock order as claim/recovery.
-- The fal branch is byte-for-byte equivalent in eligibility and mutation.
CREATE OR REPLACE FUNCTION public.cancel_user_job(p_auth_id TEXT,p_job_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user public.users%ROWTYPE; v_job public.jobs%ROWTYPE;
 v_fal public.fal_dispatch%ROWTYPE; v_crun public.crun_dispatch%ROWTYPE;
 v_has_fal BOOLEAN:=false; v_has_crun BOOLEAN:=false; v_result JSONB;
BEGIN
 SELECT * INTO v_user FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 v_result:=public.consume_job_read_request(v_user.id);
 IF v_result->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_result; END IF;
 SELECT * INTO v_job FROM public.jobs WHERE id=p_job_id AND user_id=v_user.id FOR UPDATE;
 IF NOT FOUND OR v_job.deleted_at IS NOT NULL OR v_job.inputs->>'kind'='chat' THEN
  RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF v_job.state='REFUNDED' AND v_job.error_code='user_cancelled' THEN
  RETURN jsonb_build_object('ok',true,'replayed',true,'credits',v_job.credits); END IF;
 IF v_job.state IN ('STORED','FAILED','REFUNDED') THEN RETURN jsonb_build_object('ok',false,'code','JOB_FINISHED'); END IF;
 SELECT * INTO v_fal FROM public.fal_dispatch WHERE job_id=v_job.id FOR UPDATE; v_has_fal:=FOUND;
 SELECT * INTO v_crun FROM public.crun_dispatch WHERE job_id=v_job.id FOR UPDATE; v_has_crun:=FOUND;
 IF v_job.state<>'DEBITED' OR v_job.provider_job_id IS NOT NULL
    OR (v_has_fal=v_has_crun)
    OR (v_has_fal AND v_fal.state<>'READY')
    OR (v_has_crun AND (v_crun.state NOT IN ('READY','DEFERRED') OR v_crun.provider_job_id IS NOT NULL)) THEN
  RETURN jsonb_build_object('ok',false,'code','JOB_STARTED');
 END IF;
 PERFORM 1 FROM public.credit_balances WHERE user_id=v_user.id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.users WHERE id=v_user.id AND frozen_at IS NOT NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','ACCOUNT_FROZEN'); END IF;
 UPDATE public.jobs SET error_code='user_cancelled' WHERE id=v_job.id;
 IF v_has_fal THEN
  UPDATE public.fal_dispatch SET state='CLOSED',resolved_at=now() WHERE job_id=v_job.id AND state='READY';
 ELSE
  UPDATE public.crun_dispatch SET state='CLOSED',attempt_token=NULL,retry_at=NULL,resolved_at=now()
   WHERE job_id=v_job.id AND state IN ('READY','DEFERRED') AND provider_job_id IS NULL;
 END IF;
 v_result:=public.ledger_refund(v_job.id,v_user.id,v_job.credits,'refund:user_cancelled');
 IF v_result->>'ok' IS DISTINCT FROM 'true' OR v_result->>'idempotent'='true' THEN
  RAISE EXCEPTION 'JOB_CANCEL_REFUND_INVARIANT'; END IF;
 RETURN jsonb_build_object('ok',true,'replayed',false,'credits',v_job.credits);
END $$;
REVOKE ALL ON FUNCTION public.cancel_user_job(TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_user_job(TEXT,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.get_user_job_cancel(p_auth_id TEXT,p_job_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user public.users%ROWTYPE; v_job public.jobs%ROWTYPE; v_rate JSONB;
BEGIN
 SELECT * INTO v_user FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 v_rate:=public.consume_job_read_request(v_user.id);
 IF v_rate->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_rate; END IF;
 SELECT * INTO v_job FROM public.jobs WHERE id=p_job_id AND user_id=v_user.id;
 IF NOT FOUND OR v_job.deleted_at IS NOT NULL OR v_job.inputs->>'kind' IN ('chat','editor_ai_edit','speech_analysis') THEN
  RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 RETURN jsonb_build_object('ok',true,'credits',v_job.credits,'cancellable',
  v_job.state='DEBITED' AND v_job.provider_job_id IS NULL AND v_user.frozen_at IS NULL AND (
   EXISTS(SELECT 1 FROM public.fal_dispatch WHERE job_id=v_job.id AND state='READY') OR
   EXISTS(SELECT 1 FROM public.crun_dispatch WHERE job_id=v_job.id AND state IN ('READY','DEFERRED') AND provider_job_id IS NULL)));
END $$;
REVOKE ALL ON FUNCTION public.get_user_job_cancel(TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_job_cancel(TEXT,UUID) TO service_role;

-- Latest 0508 deletion body plus the Crun live-dispatch guard and payload scrub.
CREATE OR REPLACE FUNCTION public.delete_user_job(p_auth_id TEXT,p_job_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user public.users%ROWTYPE; v_job public.jobs%ROWTYPE; v_rate JSONB;
BEGIN
 SELECT * INTO v_user FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 v_rate:=public.consume_job_read_request(v_user.id);
 IF v_rate->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_rate; END IF;
 SELECT * INTO v_job FROM public.jobs WHERE id=p_job_id AND user_id=v_user.id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF v_job.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'replayed',true); END IF;
 IF v_job.inputs->>'kind' IN ('chat','editor_ai_edit','speech_analysis') THEN
  RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF v_user.frozen_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','ACCOUNT_FROZEN'); END IF;
 IF v_job.state NOT IN ('STORED','FAILED','REFUNDED')
    OR EXISTS(SELECT 1 FROM public.fal_dispatch d WHERE d.job_id=v_job.id
      AND d.state NOT IN ('CLOSED','ACCEPTED','REJECTED'))
    OR EXISTS(SELECT 1 FROM public.crun_dispatch d WHERE d.job_id=v_job.id
      AND d.state NOT IN ('CLOSED','REJECTED')) THEN
  RETURN jsonb_build_object('ok',false,'code','IN_PROGRESS');
 END IF;
 IF EXISTS(SELECT 1 FROM public.evidence_holds h WHERE h.job_id=v_job.id AND h.released_at IS NULL)
    OR EXISTS(SELECT 1 FROM public.assets a WHERE a.job_id=v_job.id AND a.held_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.content_reports r WHERE r.subject_kind='job' AND r.subject_id=v_job.id AND r.status='open') THEN
  RETURN jsonb_build_object('ok',false,'code','ON_HOLD');
 END IF;
 IF EXISTS(SELECT 1 FROM public.social_post_media m JOIN public.social_posts p ON p.id=m.post_id
    WHERE m.source_job_id=v_job.id AND p.status IN ('draft','scheduled','published')) THEN
  RETURN jsonb_build_object('ok',false,'code','USED_BY_POST'); END IF;
 IF EXISTS(SELECT 1 FROM public.cinema_uploads u WHERE u.source_job_id=v_job.id) THEN
  RETURN jsonb_build_object('ok',false,'code','USED_BY_CINEMA'); END IF;
 IF EXISTS(SELECT 1 FROM public.film_library_masters m WHERE m.source_job_id=v_job.id) THEN
  RETURN jsonb_build_object('ok',false,'code','USED_BY_LIBRARY'); END IF;
 IF EXISTS(SELECT 1 FROM public.music_song_versions v WHERE v.job_id=v_job.id)
    OR EXISTS(SELECT 1 FROM public.music_generation_candidates c WHERE c.job_id=v_job.id)
    OR EXISTS(SELECT 1 FROM public.music_stem_requests r WHERE r.job_id=v_job.id)
    OR EXISTS(SELECT 1 FROM public.music_target_stem_requests r WHERE r.job_id=v_job.id)
    OR EXISTS(SELECT 1 FROM public.music_track_add_requests r WHERE r.track_job_id=v_job.id OR r.upload_job_id=v_job.id)
    OR EXISTS(SELECT 1 FROM public.assets a JOIN public.music_song_versions v ON v.audio_asset_id=a.id WHERE a.job_id=v_job.id)
    OR EXISTS(SELECT 1 FROM public.assets a JOIN public.music_target_stem_assets t
      ON a.id IN (t.target_asset_id,t.residual_asset_id) WHERE a.job_id=v_job.id) THEN
  RETURN jsonb_build_object('ok',false,'code','USED_BY_MUSIC');
 END IF;
 PERFORM 1 FROM public.assets WHERE job_id=v_job.id ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.evidence_holds h WHERE h.job_id=v_job.id AND h.released_at IS NULL)
    OR EXISTS(SELECT 1 FROM public.assets a WHERE a.job_id=v_job.id AND a.held_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.content_reports r WHERE r.subject_kind='job' AND r.subject_id=v_job.id AND r.status='open') THEN
  RETURN jsonb_build_object('ok',false,'code','ON_HOLD');
 END IF;
 WITH gone AS (DELETE FROM public.assets WHERE job_id=v_job.id AND held_at IS NULL RETURNING r2_key)
 INSERT INTO public.asset_reap_queue(r2_key) SELECT r2_key FROM gone ON CONFLICT(r2_key) DO NOTHING;
 INSERT INTO public.asset_reap_queue(r2_key)
  SELECT output_r2_key FROM public.job_steps WHERE job_id=v_job.id AND output_r2_key IS NOT NULL
  ON CONFLICT(r2_key) DO NOTHING;
 UPDATE public.job_steps SET output_r2_key=NULL,output_text=NULL WHERE job_id=v_job.id;
 UPDATE public.fal_dispatch SET payload='{}'::jsonb WHERE job_id=v_job.id;
 UPDATE public.crun_dispatch SET payload='{}'::jsonb WHERE job_id=v_job.id;
 UPDATE public.jobs SET inputs='{}'::jsonb,deleted_at=now(),updated_at=now() WHERE id=v_job.id;
 RETURN jsonb_build_object('ok',true,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.delete_user_job(TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_job(TEXT,UUID) TO service_role;

-- Account tombstoning scrubs every Crun payload even if an old/imported job is
-- not represented by a direct Music foreign key. Existing erased rows are
-- repaired once, and future erasures are handled in the same transaction.
CREATE OR REPLACE FUNCTION private.crun_dispatch_forget_erased_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
  UPDATE public.crun_dispatch d SET payload='{}'::jsonb FROM public.jobs j
   WHERE d.job_id=j.id AND j.user_id=NEW.id AND d.payload<>'{}'::jsonb;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.crun_dispatch_forget_erased_user() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS users_forget_crun_dispatch ON public.users;
CREATE TRIGGER users_forget_crun_dispatch AFTER UPDATE OF deleted_at ON public.users
 FOR EACH ROW EXECUTE FUNCTION private.crun_dispatch_forget_erased_user();
UPDATE public.crun_dispatch d SET payload='{}'::jsonb FROM public.jobs j JOIN public.users u ON u.id=j.user_id
 WHERE d.job_id=j.id AND u.deleted_at IS NOT NULL AND d.payload<>'{}'::jsonb;

-- Latest 0447 recovery projection plus Crun dispatch state. Fal predicates and
-- thresholds are unchanged.
CREATE OR REPLACE FUNCTION public.refresh_recovery_health()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO public.recovery_health_snapshot(singleton,observed_at,summary)
 SELECT true,statement_timestamp(),jsonb_build_object(
  'unhealthy_tasks',(SELECT COALESCE(jsonb_agg(t.task ORDER BY t.task),'[]'::jsonb)
   FROM (SELECT unnest(ARRAY['top_up_backfill','upload_sweep','asset_reap']) AS task
    UNION ALL SELECT 'grsai' WHERE EXISTS(SELECT 1 FROM public.model_catalog WHERE active AND provider='grsai')
    UNION ALL SELECT 'byteplus' WHERE EXISTS(SELECT 1 FROM public.model_catalog WHERE active AND provider='byteplus')
    UNION ALL SELECT 'auto_short' WHERE EXISTS(SELECT 1 FROM public.model_catalog WHERE active AND id='auto-short-32s')
    UNION ALL SELECT 'publish_sweep' WHERE EXISTS(SELECT 1 FROM public.social_posts WHERE status='scheduled' AND scheduled_at<=statement_timestamp()-interval '20 minutes')
    UNION ALL SELECT 'video_agent' WHERE EXISTS(SELECT 1 FROM public.model_catalog WHERE active AND id='video-agent')
    UNION ALL SELECT 'fal_dispatch' WHERE EXISTS(SELECT 1 FROM public.fal_dispatch d JOIN public.jobs j ON j.id=d.job_id WHERE j.state='DEBITED')
    UNION ALL SELECT 'crun_dispatch' WHERE EXISTS(SELECT 1 FROM public.crun_dispatch d JOIN public.jobs j ON j.id=d.job_id
      WHERE d.state IN ('READY','STARTED','ACCEPTED','UNKNOWN','DEFERRED') AND j.state IN ('DEBITED','SUBMITTED','SUCCEEDED','FAILOVER'))
    UNION ALL SELECT 'content_scan' WHERE EXISTS(SELECT 1 FROM public.content_scan_monitor m WHERE m.armed
      AND (m.armed_at<statement_timestamp()-interval '20 minutes' OR EXISTS(SELECT 1 FROM public.worker_task_health sh
       WHERE sh.task='content_scan' AND sh.last_attempt>m.armed_at AND NOT sh.last_ok)))) t
   LEFT JOIN public.worker_task_health h ON h.task=t.task
   WHERE h.last_success IS NULL OR NOT h.last_ok OR h.last_success<statement_timestamp()-interval '20 minutes'),
  'content_scan_overdue',(SELECT count(*) FROM public.content_scan_monitor m LEFT JOIN public.worker_task_health h ON h.task='content_scan'
    WHERE m.armed AND greatest(m.armed_at,h.last_success)<statement_timestamp()-interval '20 minutes'),
  'content_scan_claimable',(SELECT count(*) FROM public.content_scans s WHERE s.status='queued' OR (s.status='scanning' AND s.lease_until<statement_timestamp())),
  'content_scan_backlogged',(SELECT count(*) FROM public.content_scans s WHERE EXISTS(SELECT 1 FROM public.content_scan_monitor WHERE armed)
    AND (((s.status='queued' OR (s.status='scanning' AND s.lease_until<statement_timestamp())) AND s.queued_at<statement_timestamp()-interval '30 minutes')
      OR (s.status='scanning' AND s.claim_token IS NULL AND s.lease_until>statement_timestamp()))),
  'content_scan_exhausted',(SELECT CASE WHEN count(*)>20 THEN count(*) ELSE 0 END FROM public.content_scans s
    WHERE EXISTS(SELECT 1 FROM public.content_scan_monitor WHERE armed) AND s.status='unavailable'
      AND s.scores->>'reason' IS DISTINCT FROM 'asset_gone' AND s.decided_at>statement_timestamp()-interval '24 hours'),
  'fal_dispatch_unknown',(SELECT count(*) FROM public.fal_dispatch d JOIN public.jobs j ON j.id=d.job_id
    WHERE j.state='DEBITED' AND (d.state='UNKNOWN' OR (d.state='STARTED' AND d.started_at<statement_timestamp()-interval '2 minutes'))),
  'fal_dispatch_overdue',(SELECT count(*) FROM public.fal_dispatch d JOIN public.jobs j ON j.id=d.job_id
    WHERE j.state='DEBITED' AND ((d.state='READY' AND d.created_at<statement_timestamp()-interval '10 minutes')
      OR (d.state='ACCEPTED' AND d.projected_at IS NULL AND d.resolved_at<statement_timestamp()-interval '5 minutes'))),
  'crun_dispatch_unknown',(SELECT count(*) FROM public.crun_dispatch d WHERE d.state='UNKNOWN' AND d.resolved_at<statement_timestamp()-interval '10 minutes'),
  'crun_dispatch_accepted_unobservable',(SELECT count(*) FROM public.crun_dispatch d WHERE d.state='ACCEPTED'
    AND d.last_authoritative_at IS NULL AND d.resolved_at<statement_timestamp()-interval '5 minutes'),
  'crun_dispatch_authoritative_pending',(SELECT count(*) FROM public.crun_dispatch d WHERE d.state='ACCEPTED'
    AND d.last_authoritative_at IS NOT NULL AND d.last_authoritative_status IN ('pending','running')
    AND d.resolved_at<statement_timestamp()-interval '45 minutes'),
  'crun_dispatch_overdue',(SELECT count(*) FROM public.crun_dispatch d JOIN public.jobs j ON j.id=d.job_id
    WHERE (j.state='DEBITED' AND ((d.state IN ('READY','DEFERRED') AND d.created_at<statement_timestamp()-interval '10 minutes')
      OR (d.state='ACCEPTED' AND d.projected_at IS NULL AND d.resolved_at<statement_timestamp()-interval '5 minutes')))),
  'cinema_poll_overdue',(SELECT count(*) FROM public.cinema_uploads WHERE state IN ('uploading','processing') AND stream_uid IS NOT NULL
    AND COALESCE(recovery_checked_at,created_at)<statement_timestamp()-interval '40 minutes'),
  'cinema_poll_failed',(SELECT count(*) FROM public.cinema_uploads WHERE state IN ('uploading','processing') AND recovery_failed),
  'cinema_provisioning_stuck',(SELECT count(*) FROM public.cinema_uploads WHERE state='provisioning' AND created_at<statement_timestamp()-interval '5 minutes'),
  'cinema_processing_stuck',(SELECT count(*) FROM public.cinema_uploads WHERE state='processing' AND created_at<statement_timestamp()-interval '3 hours'),
  'cinema_cleanup_required',(SELECT count(*) FROM public.cinema_uploads WHERE state='error'
    OR (state='deleting' AND delete_requested_at<statement_timestamp()-interval '30 minutes')
    OR (state='uploading' AND expires_at<statement_timestamp()-interval '15 minutes')),
  'reap_exhausted',(SELECT count(*) FROM public.asset_reap_queue WHERE attempts>=8),
  'reap_overdue',(SELECT count(*) FROM public.asset_reap_queue WHERE queued_at<statement_timestamp()-interval '1 hour'),
  'stale_jobs',(SELECT count(*) FROM public.jobs WHERE state IN ('DEBITED','SUBMITTED','SUCCEEDED','FAILOVER','FAILED')
    AND updated_at<statement_timestamp()-interval '3 hours'),
  'stale_top_up_returns',(SELECT count(*) FROM public.top_ups WHERE status='pending' AND return_order_id IS NOT NULL AND return_closed_at IS NULL
    AND COALESCE(backfill_checked_at,returned_at+interval '10 minutes')<statement_timestamp()-interval '8 hours'),
  'unreviewed_flagged_orders',(SELECT count(*) FROM public.top_up_flagged_orders f WHERE NOT EXISTS(
    SELECT 1 FROM public.recovery_alert_reviews r WHERE r.kind='flagged_order' AND r.incident_key=f.order_id)),
  'unreviewed_order_collisions',(SELECT count(*) FROM public.top_up_order_collisions c WHERE NOT EXISTS(
    SELECT 1 FROM public.recovery_alert_reviews r WHERE r.kind='order_collision' AND r.incident_key=c.id::TEXT))
 ) ON CONFLICT(singleton) DO UPDATE SET observed_at=EXCLUDED.observed_at,summary=EXCLUDED.summary;
$$;
REVOKE ALL ON FUNCTION public.refresh_recovery_health() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_recovery_health() TO service_role;

COMMIT;

