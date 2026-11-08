-- ADR-0000 mobile speech cut. Staged price: ceil($0.008 / $0.01796) = 1 floor;
-- proposed flat customer price 2 credits, whole source <=60s. Owner activation only.
INSERT INTO public.model_catalog(id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,cost_unit,billing_seconds,gated_flag,active)
VALUES('elevenlabs-scribe-v2','Speech analysis','fal','fal-ai/elevenlabs/speech-to-text/scribe-v2','audio-to-text',2,0.008,'per_generation',NULL,false,false)
ON CONFLICT(id) DO NOTHING;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.model_catalog WHERE id='elevenlabs-scribe-v2') THEN RAISE EXCEPTION 'Speech model missing'; END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.speech_source_probes (
 asset_id uuid PRIMARY KEY REFERENCES public.assets(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.users(id), asset_job_id uuid NOT NULL REFERENCES public.jobs(id),
 source_fingerprint text NOT NULL CHECK(length(source_fingerprint)=64), duration numeric NOT NULL CHECK(duration>0),
 mime text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.speech_analyses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id),
 job_id uuid NOT NULL UNIQUE REFERENCES public.jobs(id), asset_job_id uuid NOT NULL REFERENCES public.jobs(id),
 asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
 source_fingerprint text NOT NULL, schema_version int NOT NULL DEFAULT 1 CHECK(schema_version=1),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','completed','failed')),
 language text, duration numeric NOT NULL CHECK(duration BETWEEN 0.5 AND 60), analysis jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS speech_analyses_open ON public.speech_analyses(user_id,created_at) WHERE status='queued';
CREATE INDEX IF NOT EXISTS speech_analyses_asset ON public.speech_analyses(asset_id);
CREATE INDEX IF NOT EXISTS speech_analyses_source ON public.speech_analyses(user_id,asset_job_id,source_fingerprint);
CREATE INDEX IF NOT EXISTS speech_analyses_created ON public.speech_analyses(created_at);
CREATE INDEX IF NOT EXISTS speech_analyses_queued_expiry ON public.speech_analyses(created_at) WHERE status='queued';
CREATE TABLE IF NOT EXISTS public.speech_analysis_cache (
 user_id uuid NOT NULL REFERENCES public.users(id), asset_job_id uuid NOT NULL REFERENCES public.jobs(id),
 source_fingerprint text NOT NULL, schema_version int NOT NULL,
 analysis_id uuid NOT NULL REFERENCES public.speech_analyses(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, PRIMARY KEY(user_id,asset_job_id,source_fingerprint,schema_version)
);
CREATE INDEX IF NOT EXISTS speech_analysis_cache_analysis ON public.speech_analysis_cache(analysis_id);
-- Foreign keys need a leading index (scripts/test-fk-indexes.mjs).
CREATE INDEX IF NOT EXISTS speech_analyses_asset_job ON public.speech_analyses(asset_job_id);
CREATE INDEX IF NOT EXISTS speech_analysis_cache_asset_job ON public.speech_analysis_cache(asset_job_id);
CREATE INDEX IF NOT EXISTS speech_source_probes_asset_job ON public.speech_source_probes(asset_job_id);
CREATE INDEX IF NOT EXISTS speech_source_probes_user ON public.speech_source_probes(user_id);
-- Content-free receipts outlive the analysis, so an expired key can never buy again.
CREATE TABLE IF NOT EXISTS public.speech_analysis_requests (
 user_id uuid NOT NULL REFERENCES public.users(id), idempotency_key text NOT NULL,
 digest text NOT NULL, attempt_id uuid NOT NULL REFERENCES public.jobs(id),
 kind text NOT NULL CHECK(kind IN ('new','reused_cache','joined_in_flight')),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS speech_analysis_requests_attempt ON public.speech_analysis_requests(attempt_id);
ALTER TABLE public.speech_source_probes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.speech_source_probes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.speech_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.speech_analyses FORCE ROW LEVEL SECURITY;
ALTER TABLE public.speech_analysis_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.speech_analysis_cache FORCE ROW LEVEL SECURITY;
ALTER TABLE public.speech_analysis_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.speech_analysis_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.speech_source_probes,public.speech_analyses,public.speech_analysis_cache,public.speech_analysis_requests FROM PUBLIC,anon,authenticated;

-- Resolve exactly the object get_user_asset selected, including stems; no caller URL.
CREATE OR REPLACE FUNCTION public.speech_source(p_auth_id text,p_asset_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.assets%ROWTYPE; j public.jobs%ROWTYPE; u uuid; owned jsonb;
BEGIN
 SELECT id INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 SELECT * INTO j FROM public.jobs WHERE id=p_asset_job_id AND user_id=u AND deleted_at IS NULL AND state='STORED';
 IF j.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 owned:=public.get_user_asset(p_auth_id,p_asset_job_id);
 IF owned->>'ok' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 SELECT * INTO a FROM public.assets WHERE job_id=j.id AND r2_key=owned->>'r2_key' AND held_at IS NULL AND (expires_at IS NULL OR expires_at>now());
 IF a.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 RETURN owned||jsonb_build_object('asset_id',a.id,'sha256',a.sha256,'probe',(
  SELECT jsonb_build_object('duration',p.duration,'mime',p.mime,'fingerprint',p.source_fingerprint)
  FROM public.speech_source_probes p WHERE p.asset_id=a.id AND p.source_fingerprint=a.sha256 AND p.mime=a.mime_type
  AND p.created_at>now()-interval '30 days'));
END $$;
REVOKE ALL ON FUNCTION public.speech_source(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.speech_source(text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.speech_source_probe_store(p_auth_id text,p_asset_job_id uuid,p_fingerprint text,p_duration numeric,p_mime text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb; u uuid;
BEGIN
 a:=public.speech_source(p_auth_id,p_asset_job_id);
 IF a->>'ok' IS DISTINCT FROM 'true' THEN RETURN a; END IF;
 IF p_duration IS NULL OR p_duration<=0 OR p_duration='NaN'::numeric OR p_duration>86400 OR p_fingerprint IS DISTINCT FROM a->>'sha256'
 OR p_mime IS DISTINCT FROM a->>'mime_type' OR p_mime NOT IN ('video/mp4','video/quicktime','audio/mp4','audio/x-m4a','audio/wav','audio/x-wav','audio/mpeg') THEN
  RETURN jsonb_build_object('ok',false,'code','SOURCE_UNSUPPORTED'); END IF;
 -- Bound provider exposure even when a container understates its duration.
 IF (a->>'size_bytes')::numeric IS NULL OR (a->>'size_bytes')::numeric NOT BETWEEN 1 AND 104857600
 OR (a->>'size_bytes')::numeric>p_duration*2097152 THEN RETURN jsonb_build_object('ok',false,'code','SOURCE_UNSUPPORTED'); END IF;
 SELECT id INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 INSERT INTO public.speech_source_probes(asset_id,user_id,asset_job_id,source_fingerprint,duration,mime)
 VALUES((a->>'asset_id')::uuid,u,p_asset_job_id,p_fingerprint,p_duration,p_mime)
 ON CONFLICT(asset_id) DO UPDATE SET source_fingerprint=EXCLUDED.source_fingerprint,duration=EXCLUDED.duration,mime=EXCLUDED.mime,created_at=now();
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.speech_source_probe_store(text,uuid,text,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.speech_source_probe_store(text,uuid,text,numeric,text) TO service_role;

CREATE OR REPLACE FUNCTION public.speech_analysis_get(p_auth_id text,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.speech_analyses%ROWTYPE; j public.jobs%ROWTYPE; u uuid; source jsonb;
BEGIN
 SELECT id INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 SELECT * INTO a FROM public.speech_analyses WHERE job_id=p_id AND user_id=u;
 IF a.id IS NULL OR a.created_at<=now()-interval '30 days' THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 source:=public.speech_source(p_auth_id,a.asset_job_id);
 IF source->>'ok' IS DISTINCT FROM 'true' OR source->>'sha256' IS DISTINCT FROM a.source_fingerprint THEN
  RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 SELECT * INTO j FROM public.jobs WHERE id=a.job_id;
 RETURN jsonb_build_object('ok',true,'id',j.id,'status',a.status,
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
 source:=public.speech_source(p_auth_id,(j.inputs->>'asset_job_id')::uuid);
 IF source->>'ok' IS DISTINCT FROM 'true' THEN RETURN source||jsonb_build_object('found',true,'digest',r.digest); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.speech_analyses WHERE job_id=r.attempt_id AND created_at>now()-interval '30 days') THEN
  RETURN jsonb_build_object('ok',false,'found',true,'code','RESULT_EXPIRED','digest',r.digest); END IF;
 value:=public.speech_analysis_get(p_auth_id,r.attempt_id);
 RETURN value||jsonb_build_object('found',true,'digest',r.digest,'id',r.attempt_id,'kind',r.kind);
END $$;
REVOKE ALL ON FUNCTION public.speech_analysis_by_key(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.speech_analysis_by_key(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.speech_analysis_request(p_auth_id text,p_asset_job_id uuid,p_duration numeric,p_key text,p_expected_credits integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid; source jsonb; probe public.speech_source_probes%ROWTYPE; a public.speech_analyses%ROWTYPE;
 r public.speech_analysis_requests%ROWTYPE; model public.model_catalog%ROWTYPE; digest text; kind text; result jsonb; attempt uuid;
BEGIN
 SELECT id INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 -- Per-user serialization also bounds concurrency across different source keys.
 PERFORM pg_advisory_xact_lock(hashtextextended('speech:'||u::text,0));
 -- Serialize the cross-feature key check with all ledger_debit callers as well.
 PERFORM 1 FROM public.credit_balances WHERE user_id=u FOR UPDATE;
 source:=public.speech_source(p_auth_id,p_asset_job_id);
 IF source->>'ok' IS DISTINCT FROM 'true' THEN RETURN source; END IF;
 digest:=encode(pg_catalog.sha256(pg_catalog.convert_to(p_asset_job_id::text||':'||(source->>'sha256')||':1','UTF8')),'hex');
 SELECT * INTO r FROM public.speech_analysis_requests WHERE user_id=u AND idempotency_key=p_key;
 IF r.attempt_id IS NOT NULL THEN
  IF r.digest<>digest THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  RETURN public.speech_analysis_by_key(p_auth_id,p_key)||jsonb_build_object('replay',true);
 END IF;
 IF p_key IS NULL OR p_key!~'^[A-Za-z0-9._-]{8,128}$' OR EXISTS(SELECT 1 FROM public.jobs WHERE user_id=u AND idempotency_key=p_key) THEN
  RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
 -- Durable receipts above survive probe/analysis retention; only new keys require a probe.
 SELECT * INTO probe FROM public.speech_source_probes WHERE asset_id=(source->>'asset_id')::uuid AND source_fingerprint=source->>'sha256';
 IF probe.asset_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','SOURCE_UNSUPPORTED'); END IF;
 IF (source->>'size_bytes')::numeric IS NULL OR (source->>'size_bytes')::numeric NOT BETWEEN 1 AND 104857600
 OR (source->>'size_bytes')::numeric>probe.duration*2097152 THEN RETURN jsonb_build_object('ok',false,'code','SOURCE_UNSUPPORTED'); END IF;
 IF probe.duration>60 THEN RETURN jsonb_build_object('ok',false,'code','SOURCE_TOO_LONG'); END IF;
 IF probe.duration<0.5 OR p_duration IS NULL OR p_duration='NaN'::numeric OR abs(probe.duration-p_duration)>0.25 THEN
  RETURN jsonb_build_object('ok',false,'code','DURATION_MISMATCH'); END IF;
 -- The source lock prevents deletion between the probe check and admission.
 PERFORM 1 FROM public.assets WHERE id=probe.asset_id FOR KEY SHARE;
 SELECT s.* INTO a FROM public.speech_analysis_cache c JOIN public.speech_analyses s ON s.id=c.analysis_id
 WHERE c.user_id=u AND c.asset_job_id=p_asset_job_id AND c.source_fingerprint=probe.source_fingerprint AND c.schema_version=1
 AND c.expires_at>now() AND s.status='completed' AND s.created_at>now()-interval '30 days';
 kind:='reused_cache';
 IF a.id IS NULL THEN
  SELECT * INTO a FROM public.speech_analyses WHERE user_id=u AND asset_job_id=p_asset_job_id AND source_fingerprint=probe.source_fingerprint
   AND schema_version=1 AND status='queued' AND created_at>now()-interval '15 minutes' ORDER BY created_at DESC LIMIT 1;
  kind:='joined_in_flight';
 END IF;
 IF a.id IS NOT NULL THEN attempt:=a.job_id;
 ELSE
  SELECT * INTO model FROM public.model_catalog WHERE id='elevenlabs-scribe-v2' AND active AND provider='fal' AND provider_endpoint='fal-ai/elevenlabs/speech-to-text/scribe-v2' FOR SHARE;
  IF model.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','SPEECH_CUT_UNAVAILABLE'); END IF;
  IF p_expected_credits IS DISTINCT FROM model.credits_5s THEN RETURN jsonb_build_object('ok',false,'code','PRICE_CHANGED','credits',model.credits_5s); END IF;
  IF (SELECT count(*) FROM public.speech_analyses WHERE user_id=u AND status='queued' AND created_at>now()-interval '15 minutes')>=3 THEN
   RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED'); END IF;
  result:=public.check_generation_rate_limit(p_auth_id,10,60);
  IF result->>'ok' IS DISTINCT FROM 'true' THEN RETURN result; END IF;
  result:=public.ledger_debit(u,p_key,model.credits_5s,'debit:speech_analysis',model.id,
   jsonb_build_object('kind','speech_analysis','asset_job_id',p_asset_job_id,'source_fingerprint',probe.source_fingerprint,'schema_version',1));
  IF result->>'ok' IS DISTINCT FROM 'true' THEN RETURN result; END IF;
  attempt:=(result->>'job_id')::uuid;
  INSERT INTO public.speech_analyses(user_id,job_id,asset_job_id,asset_id,source_fingerprint,duration)
   VALUES(u,attempt,p_asset_job_id,probe.asset_id,probe.source_fingerprint,probe.duration);
  kind:='new';
 END IF;
 INSERT INTO public.speech_analysis_requests(user_id,idempotency_key,digest,attempt_id,kind) VALUES(u,p_key,digest,attempt,kind);
 RETURN public.speech_analysis_get(p_auth_id,attempt)||jsonb_build_object('kind',kind,'fresh',kind='new','credits',model.credits_5s);
END $$;
REVOKE ALL ON FUNCTION public.speech_analysis_request(text,uuid,numeric,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.speech_analysis_request(text,uuid,numeric,text,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.speech_analysis_fail(p_job_id uuid,p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.jobs%ROWTYPE; r jsonb;
BEGIN
 SELECT * INTO j FROM public.jobs WHERE id=p_job_id FOR UPDATE;
 IF j.id IS NULL OR j.inputs->>'kind' IS DISTINCT FROM 'speech_analysis' THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF j.state='STORED' THEN RETURN jsonb_build_object('ok',true,'refunded',false); END IF;
 IF j.state<>'REFUNDED' THEN
  UPDATE public.jobs SET state='FAILED',error_code=CASE WHEN p_code~'^[a-z_]{1,64}$' THEN p_code ELSE 'analysis_failed' END,updated_at=now() WHERE id=j.id;
  r:=public.ledger_refund(j.id,j.user_id,j.credits,'refund:speech_analysis');
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Speech refund unavailable'; END IF;
 END IF;
 UPDATE public.speech_analyses SET status='failed',analysis=NULL,updated_at=now() WHERE job_id=j.id;
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
 source:=public.speech_source(auth,a.asset_job_id);
 IF a.id IS NULL OR a.created_at<=now()-interval '30 days' OR source->>'ok' IS DISTINCT FROM 'true' OR source->>'sha256' IS DISTINCT FROM a.source_fingerprint THEN
  RETURN public.speech_analysis_fail(j.id,'source_removed'); END IF;
 IF j.state<>'SUBMITTED' THEN RETURN jsonb_build_object('ok',false,'code','BAD_STATE'); END IF;
 IF jsonb_typeof(p_analysis) IS DISTINCT FROM 'object' OR p_analysis->>'version' IS DISTINCT FROM '1'
 OR p_analysis->>'assetId' IS DISTINCT FROM a.asset_job_id::text OR jsonb_typeof(p_analysis->'chunks') IS DISTINCT FROM 'array'
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
 UPDATE public.speech_analyses SET status='completed',analysis=p_analysis,language=p_analysis->>'language',updated_at=now() WHERE id=a.id;
 UPDATE public.jobs SET state='STORED',error_code=NULL,updated_at=now() WHERE id=j.id;
 INSERT INTO public.speech_analysis_cache(user_id,asset_job_id,source_fingerprint,schema_version,analysis_id,expires_at)
 VALUES(a.user_id,a.asset_job_id,a.source_fingerprint,a.schema_version,a.id,a.created_at+interval '30 days')
 ON CONFLICT(user_id,asset_job_id,source_fingerprint,schema_version) DO UPDATE SET analysis_id=EXCLUDED.analysis_id,expires_at=EXCLUDED.expires_at;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.speech_analysis_complete(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.speech_analysis_complete(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.sweep_speech_analyses()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j record;
BEGIN
 FOR j IN SELECT jobs.id FROM public.speech_analyses a JOIN public.jobs ON jobs.id=a.job_id
 WHERE a.status='queued' AND a.created_at<=now()-interval '15 minutes' AND jobs.state IN ('DEBITED','SUBMITTED','FAILED','REFUNDED')
 ORDER BY a.created_at LIMIT 200 FOR UPDATE OF jobs SKIP LOCKED LOOP
  PERFORM public.speech_analysis_fail(j.id,'analysis_timeout');
 END LOOP;
 DELETE FROM public.speech_analyses WHERE created_at<=now()-interval '30 days';
 DELETE FROM public.speech_source_probes WHERE created_at<=now()-interval '30 days';
END $$;
REVOKE ALL ON FUNCTION public.sweep_speech_analyses() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_speech_analyses() TO service_role;
DO $cron$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN RETURN; END IF;
 PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname='veyrnox-sweep-speech-analyses';
 PERFORM cron.schedule('veyrnox-sweep-speech-analyses','*/5 * * * *',$$ SELECT public.sweep_speech_analyses(); $$);
END $cron$;

CREATE OR REPLACE FUNCTION private.speech_source_deleted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record;
BEGIN
 FOR a IN SELECT job_id FROM public.speech_analyses WHERE asset_id=OLD.id AND status='queued' LOOP
  PERFORM public.speech_analysis_fail(a.job_id,'source_removed');
 END LOOP;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION private.speech_source_deleted() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS speech_source_deleted ON public.assets;
CREATE TRIGGER speech_source_deleted BEFORE DELETE ON public.assets FOR EACH ROW EXECUTE FUNCTION private.speech_source_deleted();
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
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.speech_user_erased() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS speech_user_erased ON public.users;
CREATE TRIGGER speech_user_erased AFTER UPDATE OF deleted_at ON public.users FOR EACH ROW EXECUTE FUNCTION private.speech_user_erased();

-- Called only after Ed25519 verification and (for URL correlation) HMAC verification.
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
 RETURN jsonb_build_object('ok',true,'assetId',a.asset_job_id,'duration',a.duration);
END $$;
REVOKE ALL ON FUNCTION public.speech_analysis_callback(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.speech_analysis_callback(uuid,text) TO service_role;
