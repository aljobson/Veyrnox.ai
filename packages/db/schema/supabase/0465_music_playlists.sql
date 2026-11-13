-- Private ordered playlists with optimistic revisions and replay receipts.
CREATE TABLE IF NOT EXISTS public.music_playlists(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
 title TEXT NOT NULL CHECK(char_length(btrim(title)) BETWEEN 1 AND 80),pinned BOOLEAN NOT NULL DEFAULT false,
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','archived')),
 create_key TEXT NOT NULL CHECK(create_key~'^[A-Za-z0-9._-]{8,120}$'),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(user_id,create_key),UNIQUE(id,user_id));
CREATE INDEX IF NOT EXISTS music_playlists_user_idx ON public.music_playlists(user_id,pinned DESC,updated_at DESC);
CREATE TABLE IF NOT EXISTS public.music_playlist_items(
 playlist_id UUID NOT NULL,user_id UUID NOT NULL,song_id UUID NOT NULL,position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 100),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(playlist_id,song_id),UNIQUE(playlist_id,position),FOREIGN KEY(playlist_id,user_id) REFERENCES public.music_playlists(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(song_id,user_id) REFERENCES public.music_songs(id,user_id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS music_playlist_items_song_idx ON public.music_playlist_items(user_id,song_id);
CREATE TABLE IF NOT EXISTS public.music_playlist_mutations(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,playlist_id UUID NOT NULL,
 idempotency_key TEXT NOT NULL CHECK(idempotency_key~'^[A-Za-z0-9._-]{8,120}$'),request JSONB NOT NULL,result_revision INTEGER NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(user_id,idempotency_key),FOREIGN KEY(playlist_id,user_id) REFERENCES public.music_playlists(id,user_id) ON DELETE CASCADE);
DO $$ DECLARE t TEXT;BEGIN FOREACH t IN ARRAY ARRAY['music_playlists','music_playlist_items','music_playlist_mutations'] LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',t);EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.%I TO service_role',t);END LOOP;END $$;

CREATE OR REPLACE FUNCTION public.music_list_playlists(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE v_user UUID;v_rows JSONB;BEGIN
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'pinned',p.pinned,'revision',p.revision,'created_at',p.created_at,'songs',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'version_id',v.id,'audio_url','/api/v1/jobs/'||v.job_id||'/asset','position',i.position) ORDER BY i.position) FROM public.music_playlist_items i JOIN public.music_songs s ON s.id=i.song_id AND s.user_id=i.user_id JOIN public.music_song_versions v ON v.id=s.current_version_id WHERE i.playlist_id=p.id),'[]'::jsonb)) ORDER BY p.pinned DESC,p.updated_at DESC),'[]'::jsonb) INTO v_rows FROM public.music_playlists p WHERE p.user_id=v_user AND p.status='active';
 RETURN jsonb_build_object('ok',true,'playlists',v_rows);END $$;
CREATE OR REPLACE FUNCTION public.music_create_playlist(p_auth_id TEXT,p_id UUID,p_title TEXT,p_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE v_user UUID;v public.music_playlists%ROWTYPE;BEGIN
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id FOR UPDATE;IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND');END IF;
 SELECT * INTO v FROM public.music_playlists WHERE user_id=v_user AND create_key=p_key;IF FOUND THEN IF v.title IS DISTINCT FROM btrim(p_title) THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');END IF;RETURN jsonb_build_object('ok',true,'idempotent',true,'playlist',jsonb_build_object('id',v.id,'title',v.title,'pinned',v.pinned,'revision',v.revision,'songs','[]'::jsonb));END IF;
 INSERT INTO public.music_playlists(id,user_id,title,create_key)VALUES(p_id,v_user,btrim(p_title),p_key)RETURNING * INTO v;RETURN jsonb_build_object('ok',true,'idempotent',false,'playlist',jsonb_build_object('id',v.id,'title',v.title,'pinned',v.pinned,'revision',v.revision,'songs','[]'::jsonb));END $$;
CREATE OR REPLACE FUNCTION public.music_patch_playlist(p_auth_id TEXT,p_id UUID,p_expected INTEGER,p_action TEXT,p_song_ids UUID[],p_pinned BOOLEAN,p_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE v_user UUID;v public.music_playlists%ROWTYPE;m public.music_playlist_mutations%ROWTYPE;req JSONB;newrev INTEGER;BEGIN
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;req:=jsonb_build_object('action',p_action,'expected',p_expected,'songs',COALESCE(to_jsonb(p_song_ids),'[]'::jsonb),'pinned',p_pinned);
 SELECT * INTO m FROM public.music_playlist_mutations WHERE user_id=v_user AND idempotency_key=p_key;IF FOUND THEN IF m.playlist_id IS DISTINCT FROM p_id OR m.request IS DISTINCT FROM req THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');END IF;RETURN jsonb_build_object('ok',true,'idempotent',true,'revision',m.result_revision);END IF;
 SELECT * INTO v FROM public.music_playlists WHERE id=p_id AND user_id=v_user AND status='active' FOR UPDATE;IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND');END IF;IF v.revision<>p_expected THEN RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT','revision',v.revision);END IF;
 IF p_action='replace' THEN IF COALESCE(array_length(p_song_ids,1),0)>100 OR EXISTS(SELECT 1 FROM unnest(COALESCE(p_song_ids,'{}'::uuid[])) x GROUP BY x HAVING count(*)>1) OR EXISTS(SELECT 1 FROM unnest(COALESCE(p_song_ids,'{}'::uuid[])) x WHERE NOT EXISTS(SELECT 1 FROM public.music_songs s WHERE s.id=x AND s.user_id=v_user AND s.status='active')) THEN RETURN jsonb_build_object('ok',false,'code','INVALID_SONGS');END IF;DELETE FROM public.music_playlist_items WHERE playlist_id=p_id;INSERT INTO public.music_playlist_items(playlist_id,user_id,song_id,position)SELECT p_id,v_user,x.song_id,x.ord FROM unnest(COALESCE(p_song_ids,'{}'::uuid[])) WITH ORDINALITY x(song_id,ord);
 ELSIF p_action='pin' AND p_pinned IS NOT NULL THEN UPDATE public.music_playlists SET pinned=p_pinned WHERE id=p_id;ELSE RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');END IF;
 newrev:=v.revision+1;UPDATE public.music_playlists SET revision=newrev,updated_at=now() WHERE id=p_id;INSERT INTO public.music_playlist_mutations(user_id,playlist_id,idempotency_key,request,result_revision)VALUES(v_user,p_id,p_key,req,newrev);RETURN jsonb_build_object('ok',true,'idempotent',false,'revision',newrev);END $$;
REVOKE ALL ON FUNCTION public.music_list_playlists(TEXT) FROM PUBLIC,anon,authenticated;REVOKE ALL ON FUNCTION public.music_create_playlist(TEXT,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated;REVOKE ALL ON FUNCTION public.music_patch_playlist(TEXT,UUID,INTEGER,TEXT,UUID[],BOOLEAN,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_list_playlists(TEXT) TO service_role;GRANT EXECUTE ON FUNCTION public.music_create_playlist(TEXT,UUID,TEXT,TEXT) TO service_role;GRANT EXECUTE ON FUNCTION public.music_patch_playlist(TEXT,UUID,INTEGER,TEXT,UUID[],BOOLEAN,TEXT) TO service_role;
