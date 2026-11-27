-- 0616_speech_requested_language.sql
-- Provider-language override for Best Cut. Additive and backwards compatible:
-- legacy RPCs and rows remain automatic, while versioned RPCs scope cache,
-- in-flight joins and idempotency to an explicit requested language.

-- Best Cut accepts one talking-head source up to the editor's ten-minute
-- ceiling. Final admission re-probes the owned bytes and bills each started
-- 60-second block, so a forged client duration cannot underquote the provider.
ALTER TABLE public.speech_analyses DROP CONSTRAINT IF EXISTS speech_analyses_duration_check;
ALTER TABLE public.speech_analyses ADD CONSTRAINT speech_analyses_duration_check CHECK(duration BETWEEN 0.5 AND 600);

-- A dedicated, durable first-edit waiver. It cannot be spent by another
-- Veyrnox feature and is released again when the attempt is refunded.
CREATE TABLE IF NOT EXISTS public.smart_cut_first_edits (
 user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
 claimed_job_id uuid UNIQUE REFERENCES public.jobs(id) ON DELETE CASCADE,
 claimed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.smart_cut_first_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_cut_first_edits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.smart_cut_first_edits FROM PUBLIC,anon,authenticated,service_role;

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
  'analysis',CASE WHEN a.status='completed' THEN a.analysis ELSE NULL END,
  'requested_language',COALESCE(j.inputs->>'requested_language','auto'));
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
  RETURN jsonb_build_object('ok',false,'found',true,'code','RESULT_EXPIRED','digest',r.digest,'source_ref',r.source_ref,'accepts_no_speech',r.accepts_no_speech,
   'requested_language',COALESCE(j.inputs->>'requested_language','auto')); END IF;
 value:=public.speech_analysis_get(p_auth_id,r.attempt_id);
 IF value->>'ok'='true' AND r.accepts_no_speech AND EXISTS(SELECT 1 FROM public.speech_analyses WHERE job_id=r.attempt_id AND status='completed_no_speech') THEN
  value:=(value-'analysis')||jsonb_build_object('status','completed','speech',false);
 END IF;
 RETURN value||jsonb_build_object('found',true,'digest',r.digest,'id',r.attempt_id,'kind',r.kind,'source_ref',r.source_ref,'accepts_no_speech',r.accepts_no_speech,
  'credits',CASE WHEN r.kind='new' THEN j.credits ELSE 0 END,'requested_language',COALESCE(j.inputs->>'requested_language','auto'));
