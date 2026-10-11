-- ADR-0095: all six stems from one bounded Demucs job use normal asset retention/holds.
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS output_label TEXT;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='assets_output_label_check') THEN
  ALTER TABLE public.assets ADD CONSTRAINT assets_output_label_check CHECK(output_label IS NULL OR output_label IN ('vocals','drums','bass','other','guitar','piano'));
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS assets_job_output_label_idx ON public.assets(job_id,output_label) WHERE output_label IS NOT NULL;
CREATE OR REPLACE FUNCTION public.job_stored_audio_stems(p_provider_job_id TEXT,p_stems JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_job public.jobs%ROWTYPE; v_item JSONB; v_asset public.assets%ROWTYPE; v_labels TEXT[]; v_keys BIGINT;
BEGIN
 SELECT * INTO v_job FROM public.jobs WHERE provider='fal' AND provider_job_id=p_provider_job_id FOR UPDATE;
 IF v_job.id IS NULL OR v_job.model_id<>'demucs-stems' OR v_job.state NOT IN ('SUCCEEDED','STORED') THEN RETURN jsonb_build_object('ok',false,'code','JOB_NOT_COMPLETABLE'); END IF;
 IF jsonb_typeof(p_stems) IS DISTINCT FROM 'array' OR jsonb_array_length(p_stems)<>6 THEN RETURN jsonb_build_object('ok',false,'code','STEMS_INVALID'); END IF;
 SELECT array_agg(value->>'label' ORDER BY value->>'label') INTO v_labels FROM jsonb_array_elements(p_stems);
 IF v_labels IS DISTINCT FROM ARRAY['bass','drums','guitar','other','piano','vocals']::text[] THEN RETURN jsonb_build_object('ok',false,'code','STEMS_INVALID'); END IF;
 SELECT count(DISTINCT value->>'r2_key') INTO v_keys FROM jsonb_array_elements(p_stems);
 IF v_keys<>6 THEN RETURN jsonb_build_object('ok',false,'code','STEMS_INVALID'); END IF;
 -- Validate the entire manifest before any write. One RPC commits all outputs and state together.
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_stems) LOOP
  IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' OR v_item->>'mime_type' IS DISTINCT FROM 'audio/mpeg'
   OR coalesce(v_item->>'sha256','')!~'^[0-9a-f]{64}$'
   OR coalesce(v_item->>'size_bytes','')!~'^[0-9]{1,8}$'
   OR coalesce(v_item->>'r2_key','')!~'^fal/[A-Za-z0-9._-]{1,128}/[0-9a-f]{16}\.mp3$'
   OR split_part(v_item->>'r2_key','/',2) IS DISTINCT FROM p_provider_job_id THEN RETURN jsonb_build_object('ok',false,'code','STEMS_INVALID'); END IF;
  IF (v_item->>'size_bytes')::bigint NOT BETWEEN 1 AND 20971520 THEN RETURN jsonb_build_object('ok',false,'code','STEMS_INVALID'); END IF;
  SELECT * INTO v_asset FROM public.assets WHERE job_id=v_job.id AND output_label=v_item->>'label';
  IF v_job.state='STORED' AND v_asset.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','STEMS_IMMUTABLE'); END IF;
  IF v_asset.id IS NOT NULL AND (v_asset.r2_key IS DISTINCT FROM v_item->>'r2_key' OR v_asset.sha256 IS DISTINCT FROM v_item->>'sha256'
   OR v_asset.size_bytes IS DISTINCT FROM (v_item->>'size_bytes')::bigint OR v_asset.mime_type IS DISTINCT FROM v_item->>'mime_type') THEN RETURN jsonb_build_object('ok',false,'code','STEMS_IMMUTABLE'); END IF;
  IF EXISTS(SELECT 1 FROM public.assets WHERE r2_key=v_item->>'r2_key' AND (job_id<>v_job.id OR output_label IS DISTINCT FROM v_item->>'label')) THEN RETURN jsonb_build_object('ok',false,'code','STEMS_CONFLICT'); END IF;
 END LOOP;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_stems) LOOP
  INSERT INTO public.assets(job_id,r2_key,mime_type,size_bytes,sha256,output_label)
  VALUES(v_job.id,v_item->>'r2_key','audio/mpeg',(v_item->>'size_bytes')::bigint,v_item->>'sha256',v_item->>'label') ON CONFLICT(r2_key) DO NOTHING;
 END LOOP;
 IF (SELECT count(*) FROM public.assets WHERE job_id=v_job.id AND output_label IS NOT NULL)<>6 THEN RAISE EXCEPTION 'Incomplete audio stem manifest'; END IF;
 UPDATE public.jobs SET state='STORED',updated_at=now() WHERE id=v_job.id AND state='SUCCEEDED';
 RETURN jsonb_build_object('ok',true,'job_id',v_job.id);
