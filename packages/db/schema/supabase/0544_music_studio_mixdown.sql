-- ADR-0346. Local, zero-credit mixdowns; beatLibrarySave remains absent/off.
-- Latest writer audit (all INSERTs, including historical definitions):
-- music_project_candidate (0531): creates its own paid request; unaffected.
-- music_crop_song (0464), music_commit_rendered_wav_crop (0472),
-- music_commit_reordered_wav (0485), music_commit_local_wav_render (0534):
-- copy request + set parent; work unchanged for mixdown descendants.
-- Latest reader audit: music_list_songs (0457), music_get_song (0460), workspace,
-- library, share, export and privacy projections do not require a request join.
-- music_get_publication_context (0463): LEFT JOIN below; prompt may be NULL.
-- music_get_reuse_draft_context / music_apply_reuse_to_draft (0484): explicitly
-- refuse NULL-request sources with REUSE_UNAVAILABLE (below).
-- music_version_lyrics (0535): absent lyrics return NULL; LEFT JOIN below.
-- music_publication_words (0516), music_best_of_playlists (0535): already LEFT JOIN.
-- Cover/extend/replace/add-section/stems/target-stems/track-add/mashup/sample
-- source readers use versions/assets, not the source request; work unchanged.
-- Their dispatch/submit readers join the NEW paid request, never the source's.
-- music_commit_replace_take (0483) checks the new paid request; unaffected.
-- music_apply_variety_to_dispatch (0514) uses a paid candidate, not a mixdown.
-- jobs.model_id is TEXT without a catalog FK (0001); no catalog row or price.
-- Privacy: reservations are upload receipts, erased with the account. Their
-- retained payload duplicates the immutable version provenance; no new JWT surface.

ALTER TABLE public.music_song_versions ALTER COLUMN generation_request_id DROP NOT NULL;
ALTER TABLE public.music_song_versions DROP CONSTRAINT IF EXISTS music_song_versions_request_or_mixdown;
ALTER TABLE public.music_song_versions ADD CONSTRAINT music_song_versions_request_or_mixdown
 CHECK (generation_request_id IS NOT NULL OR operation='studio_mixdown' OR parent_version_id IS NOT NULL) NOT VALID;
ALTER TABLE public.music_song_versions VALIDATE CONSTRAINT music_song_versions_request_or_mixdown;
CREATE OR REPLACE FUNCTION private.music_version_request_lineage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.generation_request_id IS NULL AND NEW.operation <> 'studio_mixdown' AND NOT EXISTS (
   SELECT 1 FROM public.music_song_versions WHERE id=NEW.parent_version_id AND user_id=NEW.user_id AND generation_request_id IS NULL
 ) THEN RAISE EXCEPTION 'MIXDOWN_LINEAGE_REQUIRED' USING ERRCODE='check_violation'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS music_version_request_lineage ON public.music_song_versions;
CREATE TRIGGER music_version_request_lineage BEFORE INSERT ON public.music_song_versions
 FOR EACH ROW EXECUTE FUNCTION private.music_version_request_lineage();
REVOKE ALL ON FUNCTION private.music_version_request_lineage() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.music_version_request_lineage() TO service_role;
ALTER TABLE public.music_song_versions DROP CONSTRAINT IF EXISTS music_song_versions_operation_check;
ALTER TABLE public.music_song_versions ADD CONSTRAINT music_song_versions_operation_check CHECK (operation IN (
 'generation','cover','extend','speed','fade','reorder','reuse','crop','replace_section','add_section','remaster','lyric_edit','mashup','sample','reverse','studio_mixdown'));
ALTER TABLE public.music_version_sources DROP CONSTRAINT IF EXISTS music_version_sources_relation_check;
ALTER TABLE public.music_version_sources ADD CONSTRAINT music_version_sources_relation_check CHECK (relation IN (
 'cover_source','extend_source','speed_source','reuse_source','edit_source','sample_source','mashup_source','inspiration_source','mix_source'));
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_credits_check;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_credits_check CHECK (credits>0 OR free_allowance OR (
 credits=0 AND model_id IN ('music-local-crop','music-local-fade','music-local-speed','music-local-reorder','music-local-remaster','music-local-reverse','music-local-mixdown')
 AND provider='local' AND state='STORED'));

