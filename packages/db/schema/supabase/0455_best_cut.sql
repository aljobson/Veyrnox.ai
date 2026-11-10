-- ADR-0334. Additive, idempotent; apply only through the owner-approved workflow.
ALTER TABLE public.speech_analyses ALTER COLUMN asset_job_id DROP NOT NULL;
ALTER TABLE public.speech_analyses ALTER COLUMN asset_id DROP NOT NULL;
ALTER TABLE public.speech_analyses ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'job' CHECK(source_kind IN ('job','upload'));
ALTER TABLE public.speech_analyses ADD COLUMN IF NOT EXISTS upload_key text;
ALTER TABLE public.speech_analyses ADD COLUMN IF NOT EXISTS source_size bigint;
ALTER TABLE public.speech_analyses ADD COLUMN IF NOT EXISTS gate_reserved boolean NOT NULL DEFAULT false;
ALTER TABLE public.speech_analyses DROP CONSTRAINT IF EXISTS speech_analyses_status_check;
ALTER TABLE public.speech_analyses ADD CONSTRAINT speech_analyses_status_check CHECK(status IN ('queued','completed','completed_no_speech','failed'));
ALTER TABLE public.speech_analysis_requests ADD COLUMN IF NOT EXISTS accepts_no_speech boolean NOT NULL DEFAULT false;
-- Content-free request identity enables recovery after temporary upload expiry.
ALTER TABLE public.speech_analysis_requests ADD COLUMN IF NOT EXISTS source_ref text;
CREATE INDEX IF NOT EXISTS speech_analyses_upload_identity ON public.speech_analyses(user_id,source_fingerprint,source_size,created_at) WHERE source_kind='upload';
CREATE TABLE IF NOT EXISTS public.speech_gate_daily (
 user_id uuid PRIMARY KEY REFERENCES public.users(id),
 day date NOT NULL, used integer NOT NULL DEFAULT 0 CHECK(used>=0),
 reserved integer NOT NULL DEFAULT 0 CHECK(reserved>=0)
);
ALTER TABLE public.speech_gate_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.speech_gate_daily FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.speech_gate_daily FROM PUBLIC,anon,authenticated;
-- Reservations survive midnight; used counts refunds settled on the current UTC day.
CREATE OR REPLACE FUNCTION private.speech_gate_settle(p_job_id uuid,p_silent boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid; today date := (clock_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
 UPDATE public.speech_analyses SET gate_reserved=false WHERE job_id=p_job_id AND gate_reserved RETURNING user_id INTO u;
 IF u IS NULL THEN RETURN; END IF;
 PERFORM 1 FROM public.speech_gate_daily WHERE user_id=u FOR UPDATE;
 today:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
 UPDATE public.speech_gate_daily SET reserved=reserved-1,
 used=(CASE WHEN day=today THEN used ELSE 0 END)+CASE WHEN p_silent THEN 1 ELSE 0 END,day=today WHERE user_id=u;
END $$;
REVOKE ALL ON FUNCTION private.speech_gate_settle(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION public.speech_analysis_get(p_auth_id text,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.speech_analyses%ROWTYPE; j public.jobs%ROWTYPE; u uuid; source jsonb;
BEGIN
 SELECT id INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 SELECT * INTO a FROM public.speech_analyses WHERE job_id=p_id AND user_id=u;
 IF a.id IS NULL OR a.created_at<=now()-interval '30 days' THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF a.source_kind='job' THEN
 source:=public.speech_source(p_auth_id,a.asset_job_id);
 IF source->>'ok' IS DISTINCT FROM 'true' OR source->>'sha256' IS DISTINCT FROM a.source_fingerprint THEN
  RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 END IF;
 SELECT * INTO j FROM public.jobs WHERE id=a.job_id;
 RETURN jsonb_build_object('ok',true,'id',j.id,'status',CASE WHEN a.status='completed_no_speech' THEN 'failed' ELSE a.status END,
  'progress',CASE WHEN j.state='SUBMITTED' THEN 'transcribing' ELSE 'queued' END,
  'refunded',j.state='REFUNDED' AND EXISTS(SELECT 1 FROM public.ledger_entries WHERE job_id=j.id AND delta>0 AND reason LIKE 'refund:%'),
  'analysis',CASE WHEN a.status='completed' THEN a.analysis ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.speech_analysis_get(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.speech_analysis_get(text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.speech_analysis_by_key(p_auth_id text,p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.speech_analysis_requests%ROWTYPE; u uuid; value jsonb; j public.jobs%ROWTYPE; source jsonb;
BEGIN
 SELECT id INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 SELECT * INTO r FROM public.speech_analysis_requests WHERE user_id=u AND idempotency_key=p_key;
 IF r.attempt_id IS NULL THEN RETURN jsonb_build_object('ok',true,'found',false); END IF;
 SELECT * INTO j FROM public.jobs WHERE id=r.attempt_id;
 IF NOT EXISTS(SELECT 1 FROM public.speech_analyses WHERE job_id=r.attempt_id AND created_at>now()-interval '30 days') THEN
  RETURN jsonb_build_object('ok',false,'found',true,'code','RESULT_EXPIRED','digest',r.digest,'source_ref',r.source_ref,'accepts_no_speech',r.accepts_no_speech); END IF;
 value:=public.speech_analysis_get(p_auth_id,r.attempt_id);
 IF value->>'ok'='true' AND r.accepts_no_speech AND EXISTS(SELECT 1 FROM public.speech_analyses WHERE job_id=r.attempt_id AND status='completed_no_speech') THEN
  value:=(value-'analysis')||jsonb_build_object('status','completed','speech',false);
 END IF;
 RETURN value||jsonb_build_object('found',true,'digest',r.digest,'id',r.attempt_id,'kind',r.kind,'source_ref',r.source_ref,'accepts_no_speech',r.accepts_no_speech,'credits',CASE WHEN r.kind='new' THEN j.credits ELSE 0 END);
END $$;
REVOKE ALL ON FUNCTION public.speech_analysis_by_key(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.speech_analysis_by_key(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.speech_analysis_request_v2(p_auth_id text,p_asset_job_id uuid,p_duration numeric,p_key text,p_expected_credits integer,p_source_kind text,p_upload_key text,p_fingerprint text,p_size bigint,p_measured numeric,p_mime text,p_accepts_no_speech boolean,p_cache_only boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid; source jsonb; probe public.speech_source_probes%ROWTYPE; a public.speech_analyses%ROWTYPE;
 r public.speech_analysis_requests%ROWTYPE; model public.model_catalog%ROWTYPE; digest text; kind text; result jsonb; attempt uuid; today date := (clock_timestamp() AT TIME ZONE 'UTC')::date; quota public.speech_gate_daily%ROWTYPE;
BEGIN
 SELECT id INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 -- Per-user serialization also bounds concurrency across different source keys.
 PERFORM pg_advisory_xact_lock(hashtextextended('speech:'||u::text,0));
 -- Serialize the cross-feature key check with all ledger_debit callers as well.
 PERFORM 1 FROM public.credit_balances WHERE user_id=u FOR UPDATE;
 IF p_source_kind='upload' THEN
  IF p_upload_key IS NULL OR p_upload_key!~('^uploads/'||lower(p_auth_id)||'/[0-9a-f-]{36}\.(mp4|mov)$')
  OR p_fingerprint IS NULL OR p_fingerprint!~'^[0-9a-f]{64}$' OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 104857600
  OR p_mime IS NULL OR p_mime NOT IN ('video/mp4','video/quicktime') THEN RETURN jsonb_build_object('ok',false,'code','SOURCE_UNSUPPORTED'); END IF;
  source:=jsonb_build_object('ok',true,'sha256',p_fingerprint,'size_bytes',p_size);
  probe.source_fingerprint:=p_fingerprint; probe.duration:=p_measured;
  digest:=encode(pg_catalog.sha256(pg_catalog.convert_to('upload:'||p_fingerprint||':'||p_size::text||':1','UTF8')),'hex');
 ELSIF p_source_kind='job' THEN
  source:=public.speech_source(p_auth_id,p_asset_job_id);
  IF source->>'ok' IS DISTINCT FROM 'true' THEN RETURN source; END IF;
  digest:=encode(pg_catalog.sha256(pg_catalog.convert_to(p_asset_job_id::text||':'||(source->>'sha256')||':1','UTF8')),'hex');
 ELSE RETURN jsonb_build_object('ok',false,'code','SOURCE_UNSUPPORTED'); END IF;
 SELECT * INTO r FROM public.speech_analysis_requests WHERE user_id=u AND idempotency_key=p_key;
 IF r.attempt_id IS NOT NULL THEN
  IF r.digest<>digest OR r.accepts_no_speech IS DISTINCT FROM p_accepts_no_speech THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  RETURN public.speech_analysis_by_key(p_auth_id,p_key)||jsonb_build_object('replay',true);
 END IF;
 IF p_key IS NULL OR p_key!~'^[A-Za-z0-9._-]{8,128}$' OR EXISTS(SELECT 1 FROM public.jobs WHERE user_id=u AND idempotency_key=p_key) THEN
  RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
 -- Durable receipts above survive probe/analysis retention; only new keys require a probe.
 IF p_source_kind='job' THEN
 SELECT * INTO probe FROM public.speech_source_probes WHERE asset_id=(source->>'asset_id')::uuid AND source_fingerprint=source->>'sha256';
 IF probe.asset_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','SOURCE_UNSUPPORTED'); END IF;
 END IF;
 IF probe.duration IS NULL OR probe.duration='NaN'::numeric OR probe.duration<=0 THEN RETURN jsonb_build_object('ok',false,'code','SOURCE_UNSUPPORTED'); END IF;
 IF (source->>'size_bytes')::numeric IS NULL OR (source->>'size_bytes')::numeric NOT BETWEEN 1 AND 104857600
 OR (source->>'size_bytes')::numeric>probe.duration*2097152 THEN RETURN jsonb_build_object('ok',false,'code','SOURCE_UNSUPPORTED'); END IF;
 IF probe.duration>60 THEN RETURN jsonb_build_object('ok',false,'code','SOURCE_TOO_LONG'); END IF;
 IF probe.duration<0.5 OR p_duration IS NULL OR p_duration='NaN'::numeric OR abs(probe.duration-p_duration)>0.25 THEN
  RETURN jsonb_build_object('ok',false,'code','DURATION_MISMATCH'); END IF;
 -- The source lock prevents deletion between the probe check and admission.
 PERFORM 1 FROM public.assets WHERE id=probe.asset_id FOR KEY SHARE;
 SELECT s.* INTO a FROM public.speech_analyses s
 WHERE s.user_id=u AND s.source_kind=p_source_kind AND s.source_fingerprint=probe.source_fingerprint AND s.schema_version=1
 AND (CASE WHEN p_source_kind='upload' THEN s.source_size=p_size ELSE s.asset_job_id=p_asset_job_id END)
 AND s.status IN ('completed','completed_no_speech') AND s.created_at>now()-interval '30 days'
 ORDER BY s.created_at DESC LIMIT 1;
 kind:='reused_cache';
 IF a.id IS NULL THEN
  SELECT * INTO a FROM public.speech_analyses WHERE user_id=u AND source_kind=p_source_kind AND (CASE WHEN p_source_kind='upload' THEN source_size=p_size ELSE asset_job_id=p_asset_job_id END) AND source_fingerprint=probe.source_fingerprint
   AND schema_version=1 AND status='queued' AND created_at>now()-interval '15 minutes' ORDER BY created_at DESC LIMIT 1;
  kind:='joined_in_flight';
 END IF;
 IF p_expected_credits IS NULL OR p_expected_credits<0 OR (p_expected_credits=0 AND p_cache_only IS DISTINCT FROM true) THEN RETURN jsonb_build_object('ok',false,'code','PRICE_CHANGED'); END IF;
 IF a.id IS NOT NULL THEN attempt:=a.job_id;
 ELSE
  SELECT * INTO model FROM public.model_catalog WHERE id='elevenlabs-scribe-v2' AND active AND provider='fal' AND provider_endpoint='fal-ai/elevenlabs/speech-to-text/scribe-v2' FOR SHARE;
  IF model.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','SPEECH_CUT_UNAVAILABLE'); END IF;
  IF p_cache_only OR p_expected_credits IS DISTINCT FROM model.credits_5s THEN RETURN jsonb_build_object('ok',false,'code','PRICE_CHANGED','credits',model.credits_5s); END IF;
  IF (SELECT count(*) FROM public.speech_analyses WHERE user_id=u AND status='queued' AND created_at>now()-interval '15 minutes')>=3 THEN
   RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED'); END IF;
  INSERT INTO public.speech_gate_daily(user_id,day) VALUES(u,today) ON CONFLICT(user_id) DO NOTHING;
  SELECT * INTO quota FROM public.speech_gate_daily WHERE user_id=u FOR UPDATE;
  today:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
  IF quota.reserved+(CASE WHEN quota.day=today THEN quota.used ELSE 0 END)>=10 THEN RETURN jsonb_build_object('ok',false,'code','SPEECH_GATE_COOLDOWN'); END IF;
  result:=public.check_generation_rate_limit(p_auth_id,10,60);
  IF result->>'ok' IS DISTINCT FROM 'true' THEN RETURN result; END IF;
  result:=public.ledger_debit(u,p_key,model.credits_5s,'debit:speech_analysis',model.id,
   jsonb_build_object('kind','speech_analysis','asset_job_id',p_asset_job_id,'source_kind',p_source_kind,'source_fingerprint',probe.source_fingerprint,'schema_version',1));
  IF result->>'ok' IS DISTINCT FROM 'true' THEN RETURN result; END IF;
  attempt:=(result->>'job_id')::uuid;
  INSERT INTO public.speech_analyses(user_id,job_id,asset_job_id,asset_id,source_fingerprint,duration,source_kind,upload_key,source_size,gate_reserved)
   VALUES(u,attempt,p_asset_job_id,probe.asset_id,probe.source_fingerprint,probe.duration,p_source_kind,p_upload_key,(source->>'size_bytes')::bigint,true);
  UPDATE public.speech_gate_daily SET day=today,used=CASE WHEN day=today THEN used ELSE 0 END,reserved=reserved+1 WHERE user_id=u;
  kind:='new';
 END IF;
 INSERT INTO public.speech_analysis_requests(user_id,idempotency_key,digest,attempt_id,kind,accepts_no_speech,source_ref) VALUES(u,p_key,digest,attempt,kind,p_accepts_no_speech,CASE WHEN p_source_kind='upload' THEN p_upload_key ELSE p_asset_job_id::text END);
 RETURN public.speech_analysis_by_key(p_auth_id,p_key)||jsonb_build_object('kind',kind,'fresh',kind='new','credits',CASE WHEN kind='new' THEN model.credits_5s ELSE 0 END);
END $$;
REVOKE ALL ON FUNCTION public.speech_analysis_request_v2(text,uuid,numeric,text,integer,text,text,text,bigint,numeric,text,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.speech_analysis_request_v2(text,uuid,numeric,text,integer,text,text,text,bigint,numeric,text,boolean,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.speech_analysis_request(p_auth_id text,p_asset_job_id uuid,p_duration numeric,p_key text,p_expected_credits integer)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.speech_analysis_request_v2(p_auth_id,p_asset_job_id,p_duration,p_key,p_expected_credits,'job',NULL,NULL,NULL,NULL,NULL,false,false);
$$;
REVOKE ALL ON FUNCTION public.speech_analysis_request(text,uuid,numeric,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.speech_analysis_request(text,uuid,numeric,text,integer) TO service_role;


CREATE OR REPLACE FUNCTION public.speech_analysis_fail(p_job_id uuid,p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.jobs%ROWTYPE; r jsonb;
BEGIN
 SELECT * INTO j FROM public.jobs WHERE id=p_job_id FOR UPDATE;
 IF j.id IS NULL OR j.inputs->>'kind' IS DISTINCT FROM 'speech_analysis' THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF j.state='STORED' THEN RETURN jsonb_build_object('ok',true,'refunded',false); END IF;
 IF j.state='REFUNDED' AND NOT EXISTS(SELECT 1 FROM public.speech_analyses WHERE job_id=j.id AND status='queued') THEN
  RETURN jsonb_build_object('ok',true,'refunded',true); END IF;
 IF j.state<>'REFUNDED' THEN
  UPDATE public.jobs SET state='FAILED',error_code=CASE WHEN p_code~'^[a-z_]{1,64}$' THEN p_code ELSE 'analysis_failed' END,updated_at=now() WHERE id=j.id;
  r:=public.ledger_refund(j.id,j.user_id,j.credits,'refund:speech_analysis');
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Speech refund unavailable'; END IF;
 END IF;
 PERFORM private.speech_gate_settle(j.id,p_code='analysis_no_speech');
 UPDATE public.speech_analyses SET status=CASE WHEN p_code='analysis_no_speech' THEN 'completed_no_speech' ELSE 'failed' END,analysis=NULL,updated_at=now() WHERE job_id=j.id;
 RETURN jsonb_build_object('ok',true,'refunded',true);
END $$;
REVOKE ALL ON FUNCTION public.speech_analysis_fail(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.speech_analysis_fail(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.speech_analysis_complete(p_job_id uuid,p_analysis jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.jobs%ROWTYPE; a public.speech_analyses%ROWTYPE; auth text; source jsonb; chunk jsonb;
BEGIN
 SELECT * INTO j FROM public.jobs WHERE id=p_job_id FOR UPDATE;
 IF j.id IS NULL OR j.inputs->>'kind' IS DISTINCT FROM 'speech_analysis' THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF j.state IN ('REFUNDED','FAILED','STORED') THEN RETURN jsonb_build_object('ok',true,'ignored',true); END IF;
 SELECT * INTO a FROM public.speech_analyses WHERE job_id=j.id FOR UPDATE;
 SELECT auth_id INTO auth FROM public.users WHERE id=j.user_id AND deleted_at IS NULL;
 source:=CASE WHEN a.source_kind='upload' AND auth IS NOT NULL THEN jsonb_build_object('ok',true,'sha256',a.source_fingerprint) ELSE public.speech_source(auth,a.asset_job_id) END;
 IF a.id IS NULL OR a.created_at<=now()-interval '30 days' OR source->>'ok' IS DISTINCT FROM 'true' OR source->>'sha256' IS DISTINCT FROM a.source_fingerprint THEN
  RETURN public.speech_analysis_fail(j.id,'source_removed'); END IF;
 IF j.state<>'SUBMITTED' THEN RETURN jsonb_build_object('ok',false,'code','BAD_STATE'); END IF;
 IF jsonb_typeof(p_analysis) IS DISTINCT FROM 'object' OR p_analysis->>'version' IS DISTINCT FROM '1'
 OR p_analysis->>'assetId' IS DISTINCT FROM COALESCE(a.asset_job_id::text,a.source_fingerprint) OR jsonb_typeof(p_analysis->'chunks') IS DISTINCT FROM 'array'
 OR octet_length(p_analysis::text)>1048576 THEN RETURN public.speech_analysis_fail(j.id,'analysis_invalid'); END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_analysis) k WHERE k NOT IN ('version','assetId','duration','provider','transcript','language','chunks'))
 OR p_analysis->>'provider' IS NULL OR p_analysis->>'provider' NOT IN ('fal-scribe-v2','fal-wizper')
 OR p_analysis->>'language' IS NULL OR p_analysis->>'language' NOT IN ('en','es','zh','hi','ar','fr','pt','ru','ja','de','ko','und')
 OR jsonb_typeof(p_analysis->'duration') IS DISTINCT FROM 'number'
 OR jsonb_typeof(p_analysis->'transcript') IS DISTINCT FROM 'string' THEN RETURN public.speech_analysis_fail(j.id,'analysis_invalid'); END IF;
 IF abs((p_analysis->>'duration')::numeric-a.duration)>0.1 OR length(p_analysis->>'transcript')>100000
 OR jsonb_array_length(p_analysis->'chunks') NOT BETWEEN 1 AND 10000 THEN RETURN public.speech_analysis_fail(j.id,'analysis_invalid'); END IF;
 FOR chunk IN SELECT value FROM jsonb_array_elements(p_analysis->'chunks') LOOP
  IF jsonb_typeof(chunk) IS DISTINCT FROM 'object' THEN RETURN public.speech_analysis_fail(j.id,'analysis_invalid'); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(chunk) k WHERE k NOT IN ('start','end','text'))
  OR jsonb_typeof(chunk->'start') IS DISTINCT FROM 'number' OR jsonb_typeof(chunk->'end') IS DISTINCT FROM 'number'
  OR jsonb_typeof(chunk->'text') IS DISTINCT FROM 'string' THEN RETURN public.speech_analysis_fail(j.id,'analysis_invalid'); END IF;
  IF (chunk->>'start')::numeric<0 OR (chunk->>'end')::numeric<=(chunk->>'start')::numeric OR (chunk->>'end')::numeric>a.duration+0.05
  OR length(btrim(chunk->>'text')) NOT BETWEEN 1 AND 1000 THEN RETURN public.speech_analysis_fail(j.id,'analysis_invalid'); END IF;
 END LOOP;
 PERFORM private.speech_gate_settle(j.id,false);
 UPDATE public.speech_analyses SET status='completed',analysis=p_analysis,language=p_analysis->>'language',updated_at=now() WHERE id=a.id;
 UPDATE public.jobs SET state='STORED',error_code=NULL,updated_at=now() WHERE id=j.id;
 IF a.source_kind='job' THEN
 INSERT INTO public.speech_analysis_cache(user_id,asset_job_id,source_fingerprint,schema_version,analysis_id,expires_at)
 VALUES(a.user_id,a.asset_job_id,a.source_fingerprint,a.schema_version,a.id,a.created_at+interval '30 days')
 ON CONFLICT(user_id,asset_job_id,source_fingerprint,schema_version) DO UPDATE SET analysis_id=EXCLUDED.analysis_id,expires_at=EXCLUDED.expires_at;
 END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.speech_analysis_complete(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.speech_analysis_complete(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.speech_analysis_callback(p_job_id uuid,p_provider_request_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.jobs%ROWTYPE; a public.speech_analyses%ROWTYPE; r jsonb;
BEGIN
 SELECT * INTO j FROM public.jobs WHERE id=p_job_id FOR UPDATE;
 IF j.id IS NULL OR j.inputs->>'kind' IS DISTINCT FROM 'speech_analysis' THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF p_provider_request_id!~'^[A-Za-z0-9._-]{1,128}$' OR p_provider_request_id IS NULL
 OR (j.provider_job_id IS NOT NULL AND j.provider_job_id<>p_provider_request_id) THEN RETURN jsonb_build_object('ok',false,'code','CONFLICT'); END IF;
 IF j.state IN ('FAILED','REFUNDED','STORED') THEN RETURN jsonb_build_object('ok',true,'closed',true); END IF;
 SELECT * INTO a FROM public.speech_analyses WHERE job_id=j.id;
 IF a.id IS NULL THEN PERFORM public.speech_analysis_fail(j.id,'source_removed'); RETURN jsonb_build_object('ok',true,'closed',true); END IF;
 IF j.state='DEBITED' THEN
  r:=public.job_submitted(j.id,'fal',p_provider_request_id);
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RETURN r; END IF;
 END IF;
 RETURN jsonb_build_object('ok',true,'assetId',COALESCE(a.asset_job_id::text,a.source_fingerprint),'duration',a.duration);
END $$;
REVOKE ALL ON FUNCTION public.speech_analysis_callback(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.speech_analysis_callback(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION private.speech_user_erased()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record;
BEGIN
 IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
  FOR a IN SELECT job_id FROM public.speech_analyses WHERE user_id=NEW.id AND status='queued' LOOP
   PERFORM public.speech_analysis_fail(a.job_id,'account_erased');
  END LOOP;
  DELETE FROM public.speech_analyses WHERE user_id=NEW.id;
  DELETE FROM public.speech_source_probes WHERE user_id=NEW.id;
  DELETE FROM public.speech_gate_daily WHERE user_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.speech_user_erased() FROM PUBLIC,anon,authenticated,service_role;


-- This RPC receives verified metadata from the server only and never creates a receipt/debit.
CREATE OR REPLACE FUNCTION public.speech_analysis_preflight(p_auth_id text,p_source_kind text,p_asset_job_id uuid,p_fingerprint text,p_size bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid; hit boolean; price integer; source jsonb;
BEGIN
 SELECT id INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF p_source_kind='job' THEN
  source:=public.speech_source(p_auth_id,p_asset_job_id);
  IF source->>'ok' IS DISTINCT FROM 'true' THEN RETURN source; END IF;
  p_fingerprint:=source->>'sha256';
 END IF;
 SELECT credits_5s INTO price FROM public.model_catalog WHERE id='elevenlabs-scribe-v2' AND active AND provider='fal' AND provider_endpoint='fal-ai/elevenlabs/speech-to-text/scribe-v2';
 IF price IS NULL THEN RETURN jsonb_build_object('ok',false,'code','SPEECH_CUT_UNAVAILABLE'); END IF;
 SELECT EXISTS(SELECT 1 FROM public.speech_analyses WHERE user_id=u AND source_kind=p_source_kind AND source_fingerprint=p_fingerprint
 AND (CASE WHEN p_source_kind='upload' THEN source_size=p_size ELSE asset_job_id=p_asset_job_id END)
 AND schema_version=1 AND status IN ('completed','completed_no_speech') AND created_at>now()-interval '30 days') INTO hit;
 RETURN jsonb_build_object('ok',true,'cached',hit,'credits',CASE WHEN hit THEN 0 ELSE price END);
END $$;
REVOKE ALL ON FUNCTION public.speech_analysis_preflight(text,text,uuid,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.speech_analysis_preflight(text,text,uuid,text,bigint) TO service_role;


-- QuickTime uses the same quotas and create-only grant as MP4.
-- One account may hold up to 20 stored/reserved uploads at once (was 10). The 200 MiB total and the
-- 100 MiB per-file limits stay, so this raises the file count, not the storage an account can use.
-- Both functions keep their 0129 / 0401 bodies except for the count (10 -> 20), which is also the
-- longest p_stored list the Worker may send (its LIST is MAX_PENDING_UPLOADS + 1 keys).
-- A new argument list or body means explicit privileges: revoke from the browser roles, grant service_role.
CREATE OR REPLACE FUNCTION public.reserve_upload(p_auth_id TEXT, p_key TEXT, p_size BIGINT, p_stored JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID;
    v_count BIGINT;
    v_bytes BIGINT;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR p_size IS NULL OR p_size < 1 OR p_size > 104857600
       OR p_stored IS NULL OR jsonb_typeof(p_stored) <> 'array' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
    END IF;
    IF jsonb_array_length(p_stored) > 21 OR p_key IS NULL
       OR p_key !~ ('^uploads/' || lower(p_auth_id) || '/[0-9a-f-]{36}\.(jpg|png|webp|mp4|mov|mp3|wav)$') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
    END IF;
    -- Same account lock serializes the count, bytes and insertion across Workers.
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id FOR UPDATE;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    IF EXISTS (SELECT 1 FROM public.upload_reservations WHERE r2_key = p_key) THEN
        -- Do not renew an old URL's expiry by signing an existing reservation.
        RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_RESERVED');
    END IF;
    SELECT count(*), COALESCE(sum(size_bytes), 0) INTO v_count, v_bytes
      FROM public.upload_reservations WHERE user_id = v_user;
    -- Legacy objects have no reservation. Include them without counting new
    -- objects twice. p_stored comes from the Worker's authenticated R2 LIST.
    SELECT v_count + count(*), v_bytes + COALESCE(sum(GREATEST(0, (o->>'size')::BIGINT)), 0)
      INTO v_count, v_bytes FROM jsonb_array_elements(p_stored) o
      WHERE NOT EXISTS (SELECT 1 FROM public.upload_reservations r WHERE r.r2_key = o->>'key' AND r.user_id = v_user);
    IF v_count >= 20 OR v_bytes + p_size > 209715200 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'UPLOAD_BUDGET_EXCEEDED');
    END IF;
    INSERT INTO public.upload_reservations(r2_key, user_id, size_bytes) VALUES(p_key, v_user, p_size);
    RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.reserve_upload(TEXT, TEXT, BIGINT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_upload(TEXT, TEXT, BIGINT, JSONB) TO service_role;

-- Keep telemetry normalization aligned with the Best Cut preflight route (ADR-0334).
CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT p_path = ANY (ARRAY['/','/.well-known/apple-app-site-association','/.well-known/assetlinks.json','/.well-known/oauth-protected-resource/api/v1/developer','/.well-known/oauth-protected-resource/api/v1/mcp','/about','/api/admin/reap-assets','/api/admin/top-up-backfill','/api/auth/session','/api/catalog','/api/cinema-pass-plans','/api/cinema/comments','/api/cinema/discovery','/api/cinema/posters/:id','/api/cinema/story-polls','/api/cinema/titles','/api/cinema/titles/:id','/api/cinema/voting','/api/cinema/winners','/api/credit-packs','/api/credit-subscription-plans','/api/developer/openapi','/api/popular-templates','/api/presets','/api/publish/v1/accounts','/api/publish/v1/posts','/api/social/approvals/:id','/api/social/team/:id','/api/status','/api/templates','/api/templates/:id','/api/turnstile-failure','/api/v1/account','/api/v1/account/age-confirmation','/api/v1/account/deletion','/api/v1/account/export','/api/v1/account/export/:id','/api/v1/account/language','/api/v1/admin/affiliates','/api/v1/admin/appeals','/api/v1/admin/changes','/api/v1/admin/cinema/comments','/api/v1/admin/cinema/creators','/api/v1/admin/cinema/earnings','/api/v1/admin/cinema/pass/refund','/api/v1/admin/cinema/rankings','/api/v1/admin/cinema/story-polls','/api/v1/admin/cinema/submissions','/api/v1/admin/cinema/suspend','/api/v1/admin/cinema/unlocks/reverse','/api/v1/admin/cinema/voting','/api/v1/admin/endpoints','/api/v1/admin/metrics','/api/v1/admin/permissions','/api/v1/admin/plans','/api/v1/admin/reports','/api/v1/admin/reports/asset','/api/v1/admin/revenue','/api/v1/admin/roles','/api/v1/admin/security','/api/v1/admin/support','/api/v1/admin/switches','/api/v1/admin/traffic','/api/v1/admin/users/ai-control','/api/v1/admin/users/ledger','/api/v1/admin/users/lookup','/api/v1/admin/violations','/api/v1/admin/webhooks','/api/v1/appeals','/api/v1/balance','/api/v1/chat/folders','/api/v1/chat/folders/:id','/api/v1/chat/models','/api/v1/chat/personas','/api/v1/chat/personas/:id','/api/v1/chat/sends/close','/api/v1/chat/threads','/api/v1/chat/threads/:id','/api/v1/chat/threads/:id/messages','/api/v1/checkin','/api/v1/cinema/audience','/api/v1/cinema/blocks','/api/v1/cinema/blocks/:id','/api/v1/cinema/comments','/api/v1/cinema/content','/api/v1/cinema/content/submit','/api/v1/cinema/content/withdraw','/api/v1/cinema/creator-analytics','/api/v1/cinema/entitlement','/api/v1/cinema/pass','/api/v1/cinema/pass/cancel','/api/v1/cinema/pass/plans','/api/v1/cinema/pass/portal','/api/v1/cinema/pass/return','/api/v1/cinema/play','/api/v1/cinema/play/heartbeat','/api/v1/cinema/posters/:id','/api/v1/cinema/progress','/api/v1/cinema/retention','/api/v1/cinema/story-choices','/api/v1/cinema/story-polls','/api/v1/cinema/titles/:id','/api/v1/cinema/unlocks','/api/v1/cinema/uploads','/api/v1/cinema/uploads/:id/transfer','/api/v1/cinema/uploads/from-library','/api/v1/cinema/uploads/refresh','/api/v1/cinema/uploads/remove','/api/v1/cinema/votes','/api/v1/cinema/voting','/api/v1/creator-profile','/api/v1/creator-profile/skip','/api/v1/creators/apply','/api/v1/credit-packs','/api/v1/developer/:id*','/api/v1/devices','/api/v1/editor/ai-edit','/api/v1/editor/ai-edit/by-key/:id','/api/v1/editor/ai-edit/quote','/api/v1/editor/server-render','/api/v1/editor/server-render/quote','/api/v1/editor/speech-analyses','/api/v1/editor/speech-analyses/:id','/api/v1/editor/speech-analyses/by-key/:id','/api/v1/editor/speech-analyses/preflight','/api/v1/editor/speech-analyses/quote','/api/v1/film-studio','/api/v1/film-studio/:id','/api/v1/free-allowance','/api/v1/generations','/api/v1/health','/api/v1/help','/api/v1/jobs','/api/v1/jobs/:id','/api/v1/jobs/:id/asset','/api/v1/jobs/:id/cancel','/api/v1/jobs/:id/media-info','/api/v1/jobs/:id/provenance','/api/v1/ledger','/api/v1/ledger/usage','/api/v1/library/editor-renders','/api/v1/library/editor-renders/:id/asset','/api/v1/library/editor-renders/:id/inspect','/api/v1/library/masters','/api/v1/library/masters/:id/asset','/api/v1/library/masters/upload','/api/v1/mcp','/api/v1/mfa/recovery','/api/v1/mfa/recovery/codes','/api/v1/montage/plan','/api/v1/projects','/api/v1/projects/:id','/api/v1/projects/:id/assets','/api/v1/projects/:id/assets/:id/download','/api/v1/projects/:id/assets/:id/inspect','/api/v1/projects/:id/document','/api/v1/projects/:id/history','/api/v1/projects/:id/review','/api/v1/referrals','/api/v1/referrals/attach','/api/v1/reports','/api/v1/session/me','/api/v1/social-cinema/profile','/api/v1/social/access','/api/v1/social/accounts','/api/v1/social/accounts/:id','/api/v1/social/accounts/bluesky/connect','/api/v1/social/accounts/facebook/callback','/api/v1/social/accounts/facebook/connect','/api/v1/social/accounts/gmb/callback','/api/v1/social/accounts/gmb/connect','/api/v1/social/accounts/instagram/callback','/api/v1/social/accounts/instagram/connect','/api/v1/social/accounts/linkedin/callback','/api/v1/social/accounts/linkedin/connect','/api/v1/social/accounts/pinterest/callback','/api/v1/social/accounts/pinterest/connect','/api/v1/social/accounts/threads/callback','/api/v1/social/accounts/threads/connect','/api/v1/social/accounts/tiktok/callback','/api/v1/social/accounts/tiktok/connect','/api/v1/social/accounts/twitch/callback','/api/v1/social/accounts/twitch/connect','/api/v1/social/accounts/twitter/callback','/api/v1/social/accounts/twitter/connect','/api/v1/social/accounts/youtube/callback','/api/v1/social/accounts/youtube/connect','/api/v1/social/activity','/api/v1/social/ads','/api/v1/social/analytics','/api/v1/social/approvals','/api/v1/social/autolists','/api/v1/social/best-time','/api/v1/social/brand-kit','/api/v1/social/brands','/api/v1/social/calendar','/api/v1/social/commerce/products','/api/v1/social/contacts','/api/v1/social/developer/keys','/api/v1/social/developer/logs','/api/v1/social/developer/webhooks','/api/v1/social/drafts','/api/v1/social/inbox','/api/v1/social/inbox/:id','/api/v1/social/inbox/:id/reply','/api/v1/social/inbox/:id/suggestions','/api/v1/social/inbox/analytics','/api/v1/social/plan','/api/v1/social/plan/cancel','/api/v1/social/plan/portal','/api/v1/social/plan/return','/api/v1/social/posts','/api/v1/social/posts/:id','/api/v1/social/posts/:id/schedule','/api/v1/social/presets','/api/v1/social/queues','/api/v1/social/queues/reserve','/api/v1/social/reports','/api/v1/social/reports/:id/export','/api/v1/social/smartlink','/api/v1/social/team','/api/v1/social/team/accept','/api/v1/social/uploads','/api/v1/social/workflows','/api/v1/store-purchases/customer','/api/v1/subscriptions','/api/v1/subscriptions/cancel','/api/v1/subscriptions/checkout','/api/v1/subscriptions/plans','/api/v1/subscriptions/return','/api/v1/support/tickets','/api/v1/top-ups','/api/v1/top-ups/:id','/api/v1/top-ups/:id/return','/api/v1/uploads','/api/v1/voice-profiles','/api/v1/voice-profiles/:id','/api/v1/voice-profiles/:id/captcha','/api/v1/voice-profiles/:id/samples','/api/v1/voice-profiles/:id/speech','/api/v1/wins','/api/v1/workspaces','/api/v1/workspaces/:id/brand-assets','/api/v1/workspaces/:id/brand-kit','/api/webhook/cinema-stream','/api/webhook/editor-render','/api/webhook/fal','/api/webhook/kie','/api/webhook/montage','/api/webhook/openrouter','/api/webhook/revenuecat','/api/webhook/social/meta','/api/webhook/stripe','/app','/app/account','/app/account/appeals','/app/account/report','/app/account/wins','/app/admin','/app/admin/affiliates','/app/admin/appeals','/app/admin/changes','/app/admin/cinema','/app/admin/cinema/comments','/app/admin/cinema/rankings','/app/admin/cinema/story-polls','/app/admin/cinema/submissions','/app/admin/cinema/voting','/app/admin/endpoints','/app/admin/payments','/app/admin/plans','/app/admin/reports','/app/admin/roles','/app/admin/security','/app/admin/support','/app/admin/switches','/app/admin/traffic','/app/admin/users','/app/admin/violations','/app/admin/webhooks','/app/chat','/app/create','/app/credits','/app/dialogue','/app/editor','/app/editor/review','/app/enhance','/app/faceless-reel','/app/features','/app/features/:id','/app/film-studio','/app/library','/app/lip-sync','/app/oddlings','/app/performance','/app/projects','/app/projects/:id','/app/publish','/app/publish/activity','/app/publish/ads','/app/publish/analytics','/app/publish/autolists','/app/publish/calendar','/app/publish/commerce','/app/publish/contacts','/app/publish/developer','/app/publish/inbox','/app/publish/plan','/app/publish/queues','/app/publish/reports','/app/publish/smartlink','/app/publish/team','/app/publish/workflows','/app/skills','/app/text-to-speech','/app/vibe','/app/video-agent','/auth/callback','/auth/mobile','/auth/mobile/start','/compare/:id','/design-system','/developers','/guides','/guides/:id','/legal/aup','/legal/cinema-content','/legal/gdpr','/legal/privacy','/legal/refund','/legal/terms','/m','/m/create','/m/credits','/m/explore','/m/job','/m/library','/mcp','/media/social/:id','/models','/models/:id','/oauth/consent','/oddlings','/oddlings/:id','/presets','/presets/:id','/pricing','/publish','/s/:id','/s/:id/go/:id','/social-cinema','/social-cinema/creator','/social-cinema/pass','/social-cinema/series/:id','/social-cinema/title/:id','/social-cinema/watch/:id','/social/connect/callback/:id','/social/connect/mobile/:id','/social/review/:id','/social/team/invite/:id','/tools','other']::text[])
$$;
REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT) FROM PUBLIC,anon,authenticated,service_role;
