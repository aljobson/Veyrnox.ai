-- Owner-only reuse copies prompt material into the revisioned Custom draft.
-- It does not submit a provider job, spend credits, or copy another creator.
CREATE TABLE IF NOT EXISTS public.music_reuse_draft_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    source_song_id UUID NOT NULL REFERENCES public.music_songs(id) ON DELETE CASCADE,
    source_version_id UUID NOT NULL REFERENCES public.music_song_versions(id) ON DELETE RESTRICT,
    reuse_lyrics BOOLEAN NOT NULL,
    reuse_styles BOOLEAN NOT NULL,
    idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._-]{8,120}$'),
    result_draft JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id,idempotency_key)
);
ALTER TABLE public.music_reuse_draft_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_reuse_draft_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.music_reuse_draft_receipts FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.music_get_reuse_draft_context(
 p_auth_id TEXT,p_song_id UUID,p_version_id UUID
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_prompt public.music_prompt_specs%ROWTYPE; v_title TEXT; v_revision INTEGER;
 v_lyrics TEXT; v_styles TEXT;
BEGIN
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
 SELECT ps,s.title INTO v_prompt,v_title FROM public.music_songs s
 JOIN public.music_song_versions v ON v.id=p_version_id AND v.user_id=v_user AND v.song_id=s.id
 JOIN public.music_generation_requests r ON r.id=v.generation_request_id AND r.user_id=v_user
 JOIN public.music_prompt_specs ps ON ps.id=r.prompt_spec_id AND ps.user_id=v_user
 WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active' AND s.current_version_id=p_version_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); END IF;
 v_lyrics:=COALESCE(v_prompt.lyrics,'');
 v_styles:=COALESCE(NULLIF(v_prompt.styles,''),NULLIF(v_prompt.prompt,''),'');
 IF v_lyrics='' AND v_styles='' THEN RETURN jsonb_build_object('ok',false,'code','REUSE_UNAVAILABLE'); END IF;
 SELECT revision INTO v_revision FROM public.music_lyric_drafts WHERE user_id=v_user;
 RETURN jsonb_build_object('ok',true,'source',jsonb_build_object(
  'song_id',p_song_id,'version_id',p_version_id,'title',v_title,'source_mode',v_prompt.mode,
  'lyrics',v_lyrics,'styles',v_styles,'has_lyrics',v_lyrics<>'','has_styles',v_styles<>''),
  'draft_revision',COALESCE(v_revision,0));
END $$;

CREATE OR REPLACE FUNCTION public.music_apply_reuse_to_draft(
 p_auth_id TEXT,p_song_id UUID,p_version_id UUID,p_expected_revision INTEGER,
 p_reuse_lyrics BOOLEAN,p_reuse_styles BOOLEAN,p_idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_prompt public.music_prompt_specs%ROWTYPE; v_draft public.music_lyric_drafts%ROWTYPE;
 v_receipt public.music_reuse_draft_receipts%ROWTYPE; v_lyrics TEXT; v_styles TEXT; v_result JSONB;
BEGIN
 IF p_song_id IS NULL OR p_version_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<0
 OR p_reuse_lyrics IS NULL OR p_reuse_styles IS NULL OR (NOT p_reuse_lyrics AND NOT p_reuse_styles)
 OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
 END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id FOR UPDATE;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
 SELECT * INTO v_receipt FROM public.music_reuse_draft_receipts
 WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF v_receipt.source_song_id IS DISTINCT FROM p_song_id
   OR v_receipt.source_version_id IS DISTINCT FROM p_version_id
   OR v_receipt.reuse_lyrics IS DISTINCT FROM p_reuse_lyrics
   OR v_receipt.reuse_styles IS DISTINCT FROM p_reuse_styles THEN
   RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');
  END IF;
  RETURN jsonb_build_object('ok',true,'draft',v_receipt.result_draft,'idempotent',true);
 END IF;
 SELECT ps.* INTO v_prompt FROM public.music_songs s
 JOIN public.music_song_versions v ON v.id=p_version_id AND v.user_id=v_user AND v.song_id=s.id
 JOIN public.music_generation_requests r ON r.id=v.generation_request_id AND r.user_id=v_user
 JOIN public.music_prompt_specs ps ON ps.id=r.prompt_spec_id AND ps.user_id=v_user
 WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active' AND s.current_version_id=p_version_id FOR SHARE OF s,v,r,ps;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); END IF;
 v_lyrics:=COALESCE(v_prompt.lyrics,'');
 v_styles:=COALESCE(NULLIF(v_prompt.styles,''),NULLIF(v_prompt.prompt,''),'');
 IF (p_reuse_lyrics AND v_lyrics='') OR (p_reuse_styles AND v_styles='') THEN
  RETURN jsonb_build_object('ok',false,'code','REUSE_UNAVAILABLE');
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.model_catalog WHERE id='ace-step-1.5' AND active
  AND NOT gated_flag AND modality='text-to-audio' FOR SHARE) THEN
  RETURN jsonb_build_object('ok',false,'code','MODEL_UNAVAILABLE');
 END IF;
 INSERT INTO public.music_lyric_drafts(user_id,model_id) VALUES(v_user,'ace-step-1.5')
 ON CONFLICT(user_id) DO NOTHING;
 SELECT * INTO v_draft FROM public.music_lyric_drafts WHERE user_id=v_user FOR UPDATE;
 IF v_draft.revision IS DISTINCT FROM p_expected_revision THEN
  RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT','draft',jsonb_build_object(
   'id',v_draft.id,'model_id',v_draft.model_id,'lyrics',v_draft.lyrics,'styles',v_draft.styles,
   'title',v_draft.title,'revision',v_draft.revision,'updated_at',v_draft.updated_at));
 END IF;
 UPDATE public.music_lyric_drafts SET model_id='ace-step-1.5',
  lyrics=CASE WHEN p_reuse_lyrics THEN v_lyrics ELSE lyrics END,
  styles=CASE WHEN p_reuse_styles THEN v_styles ELSE styles END,
  revision=revision+1,updated_at=now() WHERE id=v_draft.id RETURNING * INTO v_draft;
 v_result:=jsonb_build_object('id',v_draft.id,'model_id',v_draft.model_id,
  'lyrics',v_draft.lyrics,'styles',v_draft.styles,'title',v_draft.title,
  'revision',v_draft.revision,'updated_at',v_draft.updated_at);
 INSERT INTO public.music_reuse_draft_receipts(user_id,source_song_id,source_version_id,
  reuse_lyrics,reuse_styles,idempotency_key,result_draft)
 VALUES(v_user,p_song_id,p_version_id,p_reuse_lyrics,p_reuse_styles,p_idempotency_key,v_result);
 RETURN jsonb_build_object('ok',true,'draft',v_result,'idempotent',false);
END $$;

REVOKE ALL ON FUNCTION public.music_get_reuse_draft_context(TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_apply_reuse_to_draft(TEXT,UUID,UUID,INTEGER,BOOLEAN,BOOLEAN,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_reuse_draft_context(TEXT,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_apply_reuse_to_draft(TEXT,UUID,UUID,INTEGER,BOOLEAN,BOOLEAN,TEXT) TO service_role;
