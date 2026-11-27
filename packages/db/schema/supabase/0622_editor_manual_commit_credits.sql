-- 0622: an explicit manual-editor Save or Export costs 5 credits once per
-- imported source set. Background autosave and importing remain free.
--
-- The server derives the import identity from the document's media ids. A
-- receipt whose sources contain the current set covers later Save/Export
-- actions, so retries and Save -> Export never debit twice. Adding a new
-- source creates a new import set and may be charged again.
BEGIN;

-- Two independent switches are required before this paid path can ship: the
-- Worker flag gates the HTTP route and this row gates direct PostgREST RPCs.
CREATE TABLE IF NOT EXISTS public.editor_manual_commit_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.editor_manual_commit_config(singleton,enabled) VALUES(true,false)
  ON CONFLICT(singleton) DO NOTHING;
ALTER TABLE public.editor_manual_commit_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.editor_manual_commit_config FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.editor_manual_commit_config FROM PUBLIC,anon,authenticated,service_role;

-- Mark the exact document version written by the paid endpoint. Reconciliation
-- must never mistake an ordinary save that reused the request key for payment.
ALTER TABLE public.project_document_versions
  ADD COLUMN IF NOT EXISTS manual_commit_credits integer,
  ADD COLUMN IF NOT EXISTS manual_commit_job_id uuid,
  ADD COLUMN IF NOT EXISTS manual_commit_fingerprint text;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.project_document_versions'::regclass
      AND conname='project_document_versions_manual_commit_job_id_fkey') THEN
    ALTER TABLE public.project_document_versions ADD CONSTRAINT project_document_versions_manual_commit_job_id_fkey
      FOREIGN KEY(manual_commit_job_id) REFERENCES public.jobs(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.project_document_versions'::regclass
      AND conname='project_document_versions_manual_commit_check') THEN
    ALTER TABLE public.project_document_versions ADD CONSTRAINT project_document_versions_manual_commit_check CHECK (
      (manual_commit_credits IS NULL AND manual_commit_job_id IS NULL AND manual_commit_fingerprint IS NULL)
      OR (manual_commit_credits IN (0,5)
        AND manual_commit_fingerprint ~ '^[0-9a-f]{64}$'
        AND ((manual_commit_credits=0 AND manual_commit_job_id IS NULL)
          OR (manual_commit_credits=5 AND manual_commit_job_id IS NOT NULL)))
    );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS project_document_versions_manual_commit_job_idx
  ON public.project_document_versions(manual_commit_job_id);

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
    SELECT DISTINCT encode(sha256(convert_to(
      jsonb_build_object('source_id',r.source_id,'media',m.media)::text,'UTF8'
    )),'hex') AS source_hash
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
  IF NOT EXISTS(SELECT 1 FROM public.editor_manual_commit_config WHERE singleton AND enabled)
    THEN RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE='PT404'; END IF;
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
  saved_revision integer; charge_inputs jsonb;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.editor_manual_commit_config WHERE singleton AND enabled)
    THEN RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE='PT404'; END IF;
  IF p_expected_credits IS NULL OR p_expected_credits NOT IN (0,5) THEN
    RETURN jsonb_build_object('ok',false,'code','PRICE_CHANGED','expected_credits',5);
  END IF;
  -- Take the exact same actor and project locks as the canonical free-save
  -- route before checking the request key or debiting. A concurrent free save
  -- can therefore never insert this key between the replay check and update.
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,34));
  PERFORM 1 FROM public.projects WHERE id=p_project FOR UPDATE;
  IF coalesce(private.project_role(p_project),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR')
    THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
  IF NOT private.project_document_within_bounds(p_content,p_project)
    THEN RAISE EXCEPTION 'INVALID_DOCUMENT' USING ERRCODE='PT400'; END IF;
  SELECT id INTO v_user_id FROM public.users WHERE auth_id=actor::text;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.project_document_versions v
    WHERE v.project_id=p_project AND v.actor_id=actor AND v.request_key=p_request_key) INTO replay;
  IF replay THEN
    -- Re-run the canonical document save first so the existing key is still
    -- checked against the expected revision and exact document payload.
    saved:=private.save_project_document(p_project,p_expected,p_content,p_request_key,NULL);
    SELECT v.revision,v.manual_commit_credits INTO saved_revision,amount
      FROM public.project_document_versions v
      WHERE v.project_id=p_project AND v.actor_id=actor AND v.request_key=p_request_key;
    IF amount IS NULL THEN
      RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');
    END IF;
    IF p_expected_credits IS DISTINCT FROM amount THEN
      RETURN jsonb_build_object('ok',false,'code','PRICE_CHANGED','expected_credits',amount);
    END IF;
    RETURN saved||jsonb_build_object('ok',true,'credits',amount,'covered',amount=0);
  END IF;
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
  IF p_expected_credits IS DISTINCT FROM amount THEN
    RETURN jsonb_build_object('ok',false,'code','PRICE_CHANGED','expected_credits',amount);
  END IF;
  IF amount=5 THEN
    charge_key:='editor-manual.'||encode(sha256(convert_to(actor::text||':'||p_project::text||':'||fingerprint,'UTF8')),'hex');
    charge_inputs:=jsonb_build_object('kind','manual_editor_commit','project_id',p_project,
      'source_fingerprint',fingerprint,'request_key',p_request_key);
    debit:=public.ledger_debit(v_user_id,charge_key,5,'debit:editor_manual_commit','editor-manual-commit',
      charge_inputs,0,60);
    IF debit->>'ok' IS DISTINCT FROM 'true' THEN RETURN debit; END IF;
    charged_job:=(debit->>'job_id')::uuid;
    IF NOT EXISTS(SELECT 1 FROM public.jobs j WHERE j.id=charged_job AND j.user_id=v_user_id
      AND j.idempotency_key=charge_key AND j.model_id='editor-manual-commit' AND j.credits=5
      AND j.inputs=charge_inputs) THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='PT409';
    END IF;
  END IF;
  saved:=private.save_project_document(p_project,p_expected,p_content,p_request_key,NULL);
  saved_revision:=(saved->>'revision')::integer;
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
  UPDATE public.project_document_versions v SET manual_commit_credits=amount,
      manual_commit_job_id=charged_job,manual_commit_fingerprint=fingerprint
    WHERE v.project_id=p_project AND v.actor_id=actor AND v.request_key=p_request_key
      AND v.revision=saved_revision
      AND (v.manual_commit_credits IS NULL OR (v.manual_commit_credits=amount
        AND v.manual_commit_job_id IS NOT DISTINCT FROM charged_job
        AND v.manual_commit_fingerprint=fingerprint));
  IF NOT FOUND THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='PT409'; END IF;
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
  IF NOT EXISTS(SELECT 1 FROM public.editor_manual_commit_config WHERE singleton AND enabled)
    THEN RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE='PT404'; END IF;
  IF p_request_key IS NULL OR p_request_key!~'^[A-Za-z0-9._-]{8,128}$'
    THEN RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY' USING ERRCODE='PT400'; END IF;
  IF coalesce(private.project_role(p_project),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR')
    THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
  -- Serialize behind any already-issued paid save for this actor/project.
  -- Once this lock is acquired, a missing exact key is an authoritative
  -- rollback/non-arrival result rather than a snapshot taken mid-transaction.
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,34));
  PERFORM 1 FROM public.projects WHERE id=p_project FOR UPDATE;
  SELECT v.revision INTO saved_revision FROM public.project_document_versions v
   WHERE v.project_id=p_project AND v.actor_id=actor AND v.request_key=p_request_key
     AND v.manual_commit_credits IS NOT NULL
     AND (v.manual_commit_credits=0 OR EXISTS(
       SELECT 1 FROM public.editor_manual_commit_receipts r JOIN public.jobs j ON j.id=r.job_id
        WHERE r.user_id=j.user_id AND r.project_id=p_project
          AND r.job_id=v.manual_commit_job_id AND r.source_fingerprint=v.manual_commit_fingerprint
          AND j.model_id='editor-manual-commit' AND j.credits=5
          AND j.inputs->>'request_key'=p_request_key));
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
        IF p_reason IN ('debit:generation','debit:chat','debit:editor_manual_commit') AND EXISTS(
            SELECT 1 FROM public.jobs j WHERE j.id=v_existing AND
              (j.model_id IS DISTINCT FROM p_model_id
                OR (p_reason='debit:editor_manual_commit' AND
                  (j.credits IS DISTINCT FROM p_credits OR j.inputs IS DISTINCT FROM p_inputs))
                OR (p_reason IN ('debit:generation','debit:chat') AND
                  NOT private.generation_request_matches(j.inputs,p_inputs)))
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
        IF p_reason IN ('debit:generation','debit:chat','debit:editor_manual_commit') AND EXISTS(
            SELECT 1 FROM public.jobs j WHERE j.id=v_existing AND
              (j.model_id IS DISTINCT FROM p_model_id
                OR (p_reason='debit:editor_manual_commit' AND
                  (j.credits IS DISTINCT FROM p_credits OR j.inputs IS DISTINCT FROM p_inputs))
                OR (p_reason IN ('debit:generation','debit:chat') AND
                  NOT private.generation_request_matches(j.inputs,p_inputs)))
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

-- Manual editor accounting jobs are already paid synchronously and hidden;
-- they are not generation attempts and must not consume a generation slot.
-- Re-declare the latest public limiter here so deployed databases receive the
-- exclusion without mutating the historical 0443 migration.
CREATE OR REPLACE FUNCTION public.check_generation_rate_limit(
    p_auth_id TEXT,
    p_limit_per_window INTEGER,
    p_window_seconds INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_count INTEGER;
    v_reset_seconds INTEGER;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_attempt_count INTEGER;
    v_start TIMESTAMPTZ;
    v_disabled BOOLEAN;
    v_user_limit INTEGER;
    v_global_limit INTEGER;
BEGIN
    IF p_limit_per_window IS NULL OR p_limit_per_window <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BAD_LIMIT');
    END IF;
    IF p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BAD_WINDOW');
    END IF;
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    SELECT c.ai_disabled, c.gen_limit_per_window INTO v_disabled, v_user_limit
      FROM public.user_ai_controls c WHERE c.user_id = v_user_id;
    IF coalesce(v_disabled, false) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'AI_DISABLED');
    END IF;
    SELECT gen_limit_per_window INTO v_global_limit FROM public.ai_limit_policy;
    p_limit_per_window := LEAST(p_limit_per_window,
        coalesce(v_user_limit, p_limit_per_window), coalesce(v_global_limit, p_limit_per_window));

    INSERT INTO public.generation_attempt_rate_limits AS r (user_id, window_started_at, request_count)
    VALUES (v_user_id, v_now, 1)
    ON CONFLICT (user_id) DO UPDATE SET
        window_started_at = CASE WHEN r.window_started_at <= v_now - interval '60 seconds'
            THEN v_now ELSE r.window_started_at END,
        request_count = CASE WHEN r.window_started_at <= v_now - interval '60 seconds'
            THEN 1 ELSE LEAST(r.request_count + 1, 21) END
    RETURNING window_started_at, request_count INTO v_start, v_attempt_count;
    IF v_attempt_count > 20 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED',
            'count', v_attempt_count, 'limit', 20,
            'retry_after_seconds', LEAST(60, GREATEST(1,
                ceil(extract(epoch FROM (v_start + interval '60 seconds' - v_now)))::INTEGER)));
    END IF;

    SELECT count(*) INTO v_count FROM public.jobs
     WHERE user_id = v_user_id
       AND model_id <> 'editor-manual-commit'
       AND created_at > now() - make_interval(secs => p_window_seconds);
    IF v_count >= p_limit_per_window THEN
        SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
            MIN(created_at) + make_interval(secs => p_window_seconds) - now()
        ))))::int INTO v_reset_seconds
          FROM public.jobs
         WHERE user_id = v_user_id
           AND model_id <> 'editor-manual-commit'
           AND created_at > now() - make_interval(secs => p_window_seconds);
        RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED',
            'count', v_count, 'limit', p_limit_per_window,
            'retry_after_seconds', COALESCE(v_reset_seconds, p_window_seconds));
    END IF;
    RETURN jsonb_build_object('ok', true, 'count', v_count, 'limit', p_limit_per_window);
END $$;
REVOKE ALL ON FUNCTION public.check_generation_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_generation_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;

-- These jobs represent a synchronous device-side service, not supplier work.
DROP TRIGGER IF EXISTS jobs_inflight_guard ON public.jobs;
CREATE TRIGGER jobs_inflight_guard BEFORE INSERT ON public.jobs
  FOR EACH ROW WHEN (NEW.model_id<>'editor-manual-commit') EXECUTE FUNCTION private.enforce_user_inflight_on_job();
DROP TRIGGER IF EXISTS jobs_provider_spend_guard ON public.jobs;
CREATE TRIGGER jobs_provider_spend_guard BEFORE INSERT ON public.jobs
  FOR EACH ROW WHEN (NEW.model_id<>'editor-manual-commit') EXECUTE FUNCTION private.enforce_provider_spend_on_job();

NOTIFY pgrst,'reload schema';
COMMIT;
