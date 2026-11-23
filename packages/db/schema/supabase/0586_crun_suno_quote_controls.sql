-- Phase C1: freeze the remaining Crun Suno v1 controls, project the current
-- version's authoritative asset facts, and fence local PCM edits by format.
-- Existing fal signatures remain unchanged compatibility entry points.

CREATE OR REPLACE FUNCTION public.music_get_crun_availability()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_admission BOOLEAN; v_endpoint BOOLEAN;
BEGIN
 SELECT admission_open INTO v_admission FROM public.provider_spend_provider_policy WHERE provider='crun';
 v_admission:=COALESCE(v_admission,false);
 SELECT NOT EXISTS(SELECT 1 FROM public.model_routes WHERE supplier='crun'
  AND endpoint='crun:suno/music-generate' AND breaker_opened_at IS NOT NULL) INTO v_endpoint;
 RETURN jsonb_build_object('ok',true,'admission_open',v_admission,'endpoint_open',v_endpoint,
  'suno_models',jsonb_build_object(
   'v6',NOT EXISTS(SELECT 1 FROM public.crun_suno_model_breakers WHERE endpoint='crun:suno/music-generate' AND suno_model='v6' AND is_open),
   'v6_mini',NOT EXISTS(SELECT 1 FROM public.crun_suno_model_breakers WHERE endpoint='crun:suno/music-generate' AND suno_model='v6_mini' AND is_open),
   'v6_wild',NOT EXISTS(SELECT 1 FROM public.crun_suno_model_breakers WHERE endpoint='crun:suno/music-generate' AND suno_model='v6_wild' AND is_open)));
END $$;
REVOKE ALL ON FUNCTION public.music_get_crun_availability() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_crun_availability() TO service_role;

