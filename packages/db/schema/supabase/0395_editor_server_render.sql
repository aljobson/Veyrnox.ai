-- ADR-0261 R1–R8. Price is deliberately unset; activation alone cannot admit work.
BEGIN;
-- Survives delete_user_job clearing inputs, including outstanding upload grants.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS editor_render_output_key TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS editor_render_upload_expires_at TIMESTAMPTZ;
UPDATE public.jobs SET editor_render_output_key=inputs->>'output_key',
 editor_render_upload_expires_at=(inputs->>'upload_granted_at')::timestamptz+interval '16 minutes'
 WHERE provider='concat-render' AND editor_render_output_key IS NULL AND inputs->>'output_key' IS NOT NULL;
ALTER TABLE public.model_catalog ADD COLUMN IF NOT EXISTS editor_render_rates JSONB;
INSERT INTO public.model_catalog(id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,cost_unit,billing_seconds,gated_flag,active)
VALUES('editor-server-render','Editor server render','concat-render','concat-render:v1','video-to-video',1,0,'per_second',1,false,false)
ON CONFLICT(id) DO NOTHING;
DO $$ DECLARE affected BIGINT; BEGIN
 UPDATE public.model_catalog SET active=false WHERE id='editor-server-render' AND provider='concat-render';
 GET DIAGNOSTICS affected = ROW_COUNT;
 IF affected <> 1 THEN RAISE EXCEPTION 'Expected one editor-server-render row, updated %',affected; END IF;
END $$;
ALTER TABLE public.editor_library_renders ADD COLUMN IF NOT EXISTS source_job_id UUID UNIQUE REFERENCES public.jobs(id) ON DELETE CASCADE;
ALTER TABLE public.editor_library_renders ADD COLUMN IF NOT EXISTS asset_id UUID UNIQUE REFERENCES public.assets(id) ON DELETE CASCADE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='editor_render_asset_pair') THEN
  ALTER TABLE public.editor_library_renders ADD CONSTRAINT editor_render_asset_pair CHECK((asset_id IS NULL)=(source_job_id IS NULL));
 END IF;
END $$;
CREATE OR REPLACE FUNCTION private.editor_render_link_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF NEW.source_job_id IS DISTINCT FROM OLD.source_job_id OR NEW.asset_id IS DISTINCT FROM OLD.asset_id THEN
  RAISE EXCEPTION 'IMMUTABLE_RENDER_LINK' USING ERRCODE='PT409'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.editor_render_link_guard() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS editor_render_link_guard ON public.editor_library_renders;
CREATE TRIGGER editor_render_link_guard BEFORE UPDATE ON public.editor_library_renders FOR EACH ROW EXECUTE FUNCTION private.editor_render_link_guard();

