-- F070: phone/server editor exports may request the saved project's frame rate,
-- including 2160p at 60 fps. 4K is intentionally capped at 30 seconds and
-- 100 MiB; 720p/1080p retain their existing duration and 25 MiB ceilings.
BEGIN;

DO $$
DECLARE v_updated integer;
BEGIN
 UPDATE public.model_catalog
 SET editor_render_rates=jsonb_set(coalesce(editor_render_rates,'{}'::jsonb),'{2160p}','{"billing_seconds":5}'::jsonb,true),updated_at=now()
 WHERE id='editor-server-render' AND provider='concat-render';
 GET DIAGNOSTICS v_updated = ROW_COUNT;
 IF v_updated <> 1 THEN RAISE EXCEPTION 'expected one editor-server-render catalog row, updated %', v_updated; END IF;
END $$;

CREATE OR REPLACE FUNCTION private.editor_render_capacity(p_user UUID,p_actor UUID,p_bytes BIGINT,p_exclude UUID DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (SELECT count(*) FROM public.editor_library_renders WHERE owner_id=p_actor)
       +(SELECT count(*) FROM public.jobs WHERE user_id=p_user AND provider='concat-render' AND state IN ('DEBITED','SUBMITTED') AND id IS DISTINCT FROM p_exclude)<100
 AND (SELECT coalesce(sum(size_bytes),0) FROM public.editor_library_renders WHERE owner_id=p_actor)
       +(SELECT coalesce(sum(CASE WHEN inputs->>'resolution'='2160p' THEN 104857600 ELSE 26214400 END),0)
         FROM public.jobs WHERE user_id=p_user AND provider='concat-render' AND state IN ('DEBITED','SUBMITTED') AND id IS DISTINCT FROM p_exclude)
       +p_bytes<=209715200;
$$;
REVOKE ALL ON FUNCTION private.editor_render_capacity(UUID,UUID,BIGINT,UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.quote_server_render(p_seconds NUMERIC,p_resolution TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.model_catalog%ROWTYPE; billing NUMERIC; maximum INTEGER;
BEGIN
 maximum:=CASE p_resolution WHEN '2160p' THEN 30 WHEN '1080p' THEN 120 WHEN '720p' THEN 300 END;
 IF maximum IS NULL OR p_seconds IS NULL OR p_seconds<=0 OR p_seconds>maximum THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_RENDER'); END IF;
 SELECT * INTO m FROM public.model_catalog WHERE id='editor-server-render' AND provider='concat-render';
 IF NOT FOUND OR NOT m.active OR jsonb_typeof(m.editor_render_rates->p_resolution->'billing_seconds') IS DISTINCT FROM 'number' THEN
  RETURN jsonb_build_object('ok',false,'code','NOT_ENABLED'); END IF;
 billing:=(m.editor_render_rates->p_resolution->>'billing_seconds')::numeric;
 IF billing<=0 OR m.cost_unit IS DISTINCT FROM 'per_second' OR m.credits_5s<=0
 OR ceil(m.credits_5s*p_seconds/billing)>2147483647 THEN RETURN jsonb_build_object('ok',false,'code','NOT_ENABLED'); END IF;
 RETURN jsonb_build_object('credits',private.editor_render_credits(m.credits_5s,p_seconds,billing),'max_seconds',maximum);
END $$;

CREATE OR REPLACE FUNCTION public.admit_server_render(p_auth_id TEXT,p_request_key TEXT,p_document JSONB,p_resolution TEXT,p_seconds NUMERIC,p_label TEXT,p_quoted_credits INTEGER DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u public.users%ROWTYPE; j public.jobs%ROWTYPE; m public.model_catalog%ROWTYPE;
 billing NUMERIC; amount INTEGER; result JSONB; output_id UUID:=gen_random_uuid(); args JSONB; maximum INTEGER; reserved BIGINT;
BEGIN
 SELECT * INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 PERFORM pg_advisory_xact_lock(261,hashtext(u.id::text));
 PERFORM 1 FROM public.credit_balances WHERE user_id=u.id FOR UPDATE;
 SELECT * INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 IF NOT FOUND OR u.frozen_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 maximum:=CASE p_resolution WHEN '2160p' THEN 30 WHEN '1080p' THEN 120 WHEN '720p' THEN 300 END;
 reserved:=CASE WHEN p_resolution='2160p' THEN 104857600 ELSE 26214400 END;
 IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9._-]{8,128}$'
 OR maximum IS NULL OR p_seconds IS NULL OR p_seconds<=0 OR p_seconds>maximum
 OR p_label IS NULL OR length(btrim(p_label)) NOT BETWEEN 1 AND 160 OR p_label ~ '[[:cntrl:]]'
 OR p_document IS NULL OR octet_length(p_document::text)>40000
 OR coalesce(p_document#>>'{canvas,frame_rate}','') NOT IN ('24','25','30','60') THEN
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
 IF p_quoted_credits IS NOT NULL AND p_quoted_credits<>amount THEN RETURN jsonb_build_object('ok',false,'code','PRICE_CHANGED'); END IF;
 IF NOT private.editor_render_capacity(u.id,p_auth_id::uuid,reserved) THEN RETURN jsonb_build_object('ok',false,'code','RENDER_LIMIT'); END IF;
 args:=args||jsonb_build_object('output_id',output_id,'output_key','editor-renders/'||lower(p_auth_id)||'/'||output_id::text||'.mp4');
 result:=public.ledger_debit(u.id,p_request_key,amount,'debit:editor_render','editor-server-render',args,10,60);
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RETURN result; END IF;
 SELECT * INTO j FROM public.jobs WHERE id=(result->>'job_id')::uuid FOR UPDATE;
 IF j.inputs IS DISTINCT FROM args OR j.state<>'DEBITED' THEN RAISE EXCEPTION 'EDITOR_ADMISSION_CONFLICT'; END IF;
 UPDATE public.jobs SET editor_render_output_key=args->>'output_key' WHERE id=j.id;
 IF public.job_submitted(j.id,'concat-render','er_'||j.id::text)->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'EDITOR_SUBMIT_FAILED'; END IF;
 RETURN result||jsonb_build_object('credits',amount,'state','SUBMITTED');
END $$;

CREATE OR REPLACE FUNCTION public.server_render_upload_grant(p_job_id UUID,p_size BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.jobs%ROWTYPE; maximum BIGINT;
BEGIN
 SELECT * INTO j FROM public.jobs WHERE id=p_job_id AND provider='concat-render' FOR UPDATE;
 IF NOT FOUND OR j.state<>'SUBMITTED' OR j.deleted_at IS NOT NULL OR j.created_at<now()-interval '45 minutes'
 OR EXISTS(SELECT 1 FROM public.users WHERE id=j.user_id AND (frozen_at IS NOT NULL OR deleted_at IS NOT NULL))
 OR EXISTS(SELECT 1 FROM public.evidence_holds WHERE r2_key=j.inputs->>'output_key' AND released_at IS NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','UPLOAD_CLOSED'); END IF;
 IF j.editor_render_upload_grants>=4 THEN RETURN jsonb_build_object('ok',false,'code','UPLOAD_CLOSED'); END IF;
 maximum:=CASE WHEN j.inputs->>'resolution'='2160p' THEN 104857600 ELSE 26214400 END;
 IF p_size IS NULL OR p_size NOT BETWEEN 1 AND maximum THEN RETURN jsonb_build_object('ok',false,'code','RENDER_TOO_LARGE'); END IF;
 IF j.inputs ? 'upload_size' AND (j.inputs->>'upload_size')::bigint<>p_size THEN RETURN jsonb_build_object('ok',false,'code','UPLOAD_SIZE_CONFLICT'); END IF;
 UPDATE public.jobs SET inputs=inputs||jsonb_build_object('upload_size',p_size,'upload_granted_at',now()),
 editor_render_upload_expires_at=now()+interval '16 minutes',editor_render_upload_grants=editor_render_upload_grants+1 WHERE id=j.id;
 RETURN jsonb_build_object('ok',true,'r2_key',j.inputs->>'output_key','size_bytes',p_size);
END $$;

CREATE OR REPLACE FUNCTION public.finalize_server_render(p_job_id UUID,p_size BIGINT,p_sha256 TEXT,p_width INTEGER,p_height INTEGER,p_seconds NUMERIC,p_frame_rate INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.jobs%ROWTYPE; u public.users%ROWTYPE; a UUID; rid UUID; saved public.editor_library_renders%ROWTYPE; result JSONB;
 maximum BIGINT; edge INTEGER; expected_width INTEGER; expected_height INTEGER; expected_rate INTEGER; aspect TEXT;
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
 maximum:=CASE WHEN j.inputs->>'resolution'='2160p' THEN 104857600 ELSE 26214400 END;
 edge:=CASE j.inputs->>'resolution' WHEN '2160p' THEN 2160 WHEN '1080p' THEN 1080 WHEN '720p' THEN 720 END;
 aspect:=j.inputs#>>'{document,canvas,aspect_ratio}'; expected_rate:=(j.inputs#>>'{document,canvas,frame_rate}')::integer;
 expected_width:=CASE aspect WHEN '16:9' THEN edge*16/9 WHEN '9:16' THEN edge ELSE edge END;
 expected_height:=CASE aspect WHEN '16:9' THEN edge WHEN '9:16' THEN edge*16/9 ELSE edge END;
 IF edge IS NULL OR expected_rate NOT IN (24,25,30,60)
 OR p_size IS NULL OR p_size NOT BETWEEN 1 AND maximum OR p_size IS DISTINCT FROM (j.inputs->>'upload_size')::bigint
 OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' OR p_width IS DISTINCT FROM expected_width OR p_height IS DISTINCT FROM expected_height
 OR p_seconds IS NULL OR abs(p_seconds-(j.inputs->>'seconds')::numeric)>greatest(2.0/nullif(p_frame_rate,0),0.1) OR p_frame_rate IS DISTINCT FROM expected_rate THEN
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

REVOKE ALL ON FUNCTION public.quote_server_render(NUMERIC,TEXT),public.admit_server_render(TEXT,TEXT,JSONB,TEXT,NUMERIC,TEXT,INTEGER),public.server_render_upload_grant(UUID,BIGINT),public.finalize_server_render(UUID,BIGINT,TEXT,INTEGER,INTEGER,NUMERIC,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.quote_server_render(NUMERIC,TEXT),public.admit_server_render(TEXT,TEXT,JSONB,TEXT,NUMERIC,TEXT,INTEGER),public.server_render_upload_grant(UUID,BIGINT),public.finalize_server_render(UUID,BIGINT,TEXT,INTEGER,INTEGER,NUMERIC,INTEGER) TO service_role;

COMMIT;