CREATE OR REPLACE FUNCTION private.music_crun_quote_available(p_endpoint TEXT,p_suno_model TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_admission BOOLEAN;
BEGIN
 SELECT admission_open INTO v_admission FROM public.provider_spend_provider_policy WHERE provider='crun' FOR SHARE;
 IF NOT FOUND OR v_admission IS DISTINCT FROM true THEN RETURN false; END IF;
 PERFORM 1 FROM public.model_routes WHERE supplier='crun' AND endpoint=p_endpoint
  AND breaker_opened_at IS NOT NULL FOR SHARE;
 IF FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM public.crun_suno_model_breakers WHERE endpoint=p_endpoint AND suno_model=p_suno_model AND is_open FOR SHARE;
 RETURN NOT FOUND;
END $$;
REVOKE ALL ON FUNCTION private.music_crun_quote_available(TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.music_create_quote(
 p_auth_id TEXT,p_prompt TEXT,p_title TEXT,p_model_id TEXT,p_variety INTEGER,
 p_style_influence INTEGER,p_exclude_styles TEXT,p_duration_seconds INTEGER,
 p_provider_contract TEXT,p_instrumental BOOLEAN,p_suno_model TEXT,
 p_vocal_gender TEXT,p_weirdness NUMERIC
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result JSONB; v_spec UUID; v_custom BOOLEAN; v_active TEXT;
BEGIN
 IF p_provider_contract<>'crun-suno-v1'
  OR p_model_id NOT IN ('ace-step','ace-step-1.5') OR p_instrumental IS NULL
  OR (p_model_id='ace-step' AND NOT p_instrumental)
  OR p_suno_model NOT IN ('v6','v6_mini','v6_wild')
  OR p_vocal_gender NOT IN ('auto','male','female')
  OR (p_variety IS NOT NULL AND p_variety NOT BETWEEN 0 AND 100)
  OR (p_style_influence IS NOT NULL AND p_style_influence NOT BETWEEN 0 AND 100)
  OR (p_weirdness IS NOT NULL AND p_weirdness NOT BETWEEN 0 AND 1)
  OR (p_exclude_styles IS NOT NULL AND char_length(btrim(p_exclude_styles)) NOT BETWEEN 1 AND 1000)
  OR p_duration_seconds NOT BETWEEN 1 AND 135
 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 IF NOT private.music_crun_quote_available('crun:suno/music-generate',p_suno_model) THEN
  RETURN jsonb_build_object('ok',false,'code','MUSIC_UNAVAILABLE','retry_after_seconds',60); END IF;
 SELECT CASE provider_endpoint WHEN 'fal-ai/ace-step' THEN 'fal-ace-v1'
  WHEN 'fal-ai/ace-step-1.5' THEN 'fal-ace-v1'
  WHEN 'crun:suno/music-generate' THEN 'crun-suno-v1' END INTO v_active
 FROM public.model_catalog WHERE id=p_model_id AND active FOR SHARE;
 IF v_active IS DISTINCT FROM p_provider_contract THEN
  RETURN jsonb_build_object('ok',false,'code','CONTRACT_STALE'); END IF;
 v_custom:=NULLIF(btrim(COALESCE(p_title,'')),'') IS NOT NULL OR p_variety IS NOT NULL
  OR p_style_influence IS NOT NULL OR p_exclude_styles IS NOT NULL OR p_weirdness IS NOT NULL
  OR p_vocal_gender<>'auto' OR p_duration_seconds<>60;
 IF p_model_id='ace-step' AND v_custom THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 IF v_custom AND NOT p_instrumental THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;

 PERFORM set_config('veyrnox.crun_suno_model',p_suno_model,true);
 v_result:=public.music_create_quote(p_auth_id,p_prompt,p_title,p_model_id);
 PERFORM set_config('veyrnox.crun_suno_model','',true);
 IF v_result->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_result; END IF;
 IF v_result->>'provider_contract' IS DISTINCT FROM p_provider_contract THEN
  RAISE EXCEPTION 'music quote contract changed during creation'; END IF;
 SELECT q.prompt_spec_id INTO v_spec FROM public.music_generation_quotes q
 JOIN public.users u ON u.id=q.user_id
 WHERE q.id=(v_result->>'quote_id')::UUID AND u.auth_id=p_auth_id FOR UPDATE OF q;
 IF v_spec IS NULL THEN RAISE EXCEPTION 'music quote prompt snapshot missing'; END IF;
 UPDATE public.music_prompt_specs SET instrumental=p_instrumental,suno_model=p_suno_model,
  vocal_gender=p_vocal_gender,weirdness=p_weirdness,variety=p_variety,
  style_influence=p_style_influence,exclude_styles=NULLIF(btrim(p_exclude_styles),''),
  duration_seconds=p_duration_seconds WHERE id=v_spec AND provider_contract=p_provider_contract;
 IF NOT FOUND THEN RAISE EXCEPTION 'music quote prompt contract changed'; END IF;
 RETURN v_result||jsonb_build_object('mode',CASE WHEN v_custom THEN 'custom' ELSE 'simple' END,
  'instrumental',p_instrumental,'suno_model',p_suno_model,'vocal_gender',p_vocal_gender,
  'style_weight',CASE WHEN p_style_influence IS NULL THEN NULL ELSE p_style_influence::NUMERIC/100 END,
  'weirdness',p_weirdness,
  'variety',CASE WHEN p_variety IS NULL THEN NULL ELSE round(p_variety::NUMERIC/25)::INTEGER END,
  'duration_seconds',p_duration_seconds,
  'exclude_styles_applied_chars',CASE WHEN p_exclude_styles IS NULL THEN 0 ELSE LEAST(200,char_length(btrim(p_exclude_styles))) END);
END $$;
REVOKE ALL ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,TEXT,INTEGER,TEXT,BOOLEAN,TEXT,TEXT,NUMERIC)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_create_quote(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,TEXT,INTEGER,TEXT,BOOLEAN,TEXT,TEXT,NUMERIC)
 TO service_role;

CREATE OR REPLACE FUNCTION public.music_create_custom_quote(
 p_auth_id TEXT,p_provider_contract TEXT,p_draft_id UUID,p_draft_revision INTEGER,
 p_instrumental BOOLEAN,p_rights_confirmed BOOLEAN,p_duration_seconds INTEGER,
 p_suno_model TEXT,p_vocal_gender TEXT,p_style_influence INTEGER,p_weirdness NUMERIC,
 p_variety INTEGER,p_exclude_styles TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result JSONB; v_spec UUID;
BEGIN
 IF p_provider_contract<>'crun-suno-v1'
  OR p_suno_model NOT IN ('v6','v6_mini','v6_wild')
  OR p_vocal_gender NOT IN ('auto','male','female')
  OR (p_style_influence IS NOT NULL AND p_style_influence NOT BETWEEN 0 AND 100)
  OR (p_weirdness IS NOT NULL AND p_weirdness NOT BETWEEN 0 AND 1)
  OR (p_variety IS NOT NULL AND p_variety NOT BETWEEN 0 AND 100)
  OR (p_exclude_styles IS NOT NULL AND char_length(btrim(p_exclude_styles)) NOT BETWEEN 1 AND 1000)
 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 IF NOT private.music_crun_quote_available('crun:suno/music-generate',p_suno_model) THEN
  RETURN jsonb_build_object('ok',false,'code','MUSIC_UNAVAILABLE','retry_after_seconds',60); END IF;
 PERFORM set_config('veyrnox.crun_suno_model',p_suno_model,true);
 v_result:=public.music_create_custom_quote(p_auth_id,p_provider_contract,p_draft_id,
  p_draft_revision,p_instrumental,p_rights_confirmed,p_duration_seconds);
 PERFORM set_config('veyrnox.crun_suno_model','',true);
 IF v_result->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_result; END IF;
 IF v_result->>'provider_contract' IS DISTINCT FROM p_provider_contract THEN
  RAISE EXCEPTION 'music custom quote contract changed during creation'; END IF;
 SELECT q.prompt_spec_id INTO v_spec FROM public.music_generation_quotes q
 JOIN public.users u ON u.id=q.user_id
 WHERE q.id=(v_result->>'quote_id')::UUID AND u.auth_id=p_auth_id FOR UPDATE OF q;
 IF v_spec IS NULL THEN RAISE EXCEPTION 'music custom quote prompt snapshot missing'; END IF;
 UPDATE public.music_prompt_specs SET suno_model=p_suno_model,vocal_gender=p_vocal_gender,
  style_influence=p_style_influence,weirdness=p_weirdness,variety=p_variety,
  exclude_styles=NULLIF(btrim(p_exclude_styles),'')
 WHERE id=v_spec AND provider_contract=p_provider_contract;
 IF NOT FOUND THEN RAISE EXCEPTION 'music custom quote prompt contract changed'; END IF;
 RETURN v_result||jsonb_build_object('suno_model',p_suno_model,'vocal_gender',p_vocal_gender,
  'style_weight',CASE WHEN p_style_influence IS NULL THEN NULL ELSE p_style_influence::NUMERIC/100 END,
  'weirdness',p_weirdness,
  'variety',CASE WHEN p_variety IS NULL THEN NULL ELSE round(p_variety::NUMERIC/25)::INTEGER END,
  'exclude_styles_applied_chars',CASE WHEN p_exclude_styles IS NULL THEN 0 ELSE LEAST(200,char_length(btrim(p_exclude_styles))) END);
END $$;
REVOKE ALL ON FUNCTION public.music_create_custom_quote(TEXT,TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN,INTEGER,TEXT,TEXT,INTEGER,NUMERIC,INTEGER,TEXT)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_create_custom_quote(TEXT,TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN,INTEGER,TEXT,TEXT,INTEGER,NUMERIC,INTEGER,TEXT)
 TO service_role;

-- 0584 predates weirdness and vocal gender in its simple/custom decision.
-- Rewrite only the affected Crun outbox row from the frozen prompt spec; the
-- trigger fires in the same debit transaction and never touches fal payloads.
CREATE OR REPLACE FUNCTION private.music_crun_freeze_extra_controls()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.music_prompt_specs%ROWTYPE; input JSONB;
BEGIN
 IF NEW.endpoint<>'crun:suno/music-generate' OR NEW.payload#>>'{input,mode}'<>'simple' THEN RETURN NEW; END IF;
 SELECT ps.* INTO p FROM public.music_generation_candidates c
 JOIN public.music_generation_requests r ON r.id=c.generation_request_id
 JOIN public.music_prompt_specs ps ON ps.id=r.prompt_spec_id
 WHERE c.job_id=NEW.job_id;
 IF NOT FOUND OR (p.weirdness IS NULL AND COALESCE(p.vocal_gender,'auto')='auto') THEN RETURN NEW; END IF;
 input:=jsonb_strip_nulls(jsonb_build_object(
  'mode','custom','instrumental',p.instrumental,'suno_model',p.suno_model,
  'title',p.title,'tags',p.prompt,'lyrics',CASE WHEN p.instrumental THEN NULL ELSE p.lyrics END,
  'negative_tags',CASE WHEN p.exclude_styles IS NULL THEN NULL ELSE left(p.exclude_styles,200) END,
  'vocal_gender',CASE p.vocal_gender WHEN 'male' THEN 'm' WHEN 'female' THEN 'f' ELSE NULL END,
  'style_weight',CASE WHEN p.style_influence IS NULL THEN NULL ELSE round(p.style_influence::NUMERIC/100,2) END,
  'weirdness_constraint',p.weirdness,'duration',p.duration_seconds,
  'variety',CASE WHEN p.variety IS NULL THEN NULL ELSE round(p.variety::NUMERIC/25)::INTEGER END));
 NEW.payload:=jsonb_build_object('model','suno/music-generate','input',input);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.music_crun_freeze_extra_controls() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS music_crun_freeze_extra_controls ON public.crun_dispatch;
CREATE TRIGGER music_crun_freeze_extra_controls BEFORE INSERT ON public.crun_dispatch
 FOR EACH ROW EXECUTE FUNCTION private.music_crun_freeze_extra_controls();

-- The current version projection is based on its asset row, never its source
-- provider or operation. The route repeats the matrix before exposing actions.
CREATE OR REPLACE FUNCTION public.music_get_song(p_auth_id TEXT,p_song_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_row JSONB;
BEGIN
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 SELECT jsonb_build_object(
  'id',s.id,'title',s.title,'visibility',s.visibility,'created_at',s.created_at,
  'version_id',cv.id,'job_id',cv.job_id,'generation_id',cv.generation_request_id,
  'audio_url','/api/v1/jobs/'||cv.job_id||'/asset','provenance',cv.provenance,
  'current_version',jsonb_build_object(
    'id',cv.id,'version_number',cv.version_number,'operation',cv.operation,
    'parent_version_id',cv.parent_version_id,'created_at',cv.created_at,
    'mime_type',ca.mime_type,'size_bytes',ca.size_bytes,
    'capabilities',jsonb_build_object(
      'playback',COALESCE(ca.mime_type LIKE 'audio/%' AND ca.size_bytes>0,false),
      'download',COALESCE(ca.mime_type LIKE 'audio/%' AND ca.size_bytes>0,false),
      'render',COALESCE(ca.mime_type='audio/wav' AND ca.size_bytes<=26214400,false),
      'crop',COALESCE(ca.mime_type='audio/wav' AND ca.size_bytes<=26214400,false),
      'remix',COALESCE(ca.mime_type='audio/wav' AND ca.size_bytes<=26214400,false),
      'mashup',COALESCE(ca.mime_type='audio/wav' AND ca.size_bytes<=26214400,false),
      'sample',COALESCE(ca.mime_type='audio/wav' AND ca.size_bytes<=26214400,false),
      'stems',COALESCE(ca.mime_type IN ('audio/mpeg','audio/mp3') AND ca.size_bytes<=10485760,false),
      'target_stem',COALESCE(ca.mime_type IN ('audio/mpeg','audio/wav'),false),
      'track_add',COALESCE(ca.mime_type='audio/mpeg' AND ca.size_bytes<=10485760,false),
      'cover',COALESCE(ca.mime_type IN ('audio/mpeg','audio/wav'),false),
      'extend',COALESCE(ca.mime_type IN ('audio/mpeg','audio/wav'),false),
      'replace_section',COALESCE(ca.mime_type IN ('audio/mpeg','audio/wav'),false),
      'add_section',COALESCE(ca.mime_type IN ('audio/mpeg','audio/wav'),false))),
  'versions',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',v.id,'version_number',v.version_number,'operation',v.operation,
    'parent_version_id',v.parent_version_id,'is_current',v.id=s.current_version_id,
    'created_at',v.created_at) ORDER BY v.version_number DESC,v.id),'[]'::jsonb)
    FROM public.music_song_versions v WHERE v.song_id=s.id AND v.user_id=v_user),
  'lineage',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',e.id,'output_version_id',e.output_version_id,'source_version_id',e.source_version_id,
    'source_song_id',sv.song_id,'source_title',ss.title,'source_version_number',sv.version_number,
    'relation',e.relation,'ordinal',e.ordinal,'source_start_seconds',e.source_start_seconds,
    'source_end_seconds',e.source_end_seconds) ORDER BY ov.version_number DESC,e.ordinal),'[]'::jsonb)
    FROM public.music_version_sources e
    JOIN public.music_song_versions ov ON ov.id=e.output_version_id
    JOIN public.music_song_versions sv ON sv.id=e.source_version_id
    JOIN public.music_songs ss ON ss.id=sv.song_id
    WHERE ov.song_id=s.id AND e.user_id=v_user),
  'actions',jsonb_build_array('view_lineage','organize')) INTO v_row
 FROM public.music_songs s
 JOIN public.music_song_versions cv ON cv.id=s.current_version_id
 LEFT JOIN public.assets ca ON ca.id=cv.audio_asset_id
 WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active';
 IF v_row IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 RETURN jsonb_build_object('ok',true,'song',v_row);
