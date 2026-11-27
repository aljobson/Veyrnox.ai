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

-- Payment state lives outside immutable document versions. A reservation is
-- created before device delivery, then finalized after Photos/share succeeds
-- or refunded when delivery fails. The ordinary stuck-job sweeper is the crash
-- fallback for reservations which never receive either acknowledgement.
CREATE TABLE IF NOT EXISTS public.editor_manual_commit_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  request_key text NOT NULL CHECK (request_key ~ '^[A-Za-z0-9._-]{8,128}$'),
  revision integer NOT NULL CHECK (revision > 0),
  source_fingerprint text NOT NULL CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
  source_hashes jsonb NOT NULL CHECK (jsonb_typeof(source_hashes) = 'array'),
  job_id uuid UNIQUE REFERENCES public.jobs(id) ON DELETE RESTRICT,
  credits integer NOT NULL CHECK (credits IN (0,5)),
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','DELIVERING','COMMITTED','REFUNDED')),
  delivery_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(actor_id, project_id, request_key),
  CHECK ((credits=0 AND job_id IS NULL) OR (credits=5 AND job_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS editor_manual_commit_operations_project_idx
  ON public.editor_manual_commit_operations(project_id,actor_id,created_at DESC);
DROP INDEX IF EXISTS public.editor_manual_commit_one_pending_charge_idx;
CREATE UNIQUE INDEX IF NOT EXISTS editor_manual_commit_one_pending_project_idx
  ON public.editor_manual_commit_operations(user_id,project_id)
  WHERE credits=5 AND state IN ('PENDING','DELIVERING');
ALTER TABLE public.editor_manual_commit_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.editor_manual_commit_operations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.editor_manual_commit_operations FROM PUBLIC,anon,authenticated,service_role;

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

-- The HTTP middleware requires AAL2 when a person has enrolled TOTP. Repeat
-- that boundary in the database so an authenticated JWT cannot bypass it by
-- invoking these granted PostgREST functions directly.
CREATE OR REPLACE FUNCTION private.editor_manual_mfa_satisfied(actor uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE claims jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
BEGIN
  IF claims->>'aal'='aal2' THEN RETURN true; END IF;
  RETURN NOT EXISTS(SELECT 1 FROM auth.mfa_factors
    WHERE user_id=actor AND factor_type='totp' AND status='verified');
END $$;
REVOKE ALL ON FUNCTION private.editor_manual_mfa_satisfied(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.quote_manual_editor_commit(p_project uuid, p_content jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); v_user_id uuid; sources jsonb; covered boolean;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
  IF NOT private.editor_manual_mfa_satisfied(actor)
    THEN RAISE EXCEPTION 'MFA_REQUIRED' USING ERRCODE='PT403'; END IF;
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
  amount integer; covered boolean; debit jsonb; saved jsonb; charged_job uuid;
  saved_revision integer; charge_inputs jsonb; existing public.editor_manual_commit_operations%ROWTYPE;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
  IF NOT private.editor_manual_mfa_satisfied(actor)
    THEN RAISE EXCEPTION 'MFA_REQUIRED' USING ERRCODE='PT403'; END IF;
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
  SELECT * INTO existing FROM public.editor_manual_commit_operations o
    WHERE o.actor_id=actor AND o.project_id=p_project AND o.request_key=p_request_key;
  IF existing.id IS NOT NULL THEN
    IF existing.state IN ('PENDING','DELIVERING') AND existing.credits=5 AND EXISTS(
      SELECT 1 FROM public.jobs j WHERE j.id=existing.job_id AND j.state='REFUNDED'
    ) THEN
      UPDATE public.editor_manual_commit_operations SET state='REFUNDED',updated_at=now() WHERE id=existing.id;
      existing.state:='REFUNDED';
    END IF;
    -- Re-run the canonical save so a same-key replay must still match the exact
    -- expected revision and document payload. Payment state is never inferred
    -- from, or written back into, the immutable version row.
    saved:=private.save_project_document(p_project,p_expected,p_content,p_request_key,NULL);
    IF p_expected_credits IS DISTINCT FROM existing.credits THEN
      RETURN jsonb_build_object('ok',false,'code','PRICE_CHANGED','expected_credits',existing.credits);
    END IF;
    RETURN saved||jsonb_build_object('ok',true,'credits',existing.credits,'covered',existing.credits=0,
      'pending',existing.state IN ('PENDING','DELIVERING'),'committed',existing.state='COMMITTED','canceled',existing.state='REFUNDED');
  END IF;
  IF EXISTS(SELECT 1 FROM public.project_document_versions v
    WHERE v.project_id=p_project AND v.actor_id=actor AND v.request_key=p_request_key) THEN
    RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');
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
    -- The generic stuck-job sweep owns the credit refund. Reconcile its result
    -- here as well as in the status endpoint so a restarted client can reserve
    -- again with a fresh key without knowing the abandoned request key.
    UPDATE public.editor_manual_commit_operations o SET state='REFUNDED',delivery_expires_at=NULL,updated_at=now()
      FROM public.jobs j
     WHERE o.user_id=v_user_id AND o.project_id=p_project AND o.credits=5 AND o.state IN ('PENDING','DELIVERING')
       AND j.id=o.job_id AND j.state='REFUNDED';
    -- Only one paid delivery may be pending for a user's project. This blocks
    -- overlapping sets (A+B followed by A) until the first delivery either
    -- creates its coverage receipt or refunds, preventing two retained debits.
    IF EXISTS(SELECT 1 FROM public.editor_manual_commit_operations o WHERE o.user_id=v_user_id
      AND o.project_id=p_project AND o.credits=5 AND o.state IN ('PENDING','DELIVERING')) THEN
      RETURN jsonb_build_object('ok',false,'code','COMMIT_PENDING');
    END IF;
    charge_key:='editor-manual.'||encode(sha256(convert_to(actor::text||':'||p_project::text||':'||p_request_key||':'||fingerprint,'UTF8')),'hex');
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
  INSERT INTO public.editor_manual_commit_operations(
      actor_id,user_id,project_id,request_key,revision,source_fingerprint,source_hashes,job_id,credits)
    VALUES(actor,v_user_id,p_project,p_request_key,saved_revision,fingerprint,sources,charged_job,amount);
  RETURN saved||jsonb_build_object('ok',true,'credits',amount,'covered',amount=0,
    'pending',true,'committed',false,'canceled',false);
END $$;

-- Claim the external-delivery window before exposing the rendered file to
-- Photos or the share sheet. The one-day lease protects the debit from the
-- generic stuck-job refund while the native controller is open; a crashed
-- client is still recovered by that sweep after the lease expires.
CREATE OR REPLACE FUNCTION private.begin_manual_editor_delivery(p_project uuid,p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); op public.editor_manual_commit_operations%ROWTYPE; job_state text;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
  IF NOT private.editor_manual_mfa_satisfied(actor)
    THEN RAISE EXCEPTION 'MFA_REQUIRED' USING ERRCODE='PT403'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.editor_manual_commit_config WHERE singleton AND enabled)
    THEN RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE='PT404'; END IF;
  IF p_request_key IS NULL OR p_request_key!~'^[A-Za-z0-9._-]{8,128}$'
    THEN RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY' USING ERRCODE='PT400'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,34));
  PERFORM 1 FROM public.projects WHERE id=p_project FOR UPDATE;
  IF coalesce(private.project_role(p_project),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR')
    THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
  SELECT * INTO op FROM public.editor_manual_commit_operations o
   WHERE o.actor_id=actor AND o.project_id=p_project AND o.request_key=p_request_key FOR UPDATE;
  IF op.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','COMMIT_NOT_FOUND'); END IF;
  IF op.state='COMMITTED' THEN RETURN jsonb_build_object('ok',true,'authorized',true,'revision',op.revision); END IF;
  IF op.state='REFUNDED' THEN RETURN jsonb_build_object('ok',false,'code','COMMIT_CANCELED','revision',op.revision); END IF;
  IF op.credits=5 THEN
    SELECT state INTO job_state FROM public.jobs WHERE id=op.job_id FOR UPDATE;
    IF job_state='REFUNDED' THEN
      UPDATE public.editor_manual_commit_operations SET state='REFUNDED',delivery_expires_at=NULL,updated_at=now() WHERE id=op.id;
      RETURN jsonb_build_object('ok',false,'code','COMMIT_CANCELED','revision',op.revision);
    END IF;
    IF job_state<>'DEBITED' THEN RETURN jsonb_build_object('ok',false,'code','COMMIT_STATE_INVALID'); END IF;
    UPDATE public.jobs SET updated_at=now() WHERE id=op.job_id AND state='DEBITED';
  END IF;
  UPDATE public.editor_manual_commit_operations
     SET state='DELIVERING',delivery_expires_at=now()+interval '1 day',updated_at=now()
   WHERE id=op.id;
  RETURN jsonb_build_object('ok',true,'authorized',true,'revision',op.revision);
END $$;

CREATE OR REPLACE FUNCTION private.finalize_manual_editor_commit(p_project uuid,p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); op public.editor_manual_commit_operations%ROWTYPE; job_state text; erased jsonb;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
  IF NOT private.editor_manual_mfa_satisfied(actor)
    THEN RAISE EXCEPTION 'MFA_REQUIRED' USING ERRCODE='PT403'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.editor_manual_commit_config WHERE singleton AND enabled)
    THEN RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE='PT404'; END IF;
  IF p_request_key IS NULL OR p_request_key!~'^[A-Za-z0-9._-]{8,128}$'
    THEN RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY' USING ERRCODE='PT400'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,34));
  PERFORM 1 FROM public.projects WHERE id=p_project FOR UPDATE;
  IF coalesce(private.project_role(p_project),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR')
    THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
  SELECT * INTO op FROM public.editor_manual_commit_operations o
   WHERE o.actor_id=actor AND o.project_id=p_project AND o.request_key=p_request_key FOR UPDATE;
  IF op.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','COMMIT_NOT_FOUND'); END IF;
  IF op.state='COMMITTED' THEN RETURN jsonb_build_object('ok',true,'committed',true,'revision',op.revision); END IF;
  IF op.state='REFUNDED' THEN RETURN jsonb_build_object('ok',false,'code','COMMIT_CANCELED','revision',op.revision); END IF;
  IF op.state<>'DELIVERING' THEN RETURN jsonb_build_object('ok',false,'code','DELIVERY_NOT_STARTED'); END IF;
  IF op.credits=5 THEN
    SELECT state INTO job_state FROM public.jobs WHERE id=op.job_id FOR UPDATE;
    IF job_state='REFUNDED' THEN
      UPDATE public.editor_manual_commit_operations SET state='REFUNDED',delivery_expires_at=NULL,updated_at=now() WHERE id=op.id;
      RETURN jsonb_build_object('ok',false,'code','COMMIT_CANCELED','revision',op.revision);
    END IF;
    IF job_state<>'DEBITED' THEN RETURN jsonb_build_object('ok',false,'code','COMMIT_STATE_INVALID'); END IF;
    INSERT INTO public.editor_manual_commit_receipts(user_id,project_id,source_fingerprint,source_hashes,job_id,credits)
      VALUES(op.user_id,p_project,op.source_fingerprint,op.source_hashes,op.job_id,5)
      ON CONFLICT(user_id,project_id,source_fingerprint) DO NOTHING;
    UPDATE public.jobs SET state='STORED',provider='local',updated_at=now()
      WHERE id=op.job_id AND state='DEBITED';
    IF NOT FOUND THEN RAISE EXCEPTION 'COMMIT_STATE_INVALID' USING ERRCODE='PT409'; END IF;
    -- This accounting-only job must never surface as generated content. Use
    -- the repository's sole deletion boundary rather than writing deleted_at
    -- here, so holds and all future deletion invariants remain centralized.
    erased:=public.delete_user_job(actor::text,op.job_id);
    IF erased->>'ok' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'ACCOUNTING_JOB_DELETE_FAILED' USING ERRCODE='PT409';
    END IF;
  END IF;
  UPDATE public.editor_manual_commit_operations SET state='COMMITTED',delivery_expires_at=NULL,updated_at=now() WHERE id=op.id;
  RETURN jsonb_build_object('ok',true,'committed',true,'revision',op.revision);
END $$;

CREATE OR REPLACE FUNCTION private.cancel_manual_editor_commit(p_project uuid,p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); op public.editor_manual_commit_operations%ROWTYPE; job_state text; refunded jsonb;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
  IF NOT private.editor_manual_mfa_satisfied(actor)
    THEN RAISE EXCEPTION 'MFA_REQUIRED' USING ERRCODE='PT403'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.editor_manual_commit_config WHERE singleton AND enabled)
    THEN RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE='PT404'; END IF;
  IF p_request_key IS NULL OR p_request_key!~'^[A-Za-z0-9._-]{8,128}$'
    THEN RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY' USING ERRCODE='PT400'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,34));
  PERFORM 1 FROM public.projects WHERE id=p_project FOR UPDATE;
  IF coalesce(private.project_role(p_project),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR')
    THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
  SELECT * INTO op FROM public.editor_manual_commit_operations o
   WHERE o.actor_id=actor AND o.project_id=p_project AND o.request_key=p_request_key FOR UPDATE;
  IF op.id IS NULL THEN RETURN jsonb_build_object('ok',true,'canceled',false,'revision',NULL); END IF;
  IF op.state='COMMITTED' THEN RETURN jsonb_build_object('ok',false,'code','ALREADY_COMMITTED','revision',op.revision); END IF;
  IF op.state='REFUNDED' THEN RETURN jsonb_build_object('ok',true,'canceled',true,'revision',op.revision); END IF;
  IF op.credits=5 THEN
    SELECT state INTO job_state FROM public.jobs WHERE id=op.job_id FOR UPDATE;
    IF job_state='DEBITED' THEN
      refunded:=public.ledger_refund(op.job_id,op.user_id,op.credits,'refund:editor_manual_delivery_failed');
      IF refunded->>'ok' IS DISTINCT FROM 'true' THEN RETURN refunded; END IF;
    ELSIF job_state<>'REFUNDED' THEN
      RETURN jsonb_build_object('ok',false,'code','COMMIT_STATE_INVALID');
    END IF;
  END IF;
  UPDATE public.editor_manual_commit_operations SET state='REFUNDED',delivery_expires_at=NULL,updated_at=now() WHERE id=op.id;
  RETURN jsonb_build_object('ok',true,'canceled',true,'revision',op.revision);
END $$;

-- Authoritative reconciliation for ambiguous reserve/finalize responses.
CREATE OR REPLACE FUNCTION private.manual_editor_commit_status(p_project uuid,p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); op public.editor_manual_commit_operations%ROWTYPE; job_state text; effective_state text;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.editor_manual_commit_config WHERE singleton AND enabled)
    THEN RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE='PT404'; END IF;
  IF p_request_key IS NULL OR p_request_key!~'^[A-Za-z0-9._-]{8,128}$'
    THEN RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY' USING ERRCODE='PT400'; END IF;
  IF coalesce(private.project_role(p_project),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR')
    THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
  SELECT * INTO op FROM public.editor_manual_commit_operations o
   WHERE o.actor_id=actor AND o.project_id=p_project AND o.request_key=p_request_key;
  IF op.id IS NULL THEN
    RETURN jsonb_build_object('ok',true,'committed',false,'pending',false,'canceled',false,'revision',NULL);
  END IF;
  effective_state:=op.state;
  IF op.state IN ('PENDING','DELIVERING') AND op.credits=5 THEN
    SELECT state INTO job_state FROM public.jobs WHERE id=op.job_id;
    IF job_state='REFUNDED' THEN effective_state:='REFUNDED'; END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'committed',effective_state='COMMITTED',
    'pending',effective_state IN ('PENDING','DELIVERING'),'canceled',effective_state='REFUNDED','revision',op.revision);
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
CREATE OR REPLACE FUNCTION public.begin_manual_editor_delivery(p_project_id uuid,p_idempotency_key text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT private.begin_manual_editor_delivery(p_project_id,p_idempotency_key);
$$;
CREATE OR REPLACE FUNCTION public.finalize_manual_editor_commit(p_project_id uuid,p_idempotency_key text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT private.finalize_manual_editor_commit(p_project_id,p_idempotency_key);
$$;
CREATE OR REPLACE FUNCTION public.cancel_manual_editor_commit(p_project_id uuid,p_idempotency_key text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT private.cancel_manual_editor_commit(p_project_id,p_idempotency_key);
$$;

REVOKE ALL ON FUNCTION private.editor_manual_source_hashes(jsonb),private.quote_manual_editor_commit(uuid,jsonb),
  private.save_paid_project_document(uuid,integer,jsonb,text,integer),private.manual_editor_commit_status(uuid,text),
  private.begin_manual_editor_delivery(uuid,text),private.finalize_manual_editor_commit(uuid,text),private.cancel_manual_editor_commit(uuid,text),
  public.quote_manual_editor_commit(uuid,jsonb),public.save_paid_project_document(uuid,integer,jsonb,text,integer),
  public.manual_editor_commit_status(uuid,text),public.begin_manual_editor_delivery(uuid,text),public.finalize_manual_editor_commit(uuid,text),
  public.cancel_manual_editor_commit(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.quote_manual_editor_commit(uuid,jsonb),private.save_paid_project_document(uuid,integer,jsonb,text,integer),
  private.manual_editor_commit_status(uuid,text),private.begin_manual_editor_delivery(uuid,text),private.finalize_manual_editor_commit(uuid,text),private.cancel_manual_editor_commit(uuid,text),
  public.quote_manual_editor_commit(uuid,jsonb),public.save_paid_project_document(uuid,integer,jsonb,text,integer),
  public.manual_editor_commit_status(uuid,text),public.begin_manual_editor_delivery(uuid,text),public.finalize_manual_editor_commit(uuid,text),
  public.cancel_manual_editor_commit(uuid,text) TO authenticated;

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

-- Preserve 0601's sweep behavior while an OS delivery controller owns a
-- live lease. If the app disappears, the lease expires and the ordinary
-- DEBITED timeout refunds the charge without a special worker path.
CREATE OR REPLACE FUNCTION public.sweep_stuck_jobs(
 p_debited_minutes INTEGER DEFAULT 15,p_submitted_minutes INTEGER DEFAULT 120,
 p_limit INTEGER DEFAULT 200,p_succeeded_minutes INTEGER DEFAULT 60
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_job RECORD; v_refunded INTEGER:=0; v_failed INTEGER:=0; v_unstored INTEGER:=0; v_unpaid INTEGER:=0; v_res JSONB;
BEGIN
 FOR v_job IN SELECT j.id,j.user_id,j.credits,j.state FROM public.jobs j
  WHERE j.inputs->>'kind' IS DISTINCT FROM 'speech_analysis'
   AND NOT EXISTS(SELECT 1 FROM public.crun_dispatch d WHERE d.job_id=j.id
    AND d.state IN('READY','STARTED','ACCEPTED','UNKNOWN','DEFERRED'))
   AND NOT EXISTS(SELECT 1 FROM public.editor_manual_commit_operations o WHERE o.job_id=j.id
    AND o.state='DELIVERING' AND o.delivery_expires_at>now())
   AND ((j.state='DEBITED' AND j.updated_at<now()-make_interval(mins=>p_debited_minutes)
      AND NOT(j.error_code IS NOT DISTINCT FROM 'provider_outcome_unknown' AND EXISTS(
       SELECT 1 FROM public.provider_spend_reservations r WHERE r.user_id=j.user_id
        AND (r.effect_key=j.idempotency_key OR starts_with(r.effect_key,j.idempotency_key||':a')))))
    OR (j.state IN('SUBMITTED','FAILOVER') AND j.updated_at<now()-make_interval(mins=>p_submitted_minutes))
    OR (j.state='SUCCEEDED' AND j.updated_at<now()-make_interval(mins=>p_succeeded_minutes)
      AND NOT EXISTS(SELECT 1 FROM public.assets a WHERE a.job_id=j.id))
    OR (j.state='FAILED' AND (j.credits>0 OR j.free_allowance)
      AND j.updated_at<now()-make_interval(mins=>p_debited_minutes)
      AND NOT EXISTS(SELECT 1 FROM public.ledger_entries le WHERE le.job_id=j.id AND le.delta>0)))
  ORDER BY j.updated_at LIMIT p_limit FOR UPDATE OF j SKIP LOCKED
 LOOP
  IF v_job.state IN('SUBMITTED','FAILOVER') THEN
   UPDATE public.jobs SET state='FAILED',error_code='stuck_timeout',updated_at=now() WHERE id=v_job.id; v_failed:=v_failed+1;
  ELSIF v_job.state='SUCCEEDED' THEN
   UPDATE public.jobs SET state='FAILED',error_code='asset_store_failed',updated_at=now() WHERE id=v_job.id; v_unstored:=v_unstored+1;
  ELSIF v_job.state='FAILED' THEN v_unpaid:=v_unpaid+1; END IF;
  v_res:=public.ledger_refund(v_job.id,v_job.user_id,v_job.credits,CASE v_job.state
   WHEN 'DEBITED' THEN 'refund:stuck_debited' WHEN 'SUCCEEDED' THEN 'refund:asset_store_failed'
   WHEN 'FAILED' THEN 'refund:failed_unpaid' ELSE 'refund:stuck_submitted' END);
  IF (v_res->>'ok')::BOOLEAN AND NOT COALESCE((v_res->>'idempotent')::BOOLEAN,false) THEN v_refunded:=v_refunded+1; END IF;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'failed',v_failed,'unstored',v_unstored,'unpaid_failures',v_unpaid,'refunded',v_refunded);
END $$;
REVOKE ALL ON FUNCTION public.sweep_stuck_jobs(INTEGER,INTEGER,INTEGER,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_stuck_jobs(INTEGER,INTEGER,INTEGER,INTEGER) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
