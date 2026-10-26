-- ADR-0261 slice 5: replay before source freshness, and a safe new-render window.
BEGIN;
-- Advisory preflight uses the same reservation/legacy-object accounting as
-- reserve_upload. Its locked per-file check remains authoritative under races.
CREATE OR REPLACE FUNCTION public.check_upload_batch_budget(p_auth_id TEXT,p_stored JSONB,p_count INTEGER,p_bytes BIGINT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE uid UUID; held_count BIGINT; held_bytes BIGINT;
BEGIN
 IF p_count IS NULL OR p_count<1 OR p_bytes IS NULL OR p_bytes<1
 OR p_stored IS NULL OR jsonb_typeof(p_stored)<>'array' OR jsonb_array_length(p_stored)>10 THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID'); END IF;
 SELECT id INTO uid FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 IF uid IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 SELECT count(*),coalesce(sum(size_bytes),0) INTO held_count,held_bytes
 FROM public.upload_reservations WHERE user_id=uid;
 SELECT held_count+count(*),held_bytes+coalesce(sum(greatest(0,(o->>'size')::bigint)),0)
 INTO held_count,held_bytes FROM jsonb_array_elements(p_stored) o
 WHERE NOT EXISTS(SELECT 1 FROM public.upload_reservations r WHERE r.r2_key=o->>'key' AND r.user_id=uid);
 IF held_count+p_count>10 OR held_bytes+p_bytes>209715200 THEN
  RETURN jsonb_build_object('ok',false,'code','UPLOAD_BUDGET_EXCEEDED'); END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.check_upload_batch_budget(TEXT,JSONB,INTEGER,BIGINT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.check_upload_batch_budget(TEXT,JSONB,INTEGER,BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION private.server_render_identity(p_inputs JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_inputs-'output_key'-'output_id'-'upload_size'-'upload_granted_at'-'cleanup_queued'-'cleanup_skipped';
$$;
REVOKE ALL ON FUNCTION private.server_render_identity(JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.server_render_identity(JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.replay_server_render(p_auth_id TEXT,p_request_key TEXT,p_document JSONB,p_resolution TEXT,p_seconds NUMERIC,p_label TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('ok',true,'job_id',j.id,'idempotent',true,'credits',j.credits,'state',j.state)
 FROM public.users u JOIN public.jobs j ON j.user_id=u.id
 WHERE u.auth_id=p_auth_id AND u.deleted_at IS NULL AND u.frozen_at IS NULL
 AND j.idempotency_key=p_request_key AND j.model_id='editor-server-render' AND j.deleted_at IS NULL
 AND private.server_render_identity(j.inputs) IS NOT DISTINCT FROM
 jsonb_build_object('kind','editor-render','document',p_document,'resolution',p_resolution,'seconds',p_seconds,'prompt',btrim(p_label));
$$;
REVOKE ALL ON FUNCTION public.replay_server_render(TEXT,TEXT,JSONB,TEXT,NUMERIC,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.replay_server_render(TEXT,TEXT,JSONB,TEXT,NUMERIC,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.admit_server_render(p_auth_id TEXT,p_request_key TEXT,p_document JSONB,p_resolution TEXT,p_seconds NUMERIC,p_label TEXT,p_quoted_credits INTEGER DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u public.users%ROWTYPE; j public.jobs%ROWTYPE; m public.model_catalog%ROWTYPE;
 billing NUMERIC; amount INTEGER; result JSONB; output_id UUID:=gen_random_uuid(); args JSONB;
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
  IF j.model_id<>'editor-server-render' OR private.server_render_identity(j.inputs) IS DISTINCT FROM args OR j.deleted_at IS NOT NULL THEN
   RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  RETURN jsonb_build_object('ok',true,'job_id',j.id,'idempotent',true,'credits',j.credits,'state',j.state);
 END IF;
 SELECT * INTO m FROM public.model_catalog WHERE id='editor-server-render' AND provider='concat-render';
 IF NOT FOUND OR NOT m.active OR jsonb_typeof(m.editor_render_rates->p_resolution->'billing_seconds') IS DISTINCT FROM 'number' THEN
  RETURN jsonb_build_object('ok',false,'code','NOT_ENABLED'); END IF;
 billing:=(m.editor_render_rates->p_resolution->>'billing_seconds')::numeric;
 IF billing<=0 OR m.cost_unit IS DISTINCT FROM 'per_second' OR m.credits_5s<=0
 OR ceil(m.credits_5s*p_seconds/billing)>2147483647 THEN RETURN jsonb_build_object('ok',false,'code','NOT_ENABLED'); END IF;
 amount:=private.editor_render_credits(m.credits_5s,p_seconds,billing);
 IF p_quoted_credits IS NOT NULL AND p_quoted_credits<>amount THEN
  RETURN jsonb_build_object('ok',false,'code','PRICE_CHANGED'); END IF;
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

REVOKE ALL ON FUNCTION public.admit_server_render(TEXT,TEXT,JSONB,TEXT,NUMERIC,TEXT,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admit_server_render(TEXT,TEXT,JSONB,TEXT,NUMERIC,TEXT,INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.server_render_source(p_auth_id TEXT,p_media_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE uid UUID; mid UUID; r RECORD;
BEGIN
 SELECT id INTO uid FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL AND frozen_at IS NULL;
 IF uid IS NULL OR p_media_id !~ '^[jefu]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 mid:=substring(p_media_id from 3)::uuid;
 IF left(p_media_id,1)='j' THEN
  SELECT a.r2_key,a.size_bytes,a.mime_type INTO r FROM public.assets a JOIN public.jobs j ON j.id=a.job_id
 WHERE j.id=mid AND j.user_id=uid AND j.deleted_at IS NULL AND j.state='STORED' AND a.held_at IS NULL
  AND (SELECT count(*) FROM public.assets all_assets WHERE all_assets.job_id=j.id)=1
  AND (a.expires_at IS NULL OR a.expires_at>now()) AND NOT EXISTS(SELECT 1 FROM public.evidence_holds h WHERE h.r2_key=a.r2_key AND h.released_at IS NULL) LIMIT 1;
 ELSIF left(p_media_id,1)='e' THEN
  SELECT e.r2_key,e.size_bytes,'video/mp4'::text AS mime_type INTO r FROM public.editor_library_renders e
  WHERE e.id=mid AND e.owner_id=p_auth_id::uuid AND e.state='stored' AND e.expires_at>now()
  AND NOT EXISTS(SELECT 1 FROM public.evidence_holds h WHERE h.r2_key=e.r2_key AND h.released_at IS NULL)
  AND private.editor_render_available(e.asset_id,e.source_job_id,e.r2_key);
 ELSIF left(p_media_id,1)='u' THEN
  SELECT r2_key,size_bytes,CASE WHEN r2_key LIKE '%.mp4' THEN 'video/mp4' WHEN r2_key LIKE '%.mp3' THEN 'audio/mpeg' WHEN r2_key LIKE '%.wav' THEN 'audio/wav' END AS mime_type INTO r
  FROM public.upload_reservations ur WHERE user_id=uid AND r2_key ~ ('^uploads/'||lower(p_auth_id)||'/'||mid::text||'\.(mp4|mp3|wav)$')
  AND created_at>now()-interval '23 hours'
  AND NOT EXISTS(SELECT 1 FROM public.evidence_holds h WHERE h.r2_key=ur.r2_key AND h.released_at IS NULL) LIMIT 1;
 ELSE
  SELECT f.r2_key,f.size_bytes,'video/mp4'::text AS mime_type INTO r FROM public.film_library_masters f
  WHERE f.id=mid AND f.user_id=uid AND f.expires_at>now()
  AND NOT EXISTS(SELECT 1 FROM public.evidence_holds h WHERE h.job_id=f.source_job_id AND h.released_at IS NULL);
 END IF;
 IF r IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 RETURN jsonb_build_object('ok',true,'r2_key',r.r2_key,'size_bytes',r.size_bytes,'mime_type',r.mime_type);
END $$;
REVOKE ALL ON FUNCTION public.server_render_source(TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.server_render_source(TEXT,TEXT) TO service_role;
COMMIT;
