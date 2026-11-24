-- Forward-only hardening for the already-merged album schema. Keep 0600 immutable so
-- environments that have recorded its checksum receive these function replacements.
DO $$ BEGIN
    IF to_regclass('public.music_albums') IS NULL THEN
        RAISE EXCEPTION '0600_music_albums must be applied before 0605';
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.music_patch_album(
    p_auth_id TEXT,p_id UUID,p_expected INTEGER,p_action TEXT,p_title TEXT,p_album_type TEXT,p_description TEXT,
    p_artwork_asset_id UUID,p_publication_ids UUID[],p_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u UUID; a public.music_albums%ROWTYPE; seen public.music_album_mutations%ROWTYPE; req JSONB; result JSONB; newrev INTEGER; BEGIN
    SELECT id INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
    IF u IS NULL OR p_expected<0 OR p_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text||':'||p_key,0));
    IF p_action='delete' THEN
        req:=jsonb_build_object('action','delete','expected',p_expected);
    ELSE
        req:=jsonb_build_object('action',p_action,'expected',p_expected,'title',p_title,'album_type',p_album_type,'description',p_description,
            'artwork_asset_id',p_artwork_asset_id,'publication_ids',coalesce(to_jsonb(p_publication_ids),'[]'::jsonb));
    END IF;
    SELECT * INTO seen FROM public.music_album_mutations WHERE user_id=u AND idempotency_key=p_key;
    IF FOUND THEN
        IF seen.album_id IS DISTINCT FROM p_id THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
        IF seen.result->>'redacted'='true' THEN
            IF seen.request->>'action' IS DISTINCT FROM p_action
               OR seen.request->>'expected' IS DISTINCT FROM p_expected::text
            THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
            RETURN seen.result||jsonb_build_object('idempotent',true);
        END IF;
        IF seen.request IS DISTINCT FROM req THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
        RETURN seen.result||jsonb_build_object('idempotent',true);
    END IF;
    SELECT * INTO a FROM public.music_albums WHERE id=p_id AND user_id=u AND status<>'deleted' FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    IF a.revision<>p_expected THEN RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT','revision',a.revision); END IF;
    IF a.status='blocked' AND p_action<>'delete' THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    IF p_action='update' THEN
        IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 80 OR p_album_type NOT IN('album','ep','single') OR p_description IS NULL OR char_length(p_description)>500
           OR NOT private.music_album_artwork_ok(u,p_artwork_asset_id) THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
        UPDATE public.music_albums SET title=btrim(p_title),album_type=p_album_type,description=btrim(p_description),artwork_asset_id=p_artwork_asset_id WHERE id=p_id;
    ELSIF p_action='replace' THEN
        IF coalesce(array_length(p_publication_ids,1),0)>50
           OR EXISTS(SELECT 1 FROM unnest(coalesce(p_publication_ids,'{}'::uuid[])) x GROUP BY x HAVING count(*)>1)
           OR EXISTS(SELECT 1 FROM unnest(coalesce(p_publication_ids,'{}'::uuid[])) x
                WHERE NOT EXISTS(SELECT 1 FROM public.music_publications p JOIN public.music_songs s
                    ON s.id=p.song_id AND s.user_id=p.user_id AND s.status='active'
                    WHERE p.id=x AND p.user_id=u AND p.status='published'))
        THEN RETURN jsonb_build_object('ok',false,'code','INVALID_PUBLICATIONS'); END IF;
        DELETE FROM public.music_album_items WHERE album_id=p_id;
        INSERT INTO public.music_album_items(album_id,user_id,song_id,position)
          SELECT p_id,u,p.song_id,x.ord FROM unnest(coalesce(p_publication_ids,'{}'::uuid[])) WITH ORDINALITY x(publication_id,ord)
          JOIN public.music_publications p ON p.id=x.publication_id AND p.user_id=u AND p.status='published';
    ELSIF p_action='publish' THEN
        IF NOT EXISTS(SELECT 1 FROM public.music_album_items i JOIN public.music_publications p
                ON p.song_id=i.song_id AND p.user_id=u AND p.status='published'
                JOIN public.music_songs s ON s.id=i.song_id AND s.user_id=u AND s.status='active'
                WHERE i.album_id=p_id)
           OR NOT EXISTS(SELECT 1 FROM public.music_creator_profiles WHERE user_id=u)
           OR NOT private.music_album_artwork_ok(u,a.artwork_asset_id)
        THEN RETURN jsonb_build_object('ok',false,'code','ALBUM_NOT_READY'); END IF;
        DELETE FROM public.music_album_items i WHERE i.album_id=p_id AND NOT EXISTS(
            SELECT 1 FROM public.music_publications p JOIN public.music_songs s
              ON s.id=p.song_id AND s.user_id=p.user_id AND s.status='active'
            WHERE p.song_id=i.song_id AND p.user_id=u AND p.status='published');
        UPDATE public.music_albums SET status='published',slug=coalesce(slug,substr(replace(gen_random_uuid()::text,'-',''),1,24)),
            published_at=coalesce(published_at,now()),unpublished_at=NULL WHERE id=p_id;
    ELSIF p_action='unpublish' THEN
        UPDATE public.music_albums SET status='unpublished',unpublished_at=now() WHERE id=p_id;
    ELSIF p_action='delete' THEN
        UPDATE public.music_album_mutations
           SET request=jsonb_build_object('action',coalesce(request->>'action','redacted'),'expected',request->'expected'),
               result=jsonb_build_object('ok',true,'redacted',true,'album_id',p_id)
         WHERE user_id=u AND album_id=p_id;
        result:=jsonb_build_object('ok',true,'idempotent',false,'deleted',true,'album_id',p_id);
        INSERT INTO public.music_album_mutations(user_id,album_id,idempotency_key,request,result) VALUES(u,p_id,p_key,req,result);
        DELETE FROM public.music_album_items WHERE album_id=p_id;
        UPDATE public.music_albums SET status='deleted',title='Deleted album',description='',
            source_playlist_id=NULL,source_included_count=NULL,source_excluded_count=NULL,deleted_at=now(),
            unpublished_at=CASE WHEN published_at IS NULL THEN unpublished_at ELSE coalesce(unpublished_at,now()) END,
            artwork_asset_id=NULL,revision=revision+1,updated_at=now() WHERE id=p_id;
        RETURN result;
    ELSE RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
    newrev:=a.revision+1;
    UPDATE public.music_albums SET revision=newrev,updated_at=now() WHERE id=p_id RETURNING * INTO a;
    result:=jsonb_build_object('ok',true,'idempotent',false,'album',private.music_album_json(a));
    INSERT INTO public.music_album_mutations(user_id,album_id,idempotency_key,request,result) VALUES(u,p_id,p_key,req,result);
    RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.music_resolve_album_artwork(p_slug TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE row JSONB; BEGIN
    SELECT jsonb_build_object('ok',true,'r2_key',asset.r2_key,'mime_type',asset.mime_type) INTO row
    FROM public.music_albums album
    JOIN public.assets asset ON asset.id=album.artwork_asset_id AND asset.mime_type LIKE 'image/%' AND asset.held_at IS NULL
    JOIN public.jobs job ON job.id=asset.job_id AND job.user_id=album.user_id AND job.deleted_at IS NULL
    JOIN public.content_scans scan ON scan.asset_id=asset.id AND scan.status='clean'
    WHERE album.slug=p_slug AND album.status='published'
      AND public.music_read_public_album(album.slug)->>'ok'='true';
    RETURN coalesce(row,jsonb_build_object('ok',false,'code','NOT_FOUND'));
END $$;

CREATE OR REPLACE FUNCTION public.music_resolve_album_artwork_for_viewer(p_auth_id TEXT,p_slug TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE visible JSONB; BEGIN
    visible:=public.music_read_public_album_for_viewer(p_auth_id,p_slug);
    IF visible->>'error'='account_not_found' THEN RETURN visible; END IF;
    IF coalesce(visible->>'ok','')<>'true' OR visible ? 'blocked' THEN
        RETURN jsonb_build_object('ok',false,'code','NOT_FOUND');
    END IF;
    RETURN public.music_resolve_album_artwork(p_slug);
END $$;

REVOKE ALL ON FUNCTION public.music_patch_album(TEXT,UUID,INTEGER,TEXT,TEXT,TEXT,TEXT,UUID,UUID[],TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_resolve_album_artwork(TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_resolve_album_artwork_for_viewer(TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_patch_album(TEXT,UUID,INTEGER,TEXT,TEXT,TEXT,TEXT,UUID,UUID[],TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_resolve_album_artwork(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_resolve_album_artwork_for_viewer(TEXT,TEXT) TO service_role;