END $$;
REVOKE ALL ON FUNCTION public.music_get_song(TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_song(TEXT,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.music_get_remix_source_context(
 p_auth_id TEXT,p_song_id UUID,p_version_id UUID,p_second_song_id UUID,p_second_version_id UUID
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_one JSONB; v_two JSONB;
BEGIN
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF (p_second_song_id IS NULL)<>(p_second_version_id IS NULL) OR p_second_song_id=p_song_id THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT jsonb_build_object('r2_key',a.r2_key,'mime_type',a.mime_type,'size_bytes',a.size_bytes,'title',s.title)
 INTO v_one FROM public.music_songs s
 JOIN public.music_song_versions v ON v.id=p_version_id AND v.user_id=v_user AND v.song_id=s.id
 JOIN public.assets a ON a.id=v.audio_asset_id
 WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active' AND s.current_version_id=p_version_id;
 IF v_one IS NULL THEN RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); END IF;
 IF p_second_song_id IS NOT NULL THEN
  SELECT jsonb_build_object('r2_key',a.r2_key,'mime_type',a.mime_type,'size_bytes',a.size_bytes,'title',s.title)
  INTO v_two FROM public.music_songs s
  JOIN public.music_song_versions v ON v.id=p_second_version_id AND v.user_id=v_user AND v.song_id=s.id
  JOIN public.assets a ON a.id=v.audio_asset_id
  WHERE s.id=p_second_song_id AND s.user_id=v_user AND s.status='active' AND s.current_version_id=p_second_version_id;
  IF v_two IS NULL THEN RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); END IF;
 END IF;
 IF v_one->>'mime_type'<>'audio/wav' OR (v_one->>'size_bytes')::BIGINT>26214400
  OR (v_two IS NOT NULL AND (v_two->>'mime_type'<>'audio/wav' OR (v_two->>'size_bytes')::BIGINT>26214400)) THEN
  RETURN jsonb_build_object('ok',false,'code','EDIT_UNAVAILABLE_FOR_FORMAT'); END IF;
 RETURN jsonb_build_object('ok',true,'user_id',v_user,'sources',
  CASE WHEN v_two IS NULL THEN jsonb_build_array(v_one) ELSE jsonb_build_array(v_one,v_two) END);
END $$;
REVOKE ALL ON FUNCTION public.music_get_remix_source_context(TEXT,UUID,UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_remix_source_context(TEXT,UUID,UUID,UUID,UUID) TO service_role;