END $$;
REVOKE ALL ON FUNCTION public.job_stored_audio_stems(TEXT,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.job_stored_audio_stems(TEXT,JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.get_user_audio_stem(p_auth_id TEXT,p_job_id UUID,p_label TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row RECORD;
BEGIN
 IF p_label NOT IN ('vocals','drums','bass','other','guitar','piano') OR p_label IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 SELECT a.r2_key,a.mime_type,a.size_bytes,a.expires_at,j.state::text AS state INTO v_row
 FROM public.assets a JOIN public.jobs j ON j.id=a.job_id JOIN public.users u ON u.id=j.user_id
 WHERE j.id=p_job_id AND u.auth_id=p_auth_id AND j.state='STORED' AND j.model_id='demucs-stems' AND a.output_label=p_label AND a.expires_at>now() LIMIT 1;
 IF v_row IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF EXISTS(SELECT 1 FROM public.assets WHERE job_id=p_job_id AND held_at IS NOT NULL) THEN RETURN jsonb_build_object('ok',false,'code','HELD'); END IF;
 RETURN jsonb_build_object('ok',true,'r2_key',v_row.r2_key,'mime_type',v_row.mime_type,'size_bytes',v_row.size_bytes,'asset_expires_at',v_row.expires_at,'state',v_row.state);
END $$;
REVOKE ALL ON FUNCTION public.get_user_audio_stem(TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_audio_stem(TEXT,UUID,TEXT) TO service_role;

-- Keep ordinary jobs' established lookup unchanged; labelled separation defaults to vocals.
CREATE OR REPLACE FUNCTION public.get_user_asset(p_auth_id TEXT,p_job_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row RECORD; v_stem JSONB;
BEGIN
 IF EXISTS(SELECT 1 FROM public.jobs j JOIN public.users u ON u.id=j.user_id WHERE j.id=p_job_id AND u.auth_id=p_auth_id AND j.model_id='demucs-stems') THEN
  v_stem:=public.get_user_audio_stem(p_auth_id,p_job_id,'vocals');
  IF (v_stem->>'ok')::boolean THEN v_stem:=v_stem||jsonb_build_object('output_stems',jsonb_build_array('vocals','drums','bass','other','guitar','piano')); END IF;
  RETURN v_stem;
 END IF;
 SELECT a.held_at,a.r2_key,a.mime_type,a.size_bytes,a.expires_at,j.state::text AS state INTO v_row FROM public.assets a JOIN public.jobs j ON j.id=a.job_id JOIN public.users u ON u.id=j.user_id WHERE j.id=p_job_id AND u.auth_id=p_auth_id LIMIT 1;
 IF v_row IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF v_row.held_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','HELD'); END IF;
 RETURN jsonb_build_object('ok',true,'r2_key',v_row.r2_key,'mime_type',v_row.mime_type,'size_bytes',v_row.size_bytes,'asset_expires_at',v_row.expires_at,'state',v_row.state);
END $$;
REVOKE ALL ON FUNCTION public.get_user_asset(TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_asset(TEXT,UUID) TO service_role;

-- Public rate, owner instruction “proceed”; invoice is unconfirmed (ADR-0095).
-- One flat unit covers <=120s at $0.0007/s: $0.084, ceil(0.084/0.0165)=6 credits.
-- Server rollout flag stays off until production SQL is approved/applied and qualified.
INSERT INTO public.model_catalog(id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,cost_unit,billing_seconds,gated_flag,active)
VALUES('demucs-stems','Demucs vocals and instruments (up to 120s)','fal','fal-ai/demucs','audio-to-audio',6,0.084,'per_generation',NULL,false,true)
ON CONFLICT(id) DO NOTHING;