CREATE TABLE IF NOT EXISTS public.music_mixdown_reservations (
 user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._-]{8,120}$'),
 song_id UUID NOT NULL, version_id UUID NOT NULL UNIQUE, job_id UUID NOT NULL, asset_id UUID NOT NULL,
 r2_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
 size_bytes BIGINT NOT NULL CHECK (size_bytes BETWEEN 44 AND 26214400),
 sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
 duration_seconds NUMERIC NOT NULL CHECK (duration_seconds>0 AND duration_seconds<=600),
 sources JSONB NOT NULL CHECK (jsonb_typeof(sources)='array' AND jsonb_array_length(sources)<=16),
 has_takes BOOLEAN NOT NULL, rights_confirmed BOOLEAN NOT NULL,
 rights_version TEXT CHECK (rights_version='music-mixdown-rights-v1'),
 status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','committed','abandoned','expired')),
 committed_duration NUMERIC, closed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 upload_expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '15 minutes',
 expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '1 hour',
 PRIMARY KEY(user_id,idempotency_key),
 CHECK (has_takes=rights_confirmed AND (has_takes=(rights_version IS NOT NULL)))
);
ALTER TABLE public.music_mixdown_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_mixdown_reservations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.music_mixdown_reservations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.music_mixdown_reservations TO service_role;
CREATE INDEX IF NOT EXISTS music_mixdown_expiry_idx ON public.music_mixdown_reservations(expires_at) WHERE status='reserved';