-- Caller holds the SAME owner advisory lock as browser reservation (ESR-016).
CREATE OR REPLACE FUNCTION private.editor_render_capacity(p_user UUID,p_actor UUID,p_bytes BIGINT,p_exclude UUID DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (SELECT count(*) FROM public.editor_library_renders WHERE owner_id=p_actor)
       +(SELECT count(*) FROM public.jobs WHERE user_id=p_user AND provider='concat-render' AND state IN ('DEBITED','SUBMITTED') AND id IS DISTINCT FROM p_exclude)<100
 AND (SELECT coalesce(sum(size_bytes),0) FROM public.editor_library_renders WHERE owner_id=p_actor)
       +(SELECT count(*)*26214400 FROM public.jobs WHERE user_id=p_user AND provider='concat-render' AND state IN ('DEBITED','SUBMITTED') AND id IS DISTINCT FROM p_exclude)+p_bytes<=209715200;
$$;
REVOKE ALL ON FUNCTION private.editor_render_capacity(UUID,UUID,BIGINT,UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.admit_server_render(p_auth_id TEXT,p_request_key TEXT,p_document JSONB,p_resolution TEXT,p_seconds NUMERIC,p_label TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u public.users%ROWTYPE; j public.jobs%ROWTYPE; m public.model_catalog%ROWTYPE;
 rate NUMERIC; amount INTEGER; result JSONB; output_id UUID:=gen_random_uuid(); args JSONB;
BEGIN
 SELECT * INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 PERFORM pg_advisory_xact_lock(261,hashtext(u.id::text));
 PERFORM 1 FROM public.credit_balances WHERE user_id=u.id FOR UPDATE;
 -- Recheck after waiting; do not hold a users row lock across ledger calls.
 SELECT * INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 IF NOT FOUND OR u.frozen_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9._-]{8,128}$'
 OR p_resolution IS NULL OR p_resolution NOT IN ('720p','1080p') OR p_seconds IS NULL OR p_seconds<=0
 OR p_seconds>(CASE WHEN p_resolution='1080p' THEN 120 ELSE 300 END)
 OR p_label IS NULL OR length(btrim(p_label)) NOT BETWEEN 1 AND 160 OR p_label ~ '[[:cntrl:]]'
 OR p_document IS NULL OR octet_length(p_document::text)>40000 THEN
 RETURN jsonb_build_object('ok',false,'code','INVALID_RENDER'); END IF;
 args:=jsonb_build_object('kind','editor-render','document',p_document,'resolution',p_resolution,'seconds',p_seconds,'prompt',btrim(p_label));
 SELECT * INTO j FROM public.jobs WHERE user_id=u.id AND idempotency_key=p_request_key;
 IF FOUND THEN
  IF j.model_id<>'editor-server-render' OR (j.inputs-'output_key'-'output_id'-'upload_size'-'upload_granted_at'-'cleanup_queued'-'cleanup_skipped') IS DISTINCT FROM args OR j.deleted_at IS NOT NULL THEN
   RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  RETURN jsonb_build_object('ok',true,'job_id',j.id,'idempotent',true,'credits',j.credits,'state',j.state);
 END IF;
 SELECT * INTO m FROM public.model_catalog WHERE id='editor-server-render' AND provider='concat-render';
 IF NOT FOUND OR NOT m.active OR jsonb_typeof(m.editor_render_rates->p_resolution) IS DISTINCT FROM 'number' THEN
  RETURN jsonb_build_object('ok',false,'code','NOT_ENABLED'); END IF;
 rate:=(m.editor_render_rates->>p_resolution)::numeric;
 IF rate<=0 OR rate>100000 OR ceil(rate*p_seconds)>2147483647 THEN RETURN jsonb_build_object('ok',false,'code','NOT_ENABLED'); END IF;
 amount:=ceil(rate*p_seconds)::integer;
 IF NOT private.editor_render_capacity(u.id,p_auth_id::uuid,26214400) THEN RETURN jsonb_build_object('ok',false,'code','RENDER_LIMIT'); END IF;
 args:=args||jsonb_build_object('output_id',output_id,'output_key','editor-renders/'||lower(p_auth_id)||'/'||output_id::text||'.mp4');
 result:=public.ledger_debit(u.id,p_request_key,amount,'debit:editor_render','editor-server-render',args,10,60);
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RETURN result; END IF;
 -- The owner lock serializes our admissions; ledger_debit alone owns job creation.
 SELECT * INTO j FROM public.jobs WHERE id=(result->>'job_id')::uuid FOR UPDATE;
 IF j.inputs IS DISTINCT FROM args OR j.state<>'DEBITED' THEN RAISE EXCEPTION 'EDITOR_ADMISSION_CONFLICT'; END IF;
 UPDATE public.jobs SET editor_render_output_key=args->>'output_key' WHERE id=j.id;
 IF public.job_submitted(j.id,'concat-render','er_'||j.id::text)->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'EDITOR_SUBMIT_FAILED'; END IF;
 RETURN result||jsonb_build_object('credits',amount,'state','SUBMITTED');
END $$;

CREATE OR REPLACE FUNCTION public.fail_server_render(p_job_id UUID,p_error TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.jobs%ROWTYPE; result JSONB;
BEGIN
 SELECT * INTO j FROM public.jobs WHERE id=p_job_id AND provider='concat-render';
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 PERFORM pg_advisory_xact_lock(261,hashtext(j.user_id::text));
 -- Match ledger_refund/shared sweep: job before balance, with no users lock.
 SELECT * INTO j FROM public.jobs WHERE id=p_job_id AND provider='concat-render' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF j.state IN ('STORED','REFUNDED') THEN RETURN jsonb_build_object('ok',true,'idempotent',true,'state',j.state); END IF;
 IF j.state NOT IN ('DEBITED','SUBMITTED','FAILED') THEN RETURN jsonb_build_object('ok',false,'code','BAD_STATE'); END IF;
 UPDATE public.jobs SET state='FAILED',error_code=CASE WHEN p_error ~ '^[a-z0-9_]{1,64}$' THEN p_error ELSE 'runner_failed' END,updated_at=now() WHERE id=j.id;
 result:=public.ledger_refund(j.id,j.user_id,j.credits,'refund:editor_render');
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'EDITOR_REFUND_FAILED'; END IF;
 RETURN result||jsonb_build_object('state','REFUNDED');
END $$;

CREATE OR REPLACE FUNCTION public.server_render_upload_grant(p_job_id UUID,p_size BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.jobs%ROWTYPE;
BEGIN
 SELECT * INTO j FROM public.jobs WHERE id=p_job_id AND provider='concat-render' FOR UPDATE;
 IF NOT FOUND OR j.state<>'SUBMITTED' OR j.deleted_at IS NOT NULL OR j.created_at<now()-interval '45 minutes'
 OR EXISTS(SELECT 1 FROM public.users WHERE id=j.user_id AND (frozen_at IS NOT NULL OR deleted_at IS NOT NULL))
 OR EXISTS(SELECT 1 FROM public.evidence_holds WHERE r2_key=j.inputs->>'output_key' AND released_at IS NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','UPLOAD_CLOSED'); END IF;
 IF p_size IS NULL OR p_size NOT BETWEEN 1 AND 26214400 THEN RETURN jsonb_build_object('ok',false,'code','RENDER_TOO_LARGE'); END IF;
 IF j.inputs ? 'upload_size' AND (j.inputs->>'upload_size')::bigint<>p_size THEN RETURN jsonb_build_object('ok',false,'code','UPLOAD_SIZE_CONFLICT'); END IF;
 UPDATE public.jobs SET inputs=inputs||jsonb_build_object('upload_size',p_size,'upload_granted_at',now()),
 editor_render_upload_expires_at=now()+interval '16 minutes' WHERE id=j.id;
 RETURN jsonb_build_object('ok',true,'r2_key',j.inputs->>'output_key','size_bytes',p_size);
END $$;

CREATE OR REPLACE FUNCTION public.finalize_server_render(p_job_id UUID,p_size BIGINT,p_sha256 TEXT,p_width INTEGER,p_height INTEGER,p_seconds NUMERIC,p_frame_rate INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.jobs%ROWTYPE; u public.users%ROWTYPE; a UUID; rid UUID; saved public.editor_library_renders%ROWTYPE; result JSONB;
BEGIN
 SELECT * INTO j FROM public.jobs WHERE id=p_job_id AND provider='concat-render';
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 PERFORM pg_advisory_xact_lock(261,hashtext(j.user_id::text));
 SELECT * INTO j FROM public.jobs WHERE id=p_job_id AND provider='concat-render' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 PERFORM 1 FROM public.credit_balances WHERE user_id=j.user_id FOR UPDATE;
 SELECT * INTO u FROM public.users WHERE id=j.user_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF j.state='STORED' THEN
  SELECT * INTO saved FROM public.editor_library_renders WHERE source_job_id=j.id;
  RETURN jsonb_build_object('ok',true,'idempotent',true,'state','STORED','render_id',saved.id);
 END IF;
 IF j.state<>'SUBMITTED' OR j.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','JOB_CLOSED'); END IF;
 IF u.frozen_at IS NOT NULL OR u.deleted_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.evidence_holds WHERE r2_key=j.inputs->>'output_key' AND released_at IS NULL) THEN
  RETURN public.fail_server_render(j.id,'render_unavailable'); END IF;
 IF p_size IS NULL OR p_size NOT BETWEEN 1 AND 26214400 OR p_size IS DISTINCT FROM (j.inputs->>'upload_size')::bigint
 OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' OR p_width IS NULL OR p_height IS NULL
 OR p_width NOT BETWEEN 1 AND 1920 OR p_height NOT BETWEEN 1 AND 1920
 OR p_seconds IS NULL OR abs(p_seconds-(j.inputs->>'seconds')::numeric)>0.1 OR p_frame_rate IS DISTINCT FROM 30 THEN
  RETURN public.fail_server_render(j.id,'render_invalid'); END IF;
 IF NOT private.editor_render_capacity(u.id,u.auth_id::uuid,p_size,j.id) THEN RETURN public.fail_server_render(j.id,'render_limit'); END IF;
 rid:=(j.inputs->>'output_id')::uuid;
 result:=public.job_stored(j.provider_job_id,'concat-render',j.inputs->>'output_key','video/mp4',p_size,p_sha256);
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'EDITOR_SETTLEMENT_FAILED'; END IF;
 a:=(result->>'asset_id')::uuid;
 INSERT INTO public.editor_library_renders(id,owner_id,label,r2_key,sha256,size_bytes,request_key,state,width,height,seconds,frame_rate,inspected_at,expires_at,source_job_id,asset_id)
 VALUES(rid,u.auth_id::uuid,j.inputs->>'prompt',j.inputs->>'output_key',p_sha256,p_size,'server-'||j.id::text,'stored',p_width,p_height,p_seconds,p_frame_rate,now(),now()+interval '90 days',j.id,a);
 UPDATE public.assets SET expires_at=(SELECT expires_at FROM public.editor_library_renders WHERE id=rid) WHERE id=a;
 RETURN jsonb_build_object('ok',true,'state','STORED','render_id',rid,'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.admit_server_render(TEXT,TEXT,JSONB,TEXT,NUMERIC,TEXT),public.fail_server_render(UUID,TEXT),public.server_render_upload_grant(UUID,BIGINT),public.finalize_server_render(UUID,BIGINT,TEXT,INTEGER,INTEGER,NUMERIC,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admit_server_render(TEXT,TEXT,JSONB,TEXT,NUMERIC,TEXT),public.fail_server_render(UUID,TEXT),public.server_render_upload_grant(UUID,BIGINT),public.finalize_server_render(UUID,BIGINT,TEXT,INTEGER,INTEGER,NUMERIC,INTEGER) TO service_role;
COMMIT;
