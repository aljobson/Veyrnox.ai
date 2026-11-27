-- 0622: an explicit manual-editor Save or Export costs 5 credits once per
-- imported source set. Background autosave and importing remain free.
--
-- The server derives the import identity from the document's media ids. A
-- receipt whose sources contain the current set covers later Save/Export
-- actions, so retries and Save -> Export never debit twice. Adding a new
-- source creates a new import set and may be charged again.
BEGIN;

CREATE TABLE IF NOT EXISTS public.editor_manual_commit_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_fingerprint text NOT NULL CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
  source_hashes jsonb NOT NULL CHECK (jsonb_typeof(source_hashes) = 'array'),
  job_id uuid NOT NULL UNIQUE REFERENCES public.jobs(id) ON DELETE RESTRICT,
  credits integer NOT NULL CHECK (credits = 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, project_id, source_fingerprint)
);
CREATE INDEX IF NOT EXISTS editor_manual_commit_cover_idx
  ON public.editor_manual_commit_receipts(user_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS editor_manual_commit_project_idx
  ON public.editor_manual_commit_receipts(project_id);
ALTER TABLE public.editor_manual_commit_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.editor_manual_commit_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.editor_manual_commit_receipts FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.editor_manual_source_hashes(content jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  WITH clips AS (
    SELECT value AS clip FROM jsonb_array_elements(
      coalesce(content#>'{timeline,video}','[]'::jsonb)||coalesce(content#>'{timeline,audio}','[]'::jsonb)
    )
  ), referenced AS (
    SELECT clip->>'mediaId' AS source_id FROM clips
    UNION SELECT clip#>>'{background,mediaId}' AS source_id FROM clips
  ), eligible AS (
    SELECT DISTINCT encode(sha256(convert_to(r.source_id,'UTF8')),'hex') AS source_hash
      FROM referenced r
      JOIN jsonb_each(coalesce(content#>'{timeline,media}','{}'::jsonb)) m(source_id,media)
        ON m.source_id=r.source_id
     WHERE r.source_id IS NOT NULL AND r.source_id<>''
  )
  SELECT coalesce(jsonb_agg(source_hash ORDER BY source_hash),'[]'::jsonb) FROM eligible;
$$;

CREATE OR REPLACE FUNCTION private.quote_manual_editor_commit(p_project uuid, p_content jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); v_user_id uuid; sources jsonb; covered boolean;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
  IF coalesce(private.project_role(p_project),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR')
    THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
  IF NOT private.project_document_within_bounds(p_content,p_project)
    THEN RAISE EXCEPTION 'INVALID_DOCUMENT' USING ERRCODE='PT400'; END IF;
  SELECT id INTO v_user_id FROM public.users WHERE auth_id=actor::text;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
  sources:=private.editor_manual_source_hashes(p_content);
  SELECT NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements_text(sources) current_source(source_id)
     WHERE NOT EXISTS(
       SELECT 1 FROM public.editor_manual_commit_receipts r
       CROSS JOIN LATERAL jsonb_array_elements_text(r.source_hashes) paid_source(source_id)
        WHERE r.user_id=v_user_id AND r.project_id=p_project
          AND paid_source.source_id=current_source.source_id
     )
  ) INTO covered;
  RETURN jsonb_build_object('ok',true,'credits',CASE WHEN jsonb_array_length(sources)=0 OR covered THEN 0 ELSE 5 END,
    'covered',covered,'source_fingerprint',encode(sha256(convert_to(sources::text,'UTF8')),'hex'));
END $$;

CREATE OR REPLACE FUNCTION private.save_paid_project_document(
  p_project uuid, p_expected integer, p_content jsonb, p_request_key text, p_expected_credits integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  actor uuid:=auth.uid(); v_user_id uuid; sources jsonb; fingerprint text; charge_key text;
  amount integer; covered boolean; replay boolean; debit jsonb; saved jsonb; charged_job uuid;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
  IF p_expected_credits IS NULL OR p_expected_credits NOT IN (0,5) THEN
    RETURN jsonb_build_object('ok',false,'code','PRICE_CHANGED','expected_credits',5);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_project::text,621));
  IF coalesce(private.project_role(p_project),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR')
    THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
  IF NOT private.project_document_within_bounds(p_content,p_project)
    THEN RAISE EXCEPTION 'INVALID_DOCUMENT' USING ERRCODE='PT400'; END IF;
  SELECT id INTO v_user_id FROM public.users WHERE auth_id=actor::text;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
  sources:=private.editor_manual_source_hashes(p_content);
  fingerprint:=encode(sha256(convert_to(sources::text,'UTF8')),'hex');
  SELECT NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements_text(sources) current_source(source_id)
     WHERE NOT EXISTS(
       SELECT 1 FROM public.editor_manual_commit_receipts r
       CROSS JOIN LATERAL jsonb_array_elements_text(r.source_hashes) paid_source(source_id)
        WHERE r.user_id=v_user_id AND r.project_id=p_project
          AND paid_source.source_id=current_source.source_id
     )
  ) INTO covered;
  amount:=CASE WHEN jsonb_array_length(sources)=0 OR covered THEN 0 ELSE 5 END;
  SELECT EXISTS(SELECT 1 FROM public.project_document_versions v
    WHERE v.project_id=p_project AND v.actor_id=actor AND v.request_key=p_request_key) INTO replay;
  IF p_expected_credits IS DISTINCT FROM amount AND NOT (replay AND p_expected_credits=5 AND amount=0) THEN
    RETURN jsonb_build_object('ok',false,'code','PRICE_CHANGED','expected_credits',amount);
  END IF;
  IF amount=5 THEN
    charge_key:='editor-manual.'||encode(sha256(convert_to(actor::text||':'||p_project::text||':'||fingerprint,'UTF8')),'hex');
    debit:=public.ledger_debit(v_user_id,charge_key,5,'debit:editor_manual_commit','editor-manual-commit',
      jsonb_build_object('kind','manual_editor_commit','project_id',p_project,'source_fingerprint',fingerprint),0,60);
    IF debit->>'ok' IS DISTINCT FROM 'true' THEN RETURN debit; END IF;
    charged_job:=(debit->>'job_id')::uuid;
  END IF;
  saved:=private.save_project_document(p_project,p_expected,p_content,p_request_key,NULL);
  IF amount=5 THEN
    INSERT INTO public.editor_manual_commit_receipts(user_id,project_id,source_fingerprint,source_hashes,job_id,credits)
      VALUES(v_user_id,p_project,fingerprint,sources,charged_job,5)
      ON CONFLICT(user_id,project_id,source_fingerprint) DO NOTHING;
    -- This synchronous accounting row backs the ledger but is not generated
    -- content. Reuse the existing local/deleted convention so it cannot appear
    -- as a blank Library item or enqueue a false job-complete notification.
    UPDATE public.jobs SET state='STORED',provider='local',deleted_at=now(),updated_at=now()
      WHERE id=charged_job AND state='DEBITED';
  END IF;
  RETURN saved||jsonb_build_object('ok',true,'credits',amount,'covered',amount=0);
END $$;

-- Authoritative read-only reconciliation for an ambiguous paid HTTP response.
-- The mutable latest document head is deliberately not used as evidence: only
-- the exact actor/project/idempotency-key version can acknowledge a charge.
CREATE OR REPLACE FUNCTION private.manual_editor_commit_status(p_project uuid,p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); saved_revision integer;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
  IF p_request_key IS NULL OR p_request_key!~'^[A-Za-z0-9._-]{8,128}$'
    THEN RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY' USING ERRCODE='PT400'; END IF;
  IF coalesce(private.project_role(p_project),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR')
    THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
  -- Serialize behind any already-issued paid save for this actor/project.
  -- Once this lock is acquired, a missing exact key is an authoritative
  -- rollback/non-arrival result rather than a snapshot taken mid-transaction.
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_project::text,621));
  SELECT v.revision INTO saved_revision FROM public.project_document_versions v
   WHERE v.project_id=p_project AND v.actor_id=actor AND v.request_key=p_request_key;
  RETURN jsonb_build_object('ok',true,'committed',saved_revision IS NOT NULL,'revision',saved_revision);
END $$;

CREATE OR REPLACE FUNCTION public.quote_manual_editor_commit(p_project_id uuid,p_document jsonb) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT private.quote_manual_editor_commit(p_project_id,p_document);
$$;
CREATE OR REPLACE FUNCTION public.save_paid_project_document(
  p_project_id uuid,p_expected_revision integer,p_document jsonb,p_idempotency_key text,p_expected_credits integer
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT private.save_paid_project_document(p_project_id,p_expected_revision,p_document,p_idempotency_key,p_expected_credits);
$$;
CREATE OR REPLACE FUNCTION public.manual_editor_commit_status(p_project_id uuid,p_idempotency_key text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT private.manual_editor_commit_status(p_project_id,p_idempotency_key);
$$;

REVOKE ALL ON FUNCTION private.editor_manual_source_hashes(jsonb),private.quote_manual_editor_commit(uuid,jsonb),
  private.save_paid_project_document(uuid,integer,jsonb,text,integer),private.manual_editor_commit_status(uuid,text),
  public.quote_manual_editor_commit(uuid,jsonb),public.save_paid_project_document(uuid,integer,jsonb,text,integer),
  public.manual_editor_commit_status(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.quote_manual_editor_commit(uuid,jsonb),private.save_paid_project_document(uuid,integer,jsonb,text,integer),
  private.manual_editor_commit_status(uuid,text),public.quote_manual_editor_commit(uuid,jsonb),
  public.save_paid_project_document(uuid,integer,jsonb,text,integer),public.manual_editor_commit_status(uuid,text) TO authenticated;

-- Manual accounting rows are not generation attempts. Exclude only this
-- model from the rolling limiter; deleted generation jobs must keep counting
-- so Generate -> delete -> Generate cannot bypass abuse protection.
CREATE OR REPLACE FUNCTION private.ledger_debit_for_admission(
    p_user_id uuid,p_idempotency_key text,p_credits integer,p_reason text,p_model_id text,p_inputs jsonb,
    p_limit_per_window integer DEFAULT 0,p_window_seconds integer DEFAULT 60,p_reserved boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    v_existing uuid; v_current_balance integer; v_free_balance integer; v_free_part integer;
    v_sub_balance integer; v_sub_expires timestamptz; v_sub_cycle integer; v_sub_live integer;
    v_sub_part integer; v_spendable integer; v_new_job_id uuid; v_count integer;
    v_reset_seconds integer; v_hold_until timestamptz;
BEGIN
    IF p_credits IS NULL OR p_credits<=0 THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_CREDITS','message',format('credits must be a positive integer (got %s)',p_credits));
    END IF;
    SELECT balance,free_balance,subscription_balance,subscription_expires_at,subscription_cycle
      INTO v_current_balance,v_free_balance,v_sub_balance,v_sub_expires,v_sub_cycle
      FROM public.credit_balances WHERE user_id=p_user_id FOR UPDATE;
    IF v_current_balance IS NULL THEN
        RETURN jsonb_build_object('ok',false,'code','NO_BALANCE_ROW','message',format('no credit_balances row for user %s',p_user_id));
    END IF;
    v_sub_live:=CASE WHEN v_sub_expires>now() THEN v_sub_balance ELSE 0 END;
    v_spendable:=v_current_balance-(v_sub_balance-v_sub_live);
    SELECT id INTO v_existing FROM public.jobs WHERE user_id=p_user_id AND idempotency_key=p_idempotency_key;
    IF v_existing IS NOT NULL THEN
        IF p_reason IN ('debit:generation','debit:chat') AND EXISTS(
            SELECT 1 FROM public.jobs j WHERE j.id=v_existing AND
              (j.model_id IS DISTINCT FROM p_model_id OR NOT private.generation_request_matches(j.inputs,p_inputs))
        ) THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
        RETURN jsonb_build_object('ok',true,'job_id',v_existing,'idempotent',true,'balance_after',v_spendable);
    END IF;
    IF private.fal_admission_paused(p_model_id,p_reserved) THEN
        RETURN jsonb_build_object('ok',false,'code','PROVIDER_ADMISSION_PAUSED','retry_after_seconds',60);
    END IF;
    IF EXISTS(SELECT 1 FROM public.users u WHERE u.id=p_user_id AND u.frozen_at IS NOT NULL) THEN
        RETURN jsonb_build_object('ok',false,'code','ACCOUNT_FROZEN');
    END IF;
    SELECT u.hold_until INTO v_hold_until FROM public.users u WHERE u.id=p_user_id AND u.hold_until>now();
    IF v_hold_until IS NOT NULL THEN
        RETURN jsonb_build_object('ok',false,'code','ACCOUNT_ON_HOLD','hold_until',v_hold_until);
    END IF;
    IF p_limit_per_window IS NOT NULL AND p_limit_per_window>0 THEN
        SELECT count(*) INTO v_count FROM public.jobs
         WHERE user_id=p_user_id AND model_id<>'editor-manual-commit'
           AND created_at>now()-make_interval(secs=>p_window_seconds);
        IF v_count>=p_limit_per_window THEN
            SELECT greatest(1,ceil(extract(epoch FROM (min(created_at)+make_interval(secs=>p_window_seconds)-now()))))::integer
              INTO v_reset_seconds FROM public.jobs
             WHERE user_id=p_user_id AND model_id<>'editor-manual-commit'
               AND created_at>now()-make_interval(secs=>p_window_seconds);
            RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED','count',v_count,'limit',p_limit_per_window,
              'retry_after_seconds',coalesce(v_reset_seconds,p_window_seconds));
        END IF;
    END IF;
    IF v_spendable<p_credits THEN
        RETURN jsonb_build_object('ok',false,'code','INSUFFICIENT_BALANCE',
          'message',format('insufficient balance: have %s, need %s',v_spendable,p_credits),'balance',v_spendable);
    END IF;
    BEGIN
        INSERT INTO public.jobs(user_id,idempotency_key,model_id,credits,inputs,state)
          VALUES(p_user_id,p_idempotency_key,p_model_id,p_credits,p_inputs,'DEBITED') RETURNING id INTO v_new_job_id;
    EXCEPTION WHEN unique_violation THEN
        SELECT id INTO v_existing FROM public.jobs WHERE user_id=p_user_id AND idempotency_key=p_idempotency_key;
        IF p_reason IN ('debit:generation','debit:chat') AND EXISTS(
            SELECT 1 FROM public.jobs j WHERE j.id=v_existing AND
              (j.model_id IS DISTINCT FROM p_model_id OR NOT private.generation_request_matches(j.inputs,p_inputs))
        ) THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
        RETURN jsonb_build_object('ok',true,'job_id',v_existing,'idempotent',true,'balance_after',v_spendable);
    END;
    v_sub_part:=least(v_sub_live,p_credits);
    v_free_part:=least(v_free_balance,p_credits-v_sub_part);
    INSERT INTO public.ledger_entries(user_id,delta,free_delta,subscription_delta,subscription_cycle,reason,job_id)
      VALUES(p_user_id,-p_credits,-v_free_part,-v_sub_part,CASE WHEN v_sub_part>0 THEN v_sub_cycle END,p_reason,v_new_job_id);
    UPDATE public.credit_balances SET balance=balance-p_credits,free_balance=free_balance-v_free_part,
      subscription_balance=subscription_balance-v_sub_part,updated_at=now() WHERE user_id=p_user_id;
    RETURN jsonb_build_object('ok',true,'job_id',v_new_job_id,'idempotent',false,'balance_after',v_spendable-p_credits);
END $$;

-- These jobs represent a synchronous device-side service, not supplier work.
DROP TRIGGER IF EXISTS jobs_inflight_guard ON public.jobs;
CREATE TRIGGER jobs_inflight_guard BEFORE INSERT ON public.jobs
  FOR EACH ROW WHEN (NEW.model_id<>'editor-manual-commit') EXECUTE FUNCTION private.enforce_user_inflight_on_job();
DROP TRIGGER IF EXISTS jobs_provider_spend_guard ON public.jobs;
CREATE TRIGGER jobs_provider_spend_guard BEFORE INSERT ON public.jobs
  FOR EACH ROW WHEN (NEW.model_id<>'editor-manual-commit') EXECUTE FUNCTION private.enforce_provider_spend_on_job();

NOTIFY pgrst,'reload schema';
COMMIT;
