-- Explicitly choose one ready Replace Section branch without deleting its sibling.
CREATE TABLE IF NOT EXISTS public.music_replace_take_commits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    song_id UUID NOT NULL REFERENCES public.music_songs(id) ON DELETE CASCADE,
    generation_request_id UUID NOT NULL REFERENCES public.music_generation_requests(id) ON DELETE RESTRICT,
    chosen_version_id UUID NOT NULL REFERENCES public.music_song_versions(id) ON DELETE RESTRICT,
    idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._-]{8,120}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id,idempotency_key),
    UNIQUE(user_id,generation_request_id)
);
ALTER TABLE public.music_replace_take_commits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_replace_take_commits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.music_replace_take_commits FROM PUBLIC,anon,authenticated;

-- The owner-visible generation projection needs the immutable version UUID so
-- the browser can choose a ready take. It still exposes no storage identifier.
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
   'error_code',c.failure_code,
   'audio_url',CASE WHEN c.status='ready' THEN '/api/v1/jobs/'||c.job_id||'/asset' END
  ) ORDER BY c.ordinal),'[]'::jsonb) FROM public.music_generation_candidates c
   WHERE c.generation_request_id=r.id)) INTO v_row
 FROM public.music_generation_requests r JOIN public.music_prompt_specs p ON p.id=r.prompt_spec_id
 WHERE r.id=p_request_id AND r.user_id=v_user;
 IF v_row IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 RETURN jsonb_build_object('ok',true,'generation',v_row);
END $$;

CREATE OR REPLACE FUNCTION public.music_commit_replace_take(
 p_auth_id TEXT,p_song_id UUID,p_generation_request_id UUID,p_version_id UUID,p_idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_source UUID; v_current UUID; v_existing public.music_replace_take_commits%ROWTYPE;
BEGIN
 IF p_song_id IS NULL OR p_generation_request_id IS NULL OR p_version_id IS NULL
 OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
 END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id FOR UPDATE;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
 SELECT * INTO v_existing FROM public.music_replace_take_commits
 WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF v_existing.song_id IS DISTINCT FROM p_song_id
   OR v_existing.generation_request_id IS DISTINCT FROM p_generation_request_id
   OR v_existing.chosen_version_id IS DISTINCT FROM p_version_id THEN
   RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');
  END IF;
  RETURN jsonb_build_object('ok',true,'version_id',v_existing.chosen_version_id,'idempotent',true);
 END IF;
 SELECT ps.source_version_id INTO v_source FROM public.music_generation_requests r
 JOIN public.music_prompt_specs ps ON ps.id=r.prompt_spec_id AND ps.user_id=r.user_id
 WHERE r.id=p_generation_request_id AND r.user_id=v_user AND ps.mode='replace_section'
  AND ps.source_song_id=p_song_id FOR SHARE OF r,ps;
 IF v_source IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 SELECT current_version_id INTO v_current FROM public.music_songs
 WHERE id=p_song_id AND user_id=v_user AND status='active' FOR UPDATE;
 IF v_current IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 SELECT * INTO v_existing FROM public.music_replace_take_commits
 WHERE user_id=v_user AND generation_request_id=p_generation_request_id;
 IF FOUND THEN
  IF v_existing.chosen_version_id IS DISTINCT FROM p_version_id THEN
   RETURN jsonb_build_object('ok',false,'code','TAKE_COMMIT_CONFLICT');
  END IF;
  RETURN jsonb_build_object('ok',true,'version_id',v_existing.chosen_version_id,'idempotent',true);
 END IF;
 IF v_current IS DISTINCT FROM v_source AND v_current IS DISTINCT FROM p_version_id THEN
  RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT');
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.music_generation_candidates c
  JOIN public.music_song_versions v ON v.id=c.song_version_id AND v.user_id=c.user_id
  WHERE c.generation_request_id=p_generation_request_id AND c.user_id=v_user
   AND c.status='ready' AND c.song_id=p_song_id AND c.song_version_id=p_version_id
   AND v.song_id=p_song_id AND v.operation='replace_section' AND v.parent_version_id=v_source FOR SHARE OF c,v) THEN
  RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT');
 END IF;
 INSERT INTO public.music_replace_take_commits(user_id,song_id,generation_request_id,chosen_version_id,idempotency_key)
 VALUES(v_user,p_song_id,p_generation_request_id,p_version_id,p_idempotency_key);
 UPDATE public.music_songs SET current_version_id=p_version_id,updated_at=now()
 WHERE id=p_song_id AND user_id=v_user;
 RETURN jsonb_build_object('ok',true,'version_id',p_version_id,'idempotent',false);
END $$;

REVOKE ALL ON FUNCTION public.music_commit_replace_take(TEXT,UUID,UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_commit_replace_take(TEXT,UUID,UUID,UUID,TEXT) TO service_role;
