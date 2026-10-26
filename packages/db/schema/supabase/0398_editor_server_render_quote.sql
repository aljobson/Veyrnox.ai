-- ADR-0261 slice 4: read-only quotes and atomic price consent. No catalog change.
BEGIN;
CREATE OR REPLACE FUNCTION private.editor_render_credits(p_credits INTEGER,p_seconds NUMERIC,p_billing NUMERIC)
RETURNS INTEGER LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT greatest(1,ceil(p_credits*p_seconds/p_billing)::integer);
$$;
REVOKE ALL ON FUNCTION private.editor_render_credits(INTEGER,NUMERIC,NUMERIC) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.quote_server_render(p_seconds NUMERIC,p_resolution TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.model_catalog%ROWTYPE; billing NUMERIC; maximum INTEGER;
BEGIN
 IF p_resolution IS NULL OR p_resolution NOT IN ('720p','1080p') OR p_seconds IS NULL OR p_seconds<=0
 OR p_seconds>(CASE WHEN p_resolution='1080p' THEN 120 ELSE 300 END) THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_RENDER'); END IF;
 maximum:=CASE WHEN p_resolution='1080p' THEN 120 ELSE 300 END;
 SELECT * INTO m FROM public.model_catalog WHERE id='editor-server-render' AND provider='concat-render';
 IF NOT FOUND OR NOT m.active OR jsonb_typeof(m.editor_render_rates->p_resolution->'billing_seconds') IS DISTINCT FROM 'number' THEN
  RETURN jsonb_build_object('ok',false,'code','NOT_ENABLED'); END IF;
 billing:=(m.editor_render_rates->p_resolution->>'billing_seconds')::numeric;
 IF billing<=0 OR m.cost_unit IS DISTINCT FROM 'per_second' OR m.credits_5s<=0
 OR ceil(m.credits_5s*p_seconds/billing)>2147483647 THEN RETURN jsonb_build_object('ok',false,'code','NOT_ENABLED'); END IF;
 RETURN jsonb_build_object('credits',private.editor_render_credits(m.credits_5s,p_seconds,billing),'max_seconds',maximum);
END $$;
REVOKE ALL ON FUNCTION public.quote_server_render(NUMERIC,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.quote_server_render(NUMERIC,TEXT) TO service_role;

-- A changed argument list creates an overload; remove the old signature explicitly.
DROP FUNCTION IF EXISTS public.admit_server_render(TEXT,TEXT,JSONB,TEXT,NUMERIC,TEXT);
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
  IF j.model_id<>'editor-server-render' OR (j.inputs-'output_key'-'output_id'-'upload_size'-'upload_granted_at'-'cleanup_queued'-'cleanup_skipped') IS DISTINCT FROM args OR j.deleted_at IS NOT NULL THEN
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
COMMIT;
