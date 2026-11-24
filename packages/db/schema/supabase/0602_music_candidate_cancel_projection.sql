-- Preserve the exact zero-credit versus paid refund truth after a cancelled
-- Music candidate is reloaded. The cancel mutation remains the existing,
-- default-off, atomically locked job cancellation path.
CREATE OR REPLACE FUNCTION public.music_get_generation(p_auth_id TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_row JSONB; v_job UUID;
BEGIN
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 FOR v_job IN SELECT job_id FROM public.music_generation_candidates
  WHERE generation_request_id=p_request_id AND user_id=v_user LOOP
  PERFORM public.music_project_candidate(v_job);
 END LOOP;
 SELECT jsonb_build_object('id',r.id,'state',r.status,'model_id',r.model_id,
  'prompt',p.prompt,'title',p.title,'total_credits',r.credit_quote,'created_at',r.created_at,
  'candidates',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'ordinal',c.ordinal,'label',CASE c.ordinal WHEN 1 THEN 'A' ELSE 'B' END,
   'state',c.status,'job_id',c.job_id,'song_id',c.song_id,'version_id',c.song_version_id,
   'error_code',c.failure_code,'credits',j.credits,
   'audio_url',CASE WHEN c.status='ready' THEN '/api/v1/jobs/'||c.job_id||'/asset' END
  ) ORDER BY c.ordinal),'[]'::jsonb) FROM public.music_generation_candidates c
   JOIN public.jobs j ON j.id=c.job_id AND j.user_id=c.user_id
   WHERE c.generation_request_id=r.id)) INTO v_row
 FROM public.music_generation_requests r JOIN public.music_prompt_specs p ON p.id=r.prompt_spec_id
 WHERE r.id=p_request_id AND r.user_id=v_user;
 IF v_row IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 RETURN jsonb_build_object('ok',true,'generation',v_row);
END $$;

REVOKE ALL ON FUNCTION public.music_get_generation(TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_generation(TEXT,UUID) TO service_role;
