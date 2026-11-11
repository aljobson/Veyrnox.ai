-- Exact-range instrumental section replacement through ACE-Step audio inpaint.
-- The admitted source cap is 60 seconds, so $0.0002/output second is bounded
-- at $0.012 per candidate (one internal credit). Staged inactive.
INSERT INTO public.model_catalog
    (id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,cost_unit,billing_seconds,gated_flag,active)
VALUES ('ace-step-replace-section','ACE-Step Replace Section','fal','fal-ai/ace-step/audio-inpaint',
    'audio-to-audio',1,0.0120,'per_generation',NULL,false,false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.music_prompt_specs
    ADD COLUMN IF NOT EXISTS replace_start_seconds NUMERIC(10,3),
    ADD COLUMN IF NOT EXISTS replace_end_seconds NUMERIC(10,3);
ALTER TABLE public.music_prompt_specs
    DROP CONSTRAINT IF EXISTS music_prompt_specs_mode_check,
    DROP CONSTRAINT IF EXISTS music_prompt_specs_schema_version_check,
    DROP CONSTRAINT IF EXISTS music_prompt_specs_mode_shape_check;
ALTER TABLE public.music_prompt_specs
    ADD CONSTRAINT music_prompt_specs_mode_check CHECK (mode IN ('simple','custom','cover','extend','replace_section')),
    ADD CONSTRAINT music_prompt_specs_schema_version_check CHECK (schema_version IN
        ('music-simple-v1','music-custom-v1','music-cover-v1','music-extend-v1','music-replace-section-v1')),
    ADD CONSTRAINT music_prompt_specs_replace_range_check CHECK (
        (replace_start_seconds IS NULL AND replace_end_seconds IS NULL) OR
        (replace_start_seconds>=0 AND replace_end_seconds>replace_start_seconds
            AND replace_end_seconds-replace_start_seconds BETWEEN 1 AND 30)),
    ADD CONSTRAINT music_prompt_specs_mode_shape_check CHECK (
        (mode='simple' AND instrumental AND lyrics IS NULL AND styles IS NULL AND draft_revision IS NULL
            AND lyrics_rights_version IS NULL AND source_song_id IS NULL AND source_version_id IS NULL
            AND source_duration_seconds IS NULL AND source_influence IS NULL AND source_rights_version IS NULL
            AND extend_seconds_after IS NULL AND replace_start_seconds IS NULL AND replace_end_seconds IS NULL
            AND schema_version='music-simple-v1') OR
        (mode='custom' AND model_id='ace-step-1.5' AND styles IS NOT NULL AND draft_revision IS NOT NULL
            AND source_song_id IS NULL AND source_version_id IS NULL AND source_duration_seconds IS NULL
            AND source_influence IS NULL AND source_rights_version IS NULL AND extend_seconds_after IS NULL
            AND replace_start_seconds IS NULL AND replace_end_seconds IS NULL
            AND schema_version='music-custom-v1' AND ((instrumental AND lyrics IS NULL AND lyrics_rights_version IS NULL)
                OR (NOT instrumental AND lyrics IS NOT NULL AND lyrics_rights_version='music-lyrics-rights-v1'))) OR
        (mode='cover' AND model_id='stable-audio-3-cover' AND instrumental AND lyrics IS NULL AND styles IS NULL
            AND draft_revision IS NULL AND lyrics_rights_version IS NULL AND source_song_id IS NOT NULL
            AND source_version_id IS NOT NULL AND source_duration_seconds IS NOT NULL AND source_influence IS NOT NULL
            AND source_rights_version='music-cover-source-rights-v1' AND extend_seconds_after IS NULL
            AND replace_start_seconds IS NULL AND replace_end_seconds IS NULL AND schema_version='music-cover-v1') OR
        (mode='extend' AND model_id='ace-step-extend' AND instrumental AND lyrics IS NULL AND styles IS NULL
            AND draft_revision IS NULL AND lyrics_rights_version IS NULL AND source_song_id IS NOT NULL
            AND source_version_id IS NOT NULL AND source_duration_seconds IS NOT NULL AND source_influence IS NULL
            AND source_rights_version='music-extend-source-rights-v1' AND extend_seconds_after=30
            AND replace_start_seconds IS NULL AND replace_end_seconds IS NULL AND schema_version='music-extend-v1') OR
        (mode='replace_section' AND model_id='ace-step-replace-section' AND instrumental AND lyrics IS NULL
            AND styles IS NULL AND draft_revision IS NULL AND lyrics_rights_version IS NULL
            AND source_song_id IS NOT NULL AND source_version_id IS NOT NULL AND source_duration_seconds BETWEEN 1 AND 60
            AND source_influence IS NULL AND source_rights_version='music-replace-source-rights-v1'
            AND extend_seconds_after IS NULL AND replace_start_seconds IS NOT NULL AND replace_end_seconds IS NOT NULL
            AND replace_end_seconds<=source_duration_seconds AND schema_version='music-replace-section-v1')
    );
ALTER TABLE public.music_generation_quotes DROP CONSTRAINT IF EXISTS music_generation_quotes_provider_endpoint_check;
ALTER TABLE public.music_generation_quotes ADD CONSTRAINT music_generation_quotes_provider_endpoint_check CHECK (
    provider_endpoint IN ('fal-ai/ace-step','fal-ai/ace-step-1.5','fal-ai/stable-audio-3/small/music/audio-to-audio',
        'fal-ai/ace-step/audio-outpaint','fal-ai/ace-step/audio-inpaint'));

CREATE OR REPLACE FUNCTION public.music_get_replace_source_context(p_auth_id TEXT,p_song_id UUID,p_version_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_row JSONB;
BEGIN
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 SELECT jsonb_build_object('ok',true,'r2_key',a.r2_key,'mime_type',a.mime_type,'size_bytes',a.size_bytes) INTO v_row
 FROM public.music_songs s JOIN public.music_song_versions v ON v.id=p_version_id AND v.user_id=v_user AND v.song_id=s.id
 JOIN public.assets a ON a.id=v.audio_asset_id WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active'
 AND s.current_version_id=p_version_id AND a.mime_type IN ('audio/mpeg','audio/wav');
 RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','REVISION_CONFLICT'));
END $$;

CREATE OR REPLACE FUNCTION public.music_get_replace_dispatch_context(p_auth_id TEXT,p_song_id UUID,p_quote_id UUID,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_prompt public.music_prompt_specs%ROWTYPE; v_request public.music_generation_requests%ROWTYPE;
 v_jobs JSONB; v_balance INTEGER; v_row JSONB;
BEGIN
 IF p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 SELECT * INTO v_request FROM public.music_generation_requests WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF v_request.quote_id IS DISTINCT FROM p_quote_id THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  SELECT COALESCE(jsonb_agg(job_id ORDER BY ordinal),'[]'::jsonb) INTO v_jobs FROM public.music_generation_candidates WHERE generation_request_id=v_request.id;
  SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance FROM public.credit_balances WHERE user_id=v_user;
  RETURN jsonb_build_object('ok',true,'idempotent',true,'request_id',v_request.id,'state',v_request.status,'job_ids',v_jobs,'balance_after',v_balance);
 END IF;
 SELECT ps.* INTO v_prompt FROM public.music_generation_quotes q JOIN public.music_prompt_specs ps
 ON ps.id=q.prompt_spec_id AND ps.user_id=q.user_id WHERE q.id=p_quote_id AND q.user_id=v_user
 AND ps.mode='replace_section' AND ps.source_song_id=p_song_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 SELECT jsonb_build_object('ok',true,'idempotent',false,'r2_key',a.r2_key,'mime_type',a.mime_type,
  'source_duration_seconds',v_prompt.source_duration_seconds) INTO v_row FROM public.music_songs s
 JOIN public.music_song_versions v ON v.id=v_prompt.source_version_id AND v.user_id=v_user AND v.song_id=s.id
 JOIN public.assets a ON a.id=v.audio_asset_id WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active'
 AND s.current_version_id=v_prompt.source_version_id AND a.mime_type IN ('audio/mpeg','audio/wav');
 RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','REVISION_CONFLICT'));
END $$;

CREATE OR REPLACE FUNCTION public.music_submit_replace_pair(p_auth_id TEXT,p_song_id UUID,p_quote_id UUID,
 p_idempotency_key TEXT,p_source_audio_url TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_balance INTEGER; v_active INTEGER; v_recent INTEGER; v_quote public.music_generation_quotes%ROWTYPE;
 v_prompt public.music_prompt_specs%ROWTYPE; v_model public.model_catalog%ROWTYPE;
 v_request public.music_generation_requests%ROWTYPE; v_existing public.music_generation_requests%ROWTYPE;
 v_one JSONB; v_two JSONB; v_failure JSONB; v_job_one UUID; v_job_two UUID; v_jobs JSONB; v_payload JSONB;
BEGIN
 IF p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' OR p_source_audio_url !~ '^https://[^[:space:]]{1,2000}$'
 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id FOR UPDATE;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
 SELECT * INTO v_existing FROM public.music_generation_requests WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF v_existing.quote_id IS DISTINCT FROM p_quote_id THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  SELECT COALESCE(jsonb_agg(job_id ORDER BY ordinal),'[]'::jsonb) INTO v_jobs FROM public.music_generation_candidates WHERE generation_request_id=v_existing.id;
  SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance FROM public.credit_balances WHERE user_id=v_user;
  RETURN jsonb_build_object('ok',true,'request_id',v_existing.id,'state',v_existing.status,'job_ids',v_jobs,'balance_after',v_balance,'idempotent',true);
 END IF;
 SELECT count(*) INTO v_active FROM public.music_generation_requests WHERE user_id=v_user AND status IN ('debited','running');
 IF v_active>=4 THEN RETURN jsonb_build_object('ok',false,'code','CONCURRENCY_LIMIT'); END IF;
 SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance FROM public.credit_balances WHERE user_id=v_user FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NO_BALANCE_ROW'); END IF;
 IF EXISTS(SELECT 1 FROM public.users WHERE id=v_user AND frozen_at IS NOT NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','ACCOUNT_FROZEN');
 END IF;
 SELECT * INTO v_quote FROM public.music_generation_quotes WHERE id=p_quote_id AND user_id=v_user FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF v_quote.consumed_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_ALREADY_USED'); END IF;
 IF v_quote.expires_at<=now() THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_EXPIRED'); END IF;
 IF NOT private.music_paid_plan_active(v_user) THEN RETURN jsonb_build_object('ok',false,'code','PLAN_UNAVAILABLE'); END IF;
 SELECT * INTO v_prompt FROM public.music_prompt_specs WHERE id=v_quote.prompt_spec_id AND user_id=v_user
 AND mode='replace_section' AND source_song_id=p_song_id;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.music_songs WHERE id=p_song_id AND user_id=v_user
  AND status='active' AND current_version_id=v_prompt.source_version_id FOR SHARE)
 THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_STALE'); END IF;
 SELECT * INTO v_model FROM public.model_catalog WHERE id=v_quote.model_id FOR SHARE;
 IF NOT FOUND OR NOT v_model.active OR v_model.gated_flag OR v_model.provider<>'fal'
 OR v_model.modality<>'audio-to-audio' OR v_model.id<>'ace-step-replace-section'
 OR v_model.provider_endpoint<>'fal-ai/ace-step/audio-inpaint' OR v_model.provider_endpoint<>v_quote.provider_endpoint
 OR v_model.credits_5s<>1 OR v_quote.unit_credits<>1 OR v_quote.total_credits<>2
 OR v_model.provider_cost_per_unit<>0.0120::numeric
 OR v_model.cost_unit<>'per_generation' OR v_model.billing_seconds IS NOT NULL
 OR v_model.updated_at IS DISTINCT FROM v_quote.catalog_updated_at THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_STALE'); END IF;
 IF v_balance<2 THEN RETURN jsonb_build_object('ok',false,'code','INSUFFICIENT_BALANCE'); END IF;
 SELECT count(*) INTO v_recent FROM public.jobs WHERE user_id=v_user AND created_at>now()-interval '60 seconds';
 IF v_recent>8 THEN RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED','retry_after_seconds',60); END IF;
 BEGIN
  INSERT INTO public.music_generation_requests(user_id,quote_id,prompt_spec_id,model_id,idempotency_key,credit_quote)
  VALUES(v_user,v_quote.id,v_prompt.id,v_model.id,p_idempotency_key,2) RETURNING * INTO v_request;
  v_one:=public.ledger_debit(v_user,p_idempotency_key||'.1',1,'debit:music_generation',v_model.id,
   jsonb_build_object('music_request_id',v_request.id,'music_candidate_ordinal',1),0,120);
  IF v_one->>'ok' IS DISTINCT FROM 'true' THEN v_failure:=v_one; RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='replace debit one refused'; END IF;
  v_two:=public.ledger_debit(v_user,p_idempotency_key||'.2',1,'debit:music_generation',v_model.id,
   jsonb_build_object('music_request_id',v_request.id,'music_candidate_ordinal',2),0,120);
  IF v_two->>'ok' IS DISTINCT FROM 'true' THEN v_failure:=v_two; RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='replace debit two refused'; END IF;
  v_job_one:=(v_one->>'job_id')::uuid; v_job_two:=(v_two->>'job_id')::uuid;
  INSERT INTO public.music_generation_candidates(user_id,generation_request_id,ordinal,job_id)
  VALUES(v_user,v_request.id,1,v_job_one),(v_user,v_request.id,2,v_job_two);
  v_payload:=jsonb_build_object('audio_url',p_source_audio_url,'start_time_relative_to','start',
   'start_time',v_prompt.replace_start_seconds,'end_time_relative_to','start','end_time',v_prompt.replace_end_seconds,
   'tags',v_prompt.prompt,'lyrics','[instrumental]','variance',0.5,'enable_safety_checker',true,'number_of_steps',27);
  INSERT INTO public.fal_dispatch(job_id,endpoint,payload) VALUES(v_job_one,v_quote.provider_endpoint,v_payload),(v_job_two,v_quote.provider_endpoint,v_payload);
  UPDATE public.music_generation_quotes SET consumed_at=now() WHERE id=v_quote.id;
 EXCEPTION WHEN SQLSTATE 'P0001' THEN RETURN COALESCE(v_failure,jsonb_build_object('ok',false,'code','PAIR_DEBIT_FAILED')); END;
 SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance FROM public.credit_balances WHERE user_id=v_user;
 RETURN jsonb_build_object('ok',true,'request_id',v_request.id,'state','debited','job_ids',jsonb_build_array(v_job_one,v_job_two),'balance_after',v_balance);
END $$;

-- Expand the source-branch projector from migration 0274 to Replace Section.
-- Full body is kept here because webhook settlement calls this exact function.
CREATE OR REPLACE FUNCTION public.music_project_candidate(p_job_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_candidate public.music_generation_candidates%ROWTYPE; v_job public.jobs%ROWTYPE; v_asset public.assets%ROWTYPE;
 v_prompt public.music_prompt_specs%ROWTYPE; v_song UUID; v_version UUID; v_number INTEGER;
 v_ready INTEGER; v_terminal INTEGER; v_refunded INTEGER; v_running INTEGER; v_request_status TEXT;
 v_operation TEXT; v_relation TEXT; v_schema TEXT; v_evidence JSONB;
BEGIN
 SELECT * INTO v_candidate FROM public.music_generation_candidates WHERE job_id=p_job_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'projected',false); END IF;
 SELECT * INTO v_job FROM public.jobs WHERE id=p_job_id;
 IF v_job.state='STORED' THEN
  SELECT * INTO v_asset FROM public.assets WHERE job_id=p_job_id ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'projected',false,'waiting_for','asset'); END IF;
  IF v_candidate.song_id IS NULL THEN
   SELECT p.* INTO v_prompt FROM public.music_prompt_specs p JOIN public.music_generation_requests r ON r.prompt_spec_id=p.id WHERE r.id=v_candidate.generation_request_id;
   IF v_prompt.mode IN ('cover','extend','replace_section') THEN
    SELECT id INTO v_song FROM public.music_songs WHERE id=v_prompt.source_song_id AND user_id=v_candidate.user_id FOR UPDATE;
    IF v_song IS NULL THEN RETURN jsonb_build_object('ok',true,'projected',false,'waiting_for','source_song'); END IF;
    SELECT COALESCE(max(version_number),0)+1 INTO v_number FROM public.music_song_versions WHERE song_id=v_song;
    v_operation:=CASE v_prompt.mode WHEN 'cover' THEN 'cover' WHEN 'extend' THEN 'extend' ELSE 'replace_section' END;
    v_relation:=CASE v_prompt.mode WHEN 'cover' THEN 'cover_source' WHEN 'extend' THEN 'extend_source' ELSE 'edit_source' END;
    v_schema:=CASE v_prompt.mode WHEN 'cover' THEN 'music-cover-v1' WHEN 'extend' THEN 'music-extend-v1' ELSE 'music-replace-section-v1' END;
    v_evidence:=jsonb_strip_nulls(jsonb_build_object('source_duration_seconds',v_prompt.source_duration_seconds,
     'source_influence',v_prompt.source_influence,'extend_seconds_after',v_prompt.extend_seconds_after,
     'start_seconds',v_prompt.replace_start_seconds,'end_seconds',v_prompt.replace_end_seconds,'rights_version',v_prompt.source_rights_version));
    INSERT INTO public.music_song_versions(user_id,song_id,generation_request_id,job_id,audio_asset_id,version_number,provenance,operation,parent_version_id)
    VALUES(v_candidate.user_id,v_song,v_candidate.generation_request_id,p_job_id,v_asset.id,v_number,
     jsonb_build_object('model_id',v_job.model_id,'provider',v_job.provider,
      'provider_job_id',v_job.provider_job_id,'asset_sha256',v_asset.sha256,'schema_version',v_schema)||v_evidence,
     v_operation,v_prompt.source_version_id) RETURNING id INTO v_version;
    INSERT INTO public.music_version_sources(user_id,output_version_id,source_version_id,relation,ordinal,evidence)
    VALUES(v_candidate.user_id,v_version,v_prompt.source_version_id,v_relation,1,v_evidence);
   ELSE
    INSERT INTO public.music_songs(user_id,title) VALUES(v_candidate.user_id,
     COALESCE(v_prompt.title,'Music draft '||CASE v_candidate.ordinal WHEN 1 THEN 'A' ELSE 'B' END)) RETURNING id INTO v_song;
    INSERT INTO public.music_song_versions(user_id,song_id,generation_request_id,job_id,audio_asset_id,provenance)
    VALUES(v_candidate.user_id,v_song,v_candidate.generation_request_id,p_job_id,v_asset.id,
     jsonb_build_object('model_id',v_job.model_id,'provider',v_job.provider,
      'provider_job_id',v_job.provider_job_id,'asset_sha256',v_asset.sha256,
      'schema_version','music-simple-v1')) RETURNING id INTO v_version;
   END IF;
   IF v_prompt.mode<>'replace_section' THEN
    UPDATE public.music_songs SET current_version_id=v_version,updated_at=now() WHERE id=v_song;
   END IF;
   UPDATE public.music_generation_candidates SET status='ready',song_id=v_song,
    song_version_id=v_version,failure_code=NULL,updated_at=now() WHERE id=v_candidate.id;
  END IF;
 ELSIF v_job.state='REFUNDED' THEN UPDATE public.music_generation_candidates SET status='refunded',
  failure_code=v_job.error_code,updated_at=now() WHERE id=v_candidate.id AND status<>'ready';
 ELSIF v_job.state='FAILED' THEN UPDATE public.music_generation_candidates SET status='failed',
  failure_code=v_job.error_code,updated_at=now() WHERE id=v_candidate.id AND status<>'ready';
 ELSIF v_job.state IN ('SUBMITTED','SUCCEEDED') THEN UPDATE public.music_generation_candidates SET status='running',updated_at=now() WHERE id=v_candidate.id AND status='queued'; END IF;
 SELECT count(*) FILTER(WHERE status='ready'),count(*) FILTER(WHERE status IN ('ready','failed','refunded')),
 count(*) FILTER(WHERE status='refunded'),count(*) FILTER(WHERE status='running') INTO v_ready,v_terminal,v_refunded,v_running
 FROM public.music_generation_candidates WHERE generation_request_id=v_candidate.generation_request_id;
 v_request_status:=CASE WHEN v_ready=2 THEN 'succeeded' WHEN v_terminal=2 AND v_ready>0 THEN 'partial'
 WHEN v_terminal=2 AND v_refunded=2 THEN 'refunded' WHEN v_terminal=2 THEN 'failed' WHEN v_running>0 THEN 'running' ELSE 'debited' END;
 UPDATE public.music_generation_requests SET status=v_request_status,updated_at=now() WHERE id=v_candidate.generation_request_id;
 RETURN jsonb_build_object('ok',true,'projected',true,'status',v_request_status);
END $$;

CREATE OR REPLACE FUNCTION public.music_create_replace_quote(p_auth_id TEXT,p_song_id UUID,p_version_id UUID,
 p_prompt TEXT,p_start_seconds NUMERIC,p_end_seconds NUMERIC,p_rights_confirmed BOOLEAN,p_source_duration_seconds NUMERIC)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_model public.model_catalog%ROWTYPE; v_title TEXT; v_prompt UUID;
 v_quote public.music_generation_quotes%ROWTYPE; v_balance INTEGER;
BEGIN
 IF p_rights_confirmed IS DISTINCT FROM true OR char_length(btrim(COALESCE(p_prompt,''))) NOT BETWEEN 1 AND 500
 OR p_source_duration_seconds NOT BETWEEN 1 AND 60 OR p_start_seconds<0 OR p_end_seconds>p_source_duration_seconds
 OR p_end_seconds-p_start_seconds NOT BETWEEN 1 AND 30 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
 IF NOT private.music_paid_plan_active(v_user) THEN RETURN jsonb_build_object('ok',false,'code','PLAN_UNAVAILABLE'); END IF;
 SELECT s.title INTO v_title FROM public.music_songs s JOIN public.music_song_versions v
 ON v.id=p_version_id AND v.user_id=v_user AND v.song_id=s.id WHERE s.id=p_song_id AND s.user_id=v_user
 AND s.status='active' AND s.current_version_id=p_version_id FOR SHARE OF s,v;
 IF v_title IS NULL THEN RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); END IF;
 SELECT * INTO v_model FROM public.model_catalog WHERE id='ace-step-replace-section';
 IF NOT FOUND OR NOT v_model.active OR v_model.gated_flag OR v_model.provider<>'fal'
 OR v_model.provider_endpoint<>'fal-ai/ace-step/audio-inpaint' OR v_model.credits_5s<>1
 OR v_model.provider_cost_per_unit<>0.0120::numeric OR v_model.cost_unit<>'per_generation'
 OR v_model.billing_seconds IS NOT NULL OR v_model.modality<>'audio-to-audio' THEN
  RETURN jsonb_build_object('ok',false,'code','MODEL_UNAVAILABLE'); END IF;
 SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance
 FROM public.credit_balances WHERE user_id=v_user;
 INSERT INTO public.music_prompt_specs(user_id,mode,model_id,title,prompt,instrumental,schema_version,
  source_song_id,source_version_id,source_duration_seconds,source_rights_version,replace_start_seconds,replace_end_seconds)
 VALUES(v_user,'replace_section',v_model.id,v_title,btrim(p_prompt),true,'music-replace-section-v1',p_song_id,
  p_version_id,p_source_duration_seconds,'music-replace-source-rights-v1',p_start_seconds,p_end_seconds) RETURNING id INTO v_prompt;
 INSERT INTO public.music_generation_quotes(user_id,prompt_spec_id,model_id,provider_endpoint,unit_credits,total_credits,catalog_updated_at,expires_at)
 VALUES(v_user,v_prompt,v_model.id,v_model.provider_endpoint,1,2,v_model.updated_at,now()+interval '5 minutes') RETURNING * INTO v_quote;
 RETURN jsonb_build_object('ok',true,'quote_id',v_quote.id,'model_id',v_model.id,'unit_credits',1,'total_credits',2,
  'balance',v_balance,'balance_after',v_balance-2,'affordable',v_balance>=2,'expires_at',v_quote.expires_at,
  'source_duration_seconds',p_source_duration_seconds,'start_seconds',p_start_seconds,'end_seconds',p_end_seconds);
END $$;

REVOKE ALL ON FUNCTION public.music_get_replace_source_context(TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_create_replace_quote(TEXT,UUID,UUID,TEXT,NUMERIC,NUMERIC,BOOLEAN,NUMERIC) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_get_replace_dispatch_context(TEXT,UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_submit_replace_pair(TEXT,UUID,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_replace_source_context(TEXT,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_create_replace_quote(TEXT,UUID,UUID,TEXT,NUMERIC,NUMERIC,BOOLEAN,NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_get_replace_dispatch_context(TEXT,UUID,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_submit_replace_pair(TEXT,UUID,UUID,TEXT,TEXT) TO service_role;