END $$;
REVOKE ALL ON FUNCTION public.speech_analysis_by_key(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.speech_analysis_by_key(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.speech_analysis_preflight_v2(p_auth_id text,p_source_kind text,p_asset_job_id uuid,p_fingerprint text,p_size bigint,p_requested_language text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid; hit boolean; price integer; source jsonb; first_free boolean;
BEGIN
 SELECT id INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF p_requested_language IS NULL OR p_requested_language NOT IN ('auto','en','es','zh','hi','ar','fr','pt','ru','ja','de','ko') THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_LANGUAGE'); END IF;
 IF p_source_kind='job' THEN
  source:=public.speech_source(p_auth_id,p_asset_job_id);
  IF source->>'ok' IS DISTINCT FROM 'true' THEN RETURN source; END IF;
  p_fingerprint:=source->>'sha256';
 END IF;
 SELECT credits_5s INTO price FROM public.model_catalog WHERE id='elevenlabs-scribe-v2' AND active AND provider='fal' AND provider_endpoint='fal-ai/elevenlabs/speech-to-text/scribe-v2';
 IF price IS NULL THEN RETURN jsonb_build_object('ok',false,'code','SPEECH_CUT_UNAVAILABLE'); END IF;
 SELECT EXISTS(SELECT 1 FROM public.speech_analyses s JOIN public.jobs j ON j.id=s.job_id
 WHERE s.user_id=u AND s.source_kind=p_source_kind AND s.source_fingerprint=p_fingerprint
 AND (CASE WHEN p_source_kind='upload' THEN s.source_size=p_size ELSE s.asset_job_id=p_asset_job_id END)
 AND s.schema_version=1 AND s.status IN ('completed','completed_no_speech') AND s.created_at>now()-interval '30 days'
 AND COALESCE(j.inputs->>'requested_language','auto')=p_requested_language) INTO hit;
 SELECT NOT EXISTS(SELECT 1 FROM public.smart_cut_first_edits WHERE user_id=u) INTO first_free;
 RETURN jsonb_build_object('ok',true,'cached',hit,'first_free',NOT hit AND first_free,
  'credits',CASE WHEN hit THEN 0 ELSE price END);
END $$;
REVOKE ALL ON FUNCTION public.speech_analysis_preflight_v2(text,text,uuid,text,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.speech_analysis_preflight_v2(text,text,uuid,text,bigint,text) TO service_role;

CREATE OR REPLACE FUNCTION public.speech_analysis_request_v3(p_auth_id text,p_asset_job_id uuid,p_duration numeric,p_key text,p_expected_credits integer,p_source_kind text,p_upload_key text,p_fingerprint text,p_size bigint,p_measured numeric,p_mime text,p_accepts_no_speech boolean,p_cache_only boolean,p_requested_language text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid; source jsonb; probe public.speech_source_probes%ROWTYPE; a public.speech_analyses%ROWTYPE;
 r public.speech_analysis_requests%ROWTYPE; model public.model_catalog%ROWTYPE; digest text; digest_source text; kind text; result jsonb; attempt uuid; charge integer; first_free boolean; job_inputs jsonb; today date := (clock_timestamp() AT TIME ZONE 'UTC')::date; quota public.speech_gate_daily%ROWTYPE;
BEGIN
 SELECT id INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF p_requested_language IS NULL OR p_requested_language NOT IN ('auto','en','es','zh','hi','ar','fr','pt','ru','ja','de','ko') THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_LANGUAGE'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('speech:'||u::text,0));
 PERFORM 1 FROM public.credit_balances WHERE user_id=u FOR UPDATE;
 IF p_source_kind='upload' THEN
  IF p_upload_key IS NULL OR p_upload_key!~('^uploads/'||lower(p_auth_id)||'/[0-9a-f-]{36}\.(mp4|mov)$')
  OR p_fingerprint IS NULL OR p_fingerprint!~'^[0-9a-f]{64}$' OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 104857600
  OR p_mime IS NULL OR p_mime NOT IN ('video/mp4','video/quicktime') THEN RETURN jsonb_build_object('ok',false,'code','SOURCE_UNSUPPORTED'); END IF;
  source:=jsonb_build_object('ok',true,'sha256',p_fingerprint,'size_bytes',p_size);
  probe.source_fingerprint:=p_fingerprint; probe.duration:=p_measured;
  digest_source:='upload:'||p_fingerprint||':'||p_size::text||':1';
 ELSIF p_source_kind='job' THEN
  source:=public.speech_source(p_auth_id,p_asset_job_id);
  IF source->>'ok' IS DISTINCT FROM 'true' THEN RETURN source; END IF;
  digest_source:=p_asset_job_id::text||':'||(source->>'sha256')||':1';
 ELSE RETURN jsonb_build_object('ok',false,'code','SOURCE_UNSUPPORTED'); END IF;
 IF p_requested_language<>'auto' THEN digest_source:=digest_source||':language='||p_requested_language; END IF;
 digest:=encode(pg_catalog.sha256(pg_catalog.convert_to(digest_source,'UTF8')),'hex');
 SELECT * INTO r FROM public.speech_analysis_requests WHERE user_id=u AND idempotency_key=p_key;
 IF r.attempt_id IS NOT NULL THEN
  IF r.digest<>digest OR r.accepts_no_speech IS DISTINCT FROM p_accepts_no_speech THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  RETURN public.speech_analysis_by_key(p_auth_id,p_key)||jsonb_build_object('replay',true);
 END IF;
 IF p_key IS NULL OR p_key!~'^[A-Za-z0-9._-]{8,128}$' OR EXISTS(SELECT 1 FROM public.jobs WHERE user_id=u AND idempotency_key=p_key) THEN
  RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
 IF p_source_kind='job' THEN
 SELECT * INTO probe FROM public.speech_source_probes WHERE asset_id=(source->>'asset_id')::uuid AND source_fingerprint=source->>'sha256';
 IF probe.asset_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','SOURCE_UNSUPPORTED'); END IF;
 END IF;
 IF probe.duration IS NULL OR probe.duration='NaN'::numeric OR probe.duration<=0 THEN RETURN jsonb_build_object('ok',false,'code','SOURCE_UNSUPPORTED'); END IF;
 IF (source->>'size_bytes')::numeric IS NULL OR (source->>'size_bytes')::numeric NOT BETWEEN 1 AND 104857600
 OR (source->>'size_bytes')::numeric>probe.duration*2097152 THEN RETURN jsonb_build_object('ok',false,'code','SOURCE_UNSUPPORTED'); END IF;
 IF probe.duration>600 THEN RETURN jsonb_build_object('ok',false,'code','SOURCE_TOO_LONG'); END IF;
 IF probe.duration<0.5 OR p_duration IS NULL OR p_duration='NaN'::numeric OR abs(probe.duration-p_duration)>0.25 THEN
  RETURN jsonb_build_object('ok',false,'code','DURATION_MISMATCH'); END IF;
 PERFORM 1 FROM public.assets WHERE id=probe.asset_id FOR KEY SHARE;
 SELECT s.* INTO a FROM public.speech_analyses s JOIN public.jobs j ON j.id=s.job_id
 WHERE s.user_id=u AND s.source_kind=p_source_kind AND s.source_fingerprint=probe.source_fingerprint AND s.schema_version=1
 AND (CASE WHEN p_source_kind='upload' THEN s.source_size=p_size ELSE s.asset_job_id=p_asset_job_id END)
 AND s.status IN ('completed','completed_no_speech') AND s.created_at>now()-interval '30 days'
 AND COALESCE(j.inputs->>'requested_language','auto')=p_requested_language
 ORDER BY s.created_at DESC LIMIT 1;
 kind:='reused_cache';
 IF a.id IS NULL THEN
  SELECT s.* INTO a FROM public.speech_analyses s JOIN public.jobs j ON j.id=s.job_id
  WHERE s.user_id=u AND s.source_kind=p_source_kind AND (CASE WHEN p_source_kind='upload' THEN s.source_size=p_size ELSE s.asset_job_id=p_asset_job_id END)
   AND s.source_fingerprint=probe.source_fingerprint AND s.schema_version=1 AND s.status='queued' AND s.created_at>now()-interval '15 minutes'
   AND COALESCE(j.inputs->>'requested_language','auto')=p_requested_language ORDER BY s.created_at DESC LIMIT 1;
  kind:='joined_in_flight';
 END IF;
 IF p_expected_credits IS NULL OR p_expected_credits<0 THEN RETURN jsonb_build_object('ok',false,'code','PRICE_CHANGED'); END IF;
 IF a.id IS NOT NULL THEN attempt:=a.job_id;
 ELSE
  SELECT * INTO model FROM public.model_catalog WHERE id='elevenlabs-scribe-v2' AND active AND provider='fal' AND provider_endpoint='fal-ai/elevenlabs/speech-to-text/scribe-v2' FOR SHARE;
  IF model.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','SPEECH_CUT_UNAVAILABLE'); END IF;
  charge:=model.credits_5s*ceil(probe.duration/60.0)::integer;
  SELECT p_accepts_no_speech AND NOT EXISTS(SELECT 1 FROM public.smart_cut_first_edits WHERE user_id=u) INTO first_free;
  IF p_cache_only OR (p_expected_credits=0 AND NOT first_free) OR (p_expected_credits<>0 AND p_expected_credits IS DISTINCT FROM charge) THEN
   RETURN jsonb_build_object('ok',false,'code','PRICE_CHANGED','credits',CASE WHEN first_free THEN 0 ELSE charge END,'first_free',first_free); END IF;
  IF (SELECT count(*) FROM public.speech_analyses WHERE user_id=u AND status='queued' AND created_at>now()-interval '15 minutes')>=3 THEN
   RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED'); END IF;
  INSERT INTO public.speech_gate_daily(user_id,day) VALUES(u,today) ON CONFLICT(user_id) DO NOTHING;
  SELECT * INTO quota FROM public.speech_gate_daily WHERE user_id=u FOR UPDATE;
  today:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
  IF quota.reserved+(CASE WHEN quota.day=today THEN quota.used ELSE 0 END)>=10 THEN RETURN jsonb_build_object('ok',false,'code','SPEECH_GATE_COOLDOWN'); END IF;
  result:=public.check_generation_rate_limit(p_auth_id,10,60);
  IF result->>'ok' IS DISTINCT FROM 'true' THEN RETURN result; END IF;
  job_inputs:=jsonb_build_object('kind','speech_analysis','asset_job_id',p_asset_job_id,'source_kind',p_source_kind,'source_fingerprint',probe.source_fingerprint,'schema_version',1)
   ||CASE WHEN p_requested_language='auto' THEN '{}'::jsonb ELSE jsonb_build_object('requested_language',p_requested_language) END;
  IF first_free AND p_expected_credits=0 THEN
   INSERT INTO public.jobs(user_id,idempotency_key,model_id,credits,inputs,state)
    VALUES(u,p_key,model.id,0,job_inputs,'DEBITED') RETURNING id INTO attempt;
   INSERT INTO public.smart_cut_first_edits(user_id,claimed_job_id) VALUES(u,attempt);
   charge:=0;
  ELSE
   result:=public.ledger_debit(u,p_key,charge,'debit:speech_analysis',model.id,job_inputs);
   IF result->>'ok' IS DISTINCT FROM 'true' THEN RETURN result; END IF;
   attempt:=(result->>'job_id')::uuid;
  END IF;
  INSERT INTO public.speech_analyses(user_id,job_id,asset_job_id,asset_id,source_fingerprint,duration,source_kind,upload_key,source_size,gate_reserved)
   VALUES(u,attempt,p_asset_job_id,probe.asset_id,probe.source_fingerprint,probe.duration,p_source_kind,p_upload_key,(source->>'size_bytes')::bigint,true);
  UPDATE public.speech_gate_daily SET day=today,used=CASE WHEN day=today THEN used ELSE 0 END,reserved=reserved+1 WHERE user_id=u;
  kind:='new';
 END IF;
 INSERT INTO public.speech_analysis_requests(user_id,idempotency_key,digest,attempt_id,kind,accepts_no_speech,source_ref)
  VALUES(u,p_key,digest,attempt,kind,p_accepts_no_speech,CASE WHEN p_source_kind='upload' THEN p_upload_key ELSE p_asset_job_id::text END);
 RETURN public.speech_analysis_by_key(p_auth_id,p_key)||jsonb_build_object('kind',kind,'fresh',kind='new','credits',CASE WHEN kind='new' THEN charge ELSE 0 END,'requested_language',p_requested_language);
END $$;
REVOKE ALL ON FUNCTION public.speech_analysis_request_v3(text,uuid,numeric,text,integer,text,text,text,bigint,numeric,text,boolean,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.speech_analysis_request_v3(text,uuid,numeric,text,integer,text,text,text,bigint,numeric,text,boolean,boolean,text) TO service_role;

-- The ordinary refund RPC requires a positive debit. A waived first attempt
-- has no ledger entry, so release its dedicated claim and settle it directly.
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
  IF j.credits=0 AND EXISTS(SELECT 1 FROM public.smart_cut_first_edits WHERE claimed_job_id=j.id) THEN
   UPDATE public.jobs SET state='REFUNDED',error_code=CASE WHEN p_code~'^[a-z_]{1,64}$' THEN p_code ELSE 'analysis_failed' END,updated_at=now() WHERE id=j.id;
   DELETE FROM public.smart_cut_first_edits WHERE claimed_job_id=j.id;
  ELSE
   UPDATE public.jobs SET state='FAILED',error_code=CASE WHEN p_code~'^[a-z_]{1,64}$' THEN p_code ELSE 'analysis_failed' END,updated_at=now() WHERE id=j.id;
   r:=public.ledger_refund(j.id,j.user_id,j.credits,'refund:speech_analysis');
   IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Speech refund unavailable'; END IF;
  END IF;
 END IF;
 PERFORM private.speech_gate_settle(j.id,p_code='analysis_no_speech');
 UPDATE public.speech_analyses SET status=CASE WHEN p_code='analysis_no_speech' THEN 'completed_no_speech' ELSE 'failed' END,analysis=NULL,updated_at=now() WHERE job_id=j.id;
 RETURN jsonb_build_object('ok',true,'refunded',true);
END $$;
REVOKE ALL ON FUNCTION public.speech_analysis_fail(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.speech_analysis_fail(uuid,text) TO service_role;

-- Keep legacy callers and receipts byte-compatible while preventing Automatic
-- requests from reusing or joining a result made in an explicit language.
CREATE OR REPLACE FUNCTION public.speech_analysis_request_v2(p_auth_id text,p_asset_job_id uuid,p_duration numeric,p_key text,p_expected_credits integer,p_source_kind text,p_upload_key text,p_fingerprint text,p_size bigint,p_measured numeric,p_mime text,p_accepts_no_speech boolean,p_cache_only boolean)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.speech_analysis_request_v3(p_auth_id,p_asset_job_id,p_duration,p_key,p_expected_credits,p_source_kind,p_upload_key,p_fingerprint,p_size,p_measured,p_mime,p_accepts_no_speech,p_cache_only,'auto');
$$;
REVOKE ALL ON FUNCTION public.speech_analysis_request_v2(text,uuid,numeric,text,integer,text,text,text,bigint,numeric,text,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.speech_analysis_request_v2(text,uuid,numeric,text,integer,text,text,text,bigint,numeric,text,boolean,boolean) TO service_role;

-- A rolled-back Worker may still call the original quote RPC. It must quote
-- only Automatic cache entries, never an explicit-language transcript.
CREATE OR REPLACE FUNCTION public.speech_analysis_preflight(p_auth_id text,p_source_kind text,p_asset_job_id uuid,p_fingerprint text,p_size bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.speech_analysis_preflight_v2(p_auth_id,p_source_kind,p_asset_job_id,p_fingerprint,p_size,'auto');
$$;
REVOKE ALL ON FUNCTION public.speech_analysis_preflight(text,text,uuid,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.speech_analysis_preflight(text,text,uuid,text,bigint) TO service_role;