CREATE OR REPLACE FUNCTION public.music_reserve_mixdown(
 p_auth_id TEXT,p_song_id UUID,p_version_id UUID,p_job_id UUID,p_asset_id UUID,p_idempotency_key TEXT,
 p_title TEXT,p_size_bytes BIGINT,p_sha256 TEXT,p_duration NUMERIC,p_sources JSONB,p_has_takes BOOLEAN,p_rights_confirmed BOOLEAN
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u public.users%ROWTYPE; r public.music_mixdown_reservations%ROWTYPE; source JSONB; replay BOOLEAN:=false;
BEGIN
 IF p_song_id IS NULL OR p_version_id IS NULL OR p_job_id IS NULL OR p_asset_id IS NULL
 OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$'
 OR p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 80
 OR p_size_bytes IS NULL OR p_size_bytes NOT BETWEEN 44 AND 26214400
 OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' OR p_duration IS NULL OR NOT(p_duration>0 AND p_duration<=600)
 OR jsonb_typeof(p_sources) IS DISTINCT FROM 'array' OR p_has_takes IS NULL OR p_rights_confirmed IS NULL THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 IF p_has_takes IS DISTINCT FROM p_rights_confirmed THEN RETURN jsonb_build_object('ok',false,'code','RIGHTS_REQUIRED'); END IF;
 IF jsonb_array_length(p_sources)>16 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 FOR source IN SELECT value FROM jsonb_array_elements(p_sources) LOOP
  IF jsonb_typeof(source) IS DISTINCT FROM 'object' OR source - ARRAY['song_id','version_id'] <> '{}'::jsonb
  OR coalesce(source->>'song_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  OR coalesce(source->>'version_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
   RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 END LOOP;
 IF (SELECT count(DISTINCT (value->>'version_id')::uuid) FROM jsonb_array_elements(p_sources))<>jsonb_array_length(p_sources) THEN
  RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT * INTO u FROM public.users WHERE auth_id=p_auth_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 SELECT * INTO r FROM public.music_mixdown_reservations WHERE user_id=u.id AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF FOUND THEN
  IF r.title IS DISTINCT FROM p_title OR r.size_bytes IS DISTINCT FROM p_size_bytes OR r.sha256 IS DISTINCT FROM p_sha256
  OR r.duration_seconds IS DISTINCT FROM p_duration OR r.sources IS DISTINCT FROM p_sources
  OR r.has_takes IS DISTINCT FROM p_has_takes OR r.rights_confirmed IS DISTINCT FROM p_rights_confirmed THEN
   RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  IF r.status='committed' THEN RETURN jsonb_build_object('ok',true,'status',r.status,'idempotent',true,'song_id',r.song_id,'version_id',r.version_id); END IF;
  IF r.status<>'reserved' THEN RETURN jsonb_build_object('ok',false,'code','RESERVATION_CLOSED'); END IF;
  IF now()+interval '15 minutes'>r.expires_at THEN RETURN jsonb_build_object('ok',false,'code','RESERVATION_EXPIRED'); END IF;
  replay:=true;
 END IF;
 IF u.frozen_at IS NOT NULL OR u.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','ACCOUNT_FROZEN'); END IF;
 FOR source IN SELECT value FROM jsonb_array_elements(p_sources) LOOP
  PERFORM 1 FROM public.music_song_versions v JOIN public.music_songs s ON s.id=v.song_id AND s.user_id=v.user_id
   WHERE v.id=(source->>'version_id')::uuid AND s.id=(source->>'song_id')::uuid AND v.user_id=u.id AND s.status='active' FOR SHARE OF s;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','SOURCE_UNAVAILABLE'); END IF;
 END LOOP;
 IF NOT replay THEN
  IF (SELECT count(*) FROM public.music_mixdown_reservations WHERE user_id=u.id AND status='reserved' AND created_at>now()-interval '1 hour')>=20 THEN
   RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED'); END IF;
  INSERT INTO public.music_mixdown_reservations(user_id,idempotency_key,song_id,version_id,job_id,asset_id,r2_key,title,size_bytes,sha256,duration_seconds,sources,has_takes,rights_confirmed,rights_version)
  VALUES(u.id,p_idempotency_key,p_song_id,p_version_id,p_job_id,p_asset_id,'music-renders/'||u.id||'/'||p_version_id||'.wav',p_title,p_size_bytes,p_sha256,p_duration,p_sources,p_has_takes,p_rights_confirmed,
   CASE WHEN p_has_takes THEN 'music-mixdown-rights-v1' END) RETURNING * INTO r;
 END IF;
 UPDATE public.music_mixdown_reservations SET upload_expires_at=greatest(upload_expires_at,now()+interval '15 minutes')
  WHERE user_id=u.id AND idempotency_key=p_idempotency_key RETURNING * INTO r;
 RETURN jsonb_build_object('ok',true,'status','reserved','idempotent',replay,'song_id',r.song_id,'version_id',r.version_id,
  'job_id',r.job_id,'asset_id',r.asset_id,'r2_key',r.r2_key,'upload_expires_at',r.upload_expires_at);
END $$;

CREATE OR REPLACE FUNCTION public.music_read_mixdown(p_auth_id TEXT,p_idempotency_key TEXT,p_version_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.music_mixdown_reservations%ROWTYPE;
BEGIN
 SELECT x.* INTO r FROM public.music_mixdown_reservations x JOIN public.users u ON u.id=x.user_id
 WHERE u.auth_id=p_auth_id AND x.idempotency_key=p_idempotency_key AND x.version_id=p_version_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF r.status NOT IN ('reserved','committed') THEN RETURN jsonb_build_object('ok',false,'code','RESERVATION_CLOSED'); END IF;
 IF r.status='reserved' AND now()>r.expires_at THEN RETURN jsonb_build_object('ok',false,'code','RESERVATION_EXPIRED'); END IF;
 RETURN jsonb_build_object('ok',true,'status',r.status,'song_id',r.song_id,'version_id',r.version_id,
  'r2_key',r.r2_key,'size_bytes',r.size_bytes,'sha256',r.sha256,'duration_seconds',r.duration_seconds);
END $$;

CREATE OR REPLACE FUNCTION public.music_commit_mixdown(p_auth_id TEXT,p_idempotency_key TEXT,p_version_id UUID,p_size_bytes BIGINT,p_sha256 TEXT,p_duration NUMERIC)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u public.users%ROWTYPE; r public.music_mixdown_reservations%ROWTYPE; source JSONB; position INTEGER:=0;
BEGIN
 SELECT * INTO u FROM public.users WHERE auth_id=p_auth_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 SELECT * INTO r FROM public.music_mixdown_reservations WHERE user_id=u.id AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF r.version_id IS DISTINCT FROM p_version_id OR r.size_bytes IS DISTINCT FROM p_size_bytes OR r.sha256 IS DISTINCT FROM p_sha256
 OR p_duration IS NULL OR NOT(p_duration>0 AND p_duration<=600) OR abs(r.duration_seconds-p_duration)>0.05 THEN
  RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
 IF r.status='committed' THEN
  IF r.committed_duration IS DISTINCT FROM p_duration THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  RETURN jsonb_build_object('ok',true,'idempotent',true,'song_id',r.song_id,'version_id',r.version_id); END IF;
 IF r.status<>'reserved' THEN RETURN jsonb_build_object('ok',false,'code','RESERVATION_CLOSED'); END IF;
 IF now()>r.expires_at THEN RETURN jsonb_build_object('ok',false,'code','RESERVATION_EXPIRED'); END IF;
 IF u.frozen_at IS NOT NULL OR u.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','ACCOUNT_FROZEN'); END IF;
 FOR source IN SELECT value FROM jsonb_array_elements(r.sources) LOOP
  PERFORM 1 FROM public.music_song_versions v JOIN public.music_songs s ON s.id=v.song_id AND s.user_id=v.user_id
   WHERE v.id=(source->>'version_id')::uuid AND s.id=(source->>'song_id')::uuid AND v.user_id=u.id AND s.status='active' FOR SHARE OF s;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','SOURCE_UNAVAILABLE'); END IF;
 END LOOP;
 INSERT INTO public.jobs(id,user_id,idempotency_key,model_id,credits,state,provider,provider_job_id,inputs)
 VALUES(r.job_id,u.id,'music-mixdown-'||md5(u.id::text||':'||p_idempotency_key),'music-local-mixdown',0,'STORED','local',r.version_id::text,'{}');
 INSERT INTO public.assets(id,job_id,r2_key,mime_type,size_bytes,sha256)
 VALUES(r.asset_id,r.job_id,r.r2_key,'audio/wav',r.size_bytes,r.sha256);
 INSERT INTO public.music_songs(id,user_id,title,visibility,status) VALUES(r.song_id,u.id,r.title,'private','active');
 INSERT INTO public.music_song_versions(id,user_id,song_id,generation_request_id,job_id,audio_asset_id,version_number,operation,provenance)
 VALUES(r.version_id,u.id,r.song_id,NULL,r.job_id,r.asset_id,1,'studio_mixdown',jsonb_build_object(
  'studio_mixdown',jsonb_build_object('duration',p_duration,'sources_count',jsonb_array_length(r.sources),'has_takes',r.has_takes,'rights_version',r.rights_version),
  'render_state','canonical','asset_sha256',r.sha256,'renderer','beat-editor-offline-v1'));
 FOR source IN SELECT value FROM jsonb_array_elements(r.sources) LOOP
  position:=position+1;
  INSERT INTO public.music_version_sources(user_id,output_version_id,source_version_id,relation,ordinal)
  VALUES(u.id,r.version_id,(source->>'version_id')::uuid,'mix_source',position);
 END LOOP;
 UPDATE public.music_songs SET current_version_id=r.version_id,updated_at=now() WHERE id=r.song_id;
 UPDATE public.music_mixdown_reservations SET status='committed',committed_duration=p_duration,closed_at=now() WHERE user_id=u.id AND idempotency_key=p_idempotency_key;
 RETURN jsonb_build_object('ok',true,'idempotent',false,'song_id',r.song_id,'version_id',r.version_id);
END $$;

CREATE OR REPLACE FUNCTION public.music_abandon_mixdown(p_auth_id TEXT,p_idempotency_key TEXT,p_version_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor UUID; r public.music_mixdown_reservations%ROWTYPE;
BEGIN
 SELECT id INTO actor FROM public.users WHERE auth_id=p_auth_id FOR UPDATE;
 SELECT * INTO r FROM public.music_mixdown_reservations WHERE user_id=actor AND idempotency_key=p_idempotency_key AND version_id=p_version_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 IF r.status<>'reserved' THEN RETURN jsonb_build_object('ok',false,'code','RESERVATION_CLOSED'); END IF;
 UPDATE public.music_mixdown_reservations SET status='abandoned',closed_at=now() WHERE user_id=actor AND idempotency_key=p_idempotency_key AND version_id=p_version_id;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION private.reap_music_mixdown() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.status='reserved' AND NEW.status IN ('abandoned','expired') THEN
  INSERT INTO public.asset_reap_queue(r2_key,not_before) VALUES(NEW.r2_key,greatest(now(),NEW.upload_expires_at+interval '5 minutes'))
  ON CONFLICT(r2_key) DO UPDATE SET not_before=greatest(public.asset_reap_queue.not_before,EXCLUDED.not_before);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS music_mixdown_reap ON public.music_mixdown_reservations;
CREATE TRIGGER music_mixdown_reap AFTER UPDATE OF status ON public.music_mixdown_reservations FOR EACH ROW EXECUTE FUNCTION private.reap_music_mixdown();
CREATE OR REPLACE FUNCTION public.music_expire_mixdown_reservations() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 WITH expired AS (SELECT user_id,idempotency_key FROM public.music_mixdown_reservations WHERE status='reserved' AND expires_at<now() FOR UPDATE SKIP LOCKED)
 UPDATE public.music_mixdown_reservations r SET status='expired',closed_at=now() FROM expired e WHERE r.user_id=e.user_id AND r.idempotency_key=e.idempotency_key;
 DELETE FROM public.music_mixdown_reservations WHERE status IN ('abandoned','expired') AND closed_at<now()-interval '30 days';
END $$;
CREATE OR REPLACE FUNCTION private.music_mixdowns_forget_erased() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
  -- The erasure writer already holds this user's row; acquire reservations second.
  UPDATE public.music_mixdown_reservations SET status='expired',closed_at=now() WHERE user_id=NEW.id AND status='reserved';
  DELETE FROM public.music_mixdown_reservations WHERE user_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS users_music_mixdowns_forget_erased ON public.users;
CREATE TRIGGER users_music_mixdowns_forget_erased AFTER UPDATE OF deleted_at ON public.users FOR EACH ROW EXECUTE FUNCTION private.music_mixdowns_forget_erased();
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN RETURN; END IF;
 PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname='veyrnox-expire-mixdowns';
 PERFORM cron.schedule('veyrnox-expire-mixdowns','*/10 * * * *',$cmd$ SELECT public.music_expire_mixdown_reservations(); $cmd$);
END $$;
REVOKE ALL ON FUNCTION public.music_reserve_mixdown(TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,BIGINT,TEXT,NUMERIC,JSONB,BOOLEAN,BOOLEAN) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_reserve_mixdown(TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,BIGINT,TEXT,NUMERIC,JSONB,BOOLEAN,BOOLEAN) TO service_role;
REVOKE ALL ON FUNCTION public.music_read_mixdown(TEXT,TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_read_mixdown(TEXT,TEXT,UUID) TO service_role;
REVOKE ALL ON FUNCTION public.music_commit_mixdown(TEXT,TEXT,UUID,BIGINT,TEXT,NUMERIC) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_commit_mixdown(TEXT,TEXT,UUID,BIGINT,TEXT,NUMERIC) TO service_role;
REVOKE ALL ON FUNCTION public.music_abandon_mixdown(TEXT,TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_abandon_mixdown(TEXT,TEXT,UUID) TO service_role;
REVOKE ALL ON FUNCTION public.music_expire_mixdown_reservations() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_expire_mixdown_reservations() TO service_role;
REVOKE ALL ON FUNCTION private.reap_music_mixdown() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.reap_music_mixdown() TO service_role;
REVOKE ALL ON FUNCTION private.music_mixdowns_forget_erased() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.music_mixdowns_forget_erased() TO service_role;

-- Copied from 0463_music_publication.sql; only nullable-request/erasure handling changes.
CREATE OR REPLACE FUNCTION public.music_get_publication_context(p_auth_id TEXT,p_song_id UUID,p_version_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row JSONB; BEGIN
    SELECT jsonb_build_object('ok',true,'title',s.title,'prompt',ps.prompt)
    INTO v_row
    FROM public.users u
    JOIN public.music_songs s ON s.user_id=u.id
    JOIN public.music_song_versions v ON v.id=p_version_id AND v.user_id=u.id AND v.song_id=s.id
    LEFT JOIN public.music_generation_requests gr ON gr.id=v.generation_request_id
    LEFT JOIN public.music_prompt_specs ps ON ps.id=gr.prompt_spec_id
    WHERE u.auth_id=p_auth_id AND s.id=p_song_id AND s.current_version_id=p_version_id AND s.status='active';
    RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','NOT_FOUND'));
END $$;
REVOKE ALL ON FUNCTION public.music_get_publication_context(TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_publication_context(TEXT,UUID,UUID) TO service_role;

-- Copied from 0484_music_reuse_draft.sql; only nullable-request/erasure handling changes.
CREATE OR REPLACE FUNCTION public.music_get_reuse_draft_context(
 p_auth_id TEXT,p_song_id UUID,p_version_id UUID
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_prompt public.music_prompt_specs%ROWTYPE; v_title TEXT; v_revision INTEGER;
 v_lyrics TEXT; v_styles TEXT;
BEGIN
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
 IF EXISTS(SELECT 1 FROM public.music_song_versions v JOIN public.music_songs s ON s.id=v.song_id
  WHERE v.id=p_version_id AND v.song_id=p_song_id AND v.user_id=v_user AND s.user_id=v_user
   AND s.status='active' AND v.generation_request_id IS NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','REUSE_UNAVAILABLE'); END IF;
 SELECT ps.* INTO v_prompt FROM public.music_songs s
 JOIN public.music_song_versions v ON v.id=p_version_id AND v.user_id=v_user AND v.song_id=s.id
 JOIN public.music_generation_requests r ON r.id=v.generation_request_id AND r.user_id=v_user
 JOIN public.music_prompt_specs ps ON ps.id=r.prompt_spec_id AND ps.user_id=v_user
 WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active' AND s.current_version_id=p_version_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); END IF;
 SELECT title INTO v_title FROM public.music_songs WHERE id=p_song_id AND user_id=v_user;
 v_lyrics:=COALESCE(v_prompt.lyrics,'');
 v_styles:=COALESCE(NULLIF(v_prompt.styles,''),NULLIF(v_prompt.prompt,''),'');
 IF v_lyrics='' AND v_styles='' THEN RETURN jsonb_build_object('ok',false,'code','REUSE_UNAVAILABLE'); END IF;
 SELECT revision INTO v_revision FROM public.music_lyric_drafts WHERE user_id=v_user;
 RETURN jsonb_build_object('ok',true,'source',jsonb_build_object(
  'song_id',p_song_id,'version_id',p_version_id,'title',v_title,'source_mode',v_prompt.mode,
  'lyrics',v_lyrics,'styles',v_styles,'has_lyrics',v_lyrics<>'','has_styles',v_styles<>''),
  'draft_revision',COALESCE(v_revision,0));
END $$;
REVOKE ALL ON FUNCTION public.music_get_reuse_draft_context(TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_reuse_draft_context(TEXT,UUID,UUID) TO service_role;

-- Copied from 0484_music_reuse_draft.sql; only nullable-request/erasure handling changes.
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
 IF EXISTS(SELECT 1 FROM public.music_song_versions v JOIN public.music_songs s ON s.id=v.song_id
  WHERE v.id=p_version_id AND v.song_id=p_song_id AND v.user_id=v_user AND s.user_id=v_user
   AND s.status='active' AND v.generation_request_id IS NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','REUSE_UNAVAILABLE'); END IF;
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
REVOKE ALL ON FUNCTION public.music_apply_reuse_to_draft(TEXT,UUID,UUID,INTEGER,BOOLEAN,BOOLEAN,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_apply_reuse_to_draft(TEXT,UUID,UUID,INTEGER,BOOLEAN,BOOLEAN,TEXT) TO service_role;

-- Copied from 0535_music_lyrics_and_best_of.sql; only nullable-request/erasure handling changes.
CREATE OR REPLACE FUNCTION private.music_version_lyrics(p_version_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT ps.lyrics
    FROM public.music_song_versions v
    LEFT JOIN public.music_generation_candidates c ON c.job_id = v.job_id
    LEFT JOIN public.music_generation_requests r ON r.id = c.generation_request_id
    LEFT JOIN public.music_prompt_specs ps ON ps.id = r.prompt_spec_id
    WHERE v.id = p_version_id AND ps.lyrics IS NOT NULL
    LIMIT 1;
$$;
REVOKE ALL ON FUNCTION private.music_version_lyrics(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.music_version_lyrics(UUID) TO service_role;

-- Copied from 0533_music_plays_and_song_reports.sql; only nullable-request/erasure handling changes.
CREATE OR REPLACE FUNCTION private.account_deletion_blockers(p_user_id UUID, p_auth_id TEXT)
RETURNS TEXT[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_blockers TEXT[]; v_auth UUID; v_ref RECORD; v_music_present BOOLEAN;
BEGIN
  v_blockers := ARRAY[]::TEXT[];
  BEGIN v_auth := p_auth_id::uuid; EXCEPTION WHEN invalid_text_representation THEN v_auth := NULL; END;
  IF EXISTS (SELECT 1 FROM public.users u WHERE u.id=p_user_id AND u.frozen_at IS NOT NULL) THEN v_blockers:=array_append(v_blockers,'account_frozen'); END IF;
  IF EXISTS (SELECT 1 FROM public.evidence_holds h JOIN public.jobs j ON j.id=h.job_id WHERE j.user_id=p_user_id AND h.released_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.assets a JOIN public.jobs j ON j.id=a.job_id WHERE j.user_id=p_user_id AND a.held_at IS NOT NULL) THEN v_blockers:=array_append(v_blockers,'account_on_hold'); END IF;
  IF EXISTS (SELECT 1 FROM public.credit_subscriptions s WHERE s.user_id=p_user_id AND s.status IN ('active','past_due'))
     OR EXISTS (SELECT 1 FROM public.social_publish_subscriptions s WHERE s.user_id=p_user_id AND s.status IN ('active','past_due')) THEN v_blockers:=array_append(v_blockers,'active_subscription'); END IF;
  IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.user_id=p_user_id AND j.state IN ('DEBITED','SUBMITTED','FAILOVER')) THEN v_blockers:=array_append(v_blockers,'generation_in_progress'); END IF;
  IF EXISTS (SELECT 1 FROM public.top_ups t WHERE t.user_id=p_user_id AND t.status='pending' AND t.created_at>now()-interval '2 hours') THEN v_blockers:=array_append(v_blockers,'top_up_in_progress'); END IF;
  IF EXISTS (SELECT 1 FROM public.cinema_content c WHERE c.creator_id=p_user_id)
     OR EXISTS (SELECT 1 FROM public.cinema_uploads c WHERE c.creator_id=p_user_id AND c.deleted_at IS NULL) THEN v_blockers:=array_append(v_blockers,'cinema_content_present'); END IF;
  IF v_auth IS NOT NULL AND EXISTS (SELECT 1 FROM public.projects p WHERE p.owner_id=v_auth AND p.deleted_at IS NULL) THEN v_blockers:=array_append(v_blockers,'projects_present'); END IF;
  IF EXISTS (SELECT 1 FROM public.social_brands b JOIN public.social_brand_members m ON m.brand_id=b.id WHERE b.owner_user_id=p_user_id AND m.user_id<>p_user_id) THEN v_blockers:=array_append(v_blockers,'publish_team_present'); END IF;
  IF EXISTS (SELECT 1 FROM public.voice_profiles v WHERE v.user_id=p_user_id AND v.status<>'revoked') THEN v_blockers:=array_append(v_blockers,'voice_profile_present'); END IF;
  FOR v_ref IN
    SELECT c.conrelid, a.attname
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class r ON r.oid=c.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
      JOIN LATERAL unnest(c.conkey) k(attnum) ON true
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
     WHERE c.contype='f' AND c.confrelid='public.users'::regclass
       AND n.nspname='public' AND r.relname LIKE 'music!_%' ESCAPE '!'
       AND r.relname NOT IN ('music_reference_links', 'music_song_reactions', 'music_creator_follows', 'music_social_mutations',
                             'music_comments', 'music_comment_reports', 'music_comment_mutations',
                             'music_play_listens', 'music_song_reports', 'music_mixdown_reservations')
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I=$1)', v_ref.conrelid::regclass, v_ref.attname)
       INTO v_music_present USING p_user_id;
    IF v_music_present THEN
      v_blockers:=array_append(v_blockers,'music_content_present');
      EXIT;
    END IF;
  END LOOP;
  RETURN v_blockers;
END $$;
REVOKE ALL ON FUNCTION private.account_deletion_blockers(UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role;

DO $$ BEGIN
 IF to_regprocedure('public.telemetry_path_allowed_pre_0544(text)') IS NULL THEN
  ALTER FUNCTION public.telemetry_path_allowed(TEXT) RENAME TO telemetry_path_allowed_pre_0544;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT p_path IN ('/api/v1/music/mixdowns','/app/music/beats/new') OR public.telemetry_path_allowed_pre_0544(p_path)
$$;
REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT) FROM PUBLIC,anon,authenticated,service_role;
