-- First-class Music albums. Albums are owner-fenced releases over already-published
-- songs; they never mint a publication or bypass its immutable rights attestation.

CREATE TABLE IF NOT EXISTS public.music_albums(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    title TEXT NOT NULL CHECK(char_length(btrim(title)) BETWEEN 1 AND 80),
    album_type TEXT NOT NULL DEFAULT 'album' CHECK(album_type IN('album','ep','single')),
    description TEXT NOT NULL DEFAULT '' CHECK(char_length(description) <= 500),
    artwork_asset_id UUID REFERENCES public.assets(id) ON DELETE SET NULL,
    slug TEXT UNIQUE CHECK(slug IS NULL OR slug ~ '^[a-f0-9]{24}$'),
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','published','unpublished','blocked','deleted')),
    revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
    create_key TEXT NOT NULL CHECK(create_key ~ '^[A-Za-z0-9._-]{8,120}$'),
    source_playlist_id UUID,
    source_included_count INTEGER CHECK(source_included_count BETWEEN 0 AND 50),
    source_excluded_count INTEGER CHECK(source_excluded_count >= 0),
    published_at TIMESTAMPTZ,
    unpublished_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id,create_key), UNIQUE(id,user_id),
    CHECK((status='published')=(published_at IS NOT NULL AND unpublished_at IS NULL)),
    CHECK(status<>'unpublished' OR unpublished_at IS NOT NULL),
    CHECK(status<>'blocked' OR unpublished_at IS NOT NULL),
    CHECK(status<>'deleted' OR deleted_at IS NOT NULL),
    CHECK((source_playlist_id IS NULL)=(source_included_count IS NULL) AND (source_playlist_id IS NULL)=(source_excluded_count IS NULL))
);
CREATE INDEX IF NOT EXISTS music_albums_owner_idx ON public.music_albums(user_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS music_albums_public_idx ON public.music_albums(published_at DESC) WHERE status='published';
CREATE INDEX IF NOT EXISTS music_albums_artwork_asset_idx ON public.music_albums(artwork_asset_id);

CREATE TABLE IF NOT EXISTS public.music_album_items(
    album_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    song_id UUID NOT NULL,
    position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(album_id,song_id), UNIQUE(album_id,position),
    FOREIGN KEY(album_id,user_id) REFERENCES public.music_albums(id,user_id) ON DELETE CASCADE,
    FOREIGN KEY(song_id,user_id) REFERENCES public.music_songs(id,user_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS music_album_items_song_idx ON public.music_album_items(song_id);
CREATE INDEX IF NOT EXISTS music_album_items_user_idx ON public.music_album_items(user_id);

CREATE TABLE IF NOT EXISTS public.music_album_mutations(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    album_id UUID NOT NULL,
    idempotency_key TEXT NOT NULL CHECK(idempotency_key ~ '^[A-Za-z0-9._-]{8,120}$'),
    request JSONB NOT NULL,
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Deliberately no album FK: a delete receipt must survive the deleted album so
    -- an unknown-outcome retry can replay instead of turning into NOT_FOUND.
    UNIQUE(user_id,idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.music_album_reports(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    album_id UUID NOT NULL REFERENCES public.music_albums(id) ON DELETE RESTRICT,
    reporter_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    category TEXT NOT NULL CHECK(category IN('spam','abuse','privacy','rights','other')),
    details TEXT NOT NULL CHECK(char_length(btrim(details)) BETWEEN 3 AND 500),
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','resolved','dismissed')),
    resolved_by UUID REFERENCES public.users(id) ON DELETE RESTRICT,
    resolved_at TIMESTAMPTZ,
    idempotency_key TEXT NOT NULL CHECK(idempotency_key ~ '^[A-Za-z0-9._-]{8,120}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(reporter_id,idempotency_key), UNIQUE(reporter_id,album_id)
);
CREATE INDEX IF NOT EXISTS music_album_reports_queue_idx ON public.music_album_reports(status,created_at);
CREATE INDEX IF NOT EXISTS music_album_reports_album_idx ON public.music_album_reports(album_id);
CREATE INDEX IF NOT EXISTS music_album_reports_resolved_by_idx ON public.music_album_reports(resolved_by);

DO $$ DECLARE t TEXT; BEGIN
    FOREACH t IN ARRAY ARRAY['music_albums','music_album_items','music_album_mutations','music_album_reports'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',t);
        EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.%I TO service_role',t);
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION private.music_album_artwork_ok(p_user UUID,p_asset UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    SELECT p_asset IS NULL OR EXISTS(
        SELECT 1 FROM public.assets a
        JOIN public.jobs j ON j.id=a.job_id AND j.user_id=p_user AND j.deleted_at IS NULL
        JOIN public.content_scans cs ON cs.asset_id=a.id AND cs.status='clean'
        WHERE a.id=p_asset AND a.mime_type LIKE 'image/%' AND a.held_at IS NULL
    );
$$;
REVOKE ALL ON FUNCTION private.music_album_artwork_ok(UUID,UUID) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.music_album_tracks(p_album UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'publication_id',p.id,'slug',p.slug,'title',s.title,'position',i.position
    ) ORDER BY i.position),'[]'::jsonb)
    FROM public.music_album_items i
    JOIN public.music_songs s ON s.id=i.song_id AND s.user_id=i.user_id AND s.status='active'
    JOIN public.music_publications p ON p.song_id=i.song_id AND p.user_id=i.user_id AND p.status='published'
    WHERE i.album_id=p_album;
$$;
REVOKE ALL ON FUNCTION private.music_album_tracks(UUID) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.music_album_tracks_export(p_album UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'publication_id',p.id,'song_id',i.song_id,'title',s.title,'position',i.position,
        'publication_status',p.status,'song_status',s.status
    ) ORDER BY i.position),'[]'::jsonb)
    FROM public.music_album_items i
    LEFT JOIN public.music_songs s ON s.id=i.song_id AND s.user_id=i.user_id
    LEFT JOIN LATERAL (SELECT current.id,current.status FROM public.music_publications current
        WHERE current.song_id=i.song_id AND current.user_id=i.user_id ORDER BY current.created_at DESC LIMIT 1) p ON true
    WHERE i.album_id=p_album;
$$;
REVOKE ALL ON FUNCTION private.music_album_tracks_export(UUID) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.music_album_json(a public.music_albums)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    SELECT jsonb_build_object('id',a.id,'title',a.title,'description',a.description,
        'album_type',a.album_type,'artwork_asset_id',a.artwork_asset_id,'has_artwork',a.artwork_asset_id IS NOT NULL,'slug',a.slug,'status',a.status,
        'revision',a.revision,'published_at',a.published_at,'tracks',private.music_album_tracks(a.id));
$$;
REVOKE ALL ON FUNCTION private.music_album_json(public.music_albums) FROM PUBLIC,anon,authenticated;

-- Albums need exact asset ids and must only admit clean images. Keep the shipped song
-- cover shelf unchanged so pending legacy art does not disappear from that feature.
CREATE OR REPLACE FUNCTION public.music_list_album_artwork(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_images JSONB; BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',true,'images','[]'::jsonb); END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('job_id',x.job_id,'asset_id',x.asset_id,'created_at',x.created_at,
        'image_url','/api/v1/jobs/'||x.job_id||'/asset') ORDER BY x.created_at DESC),'[]'::jsonb) INTO v_images
    FROM (SELECT j.id AS job_id,j.created_at,chosen.id AS asset_id FROM public.jobs j
        JOIN LATERAL (SELECT a.id FROM public.assets a JOIN public.content_scans cs ON cs.asset_id=a.id AND cs.status='clean'
            WHERE a.job_id=j.id AND a.mime_type LIKE 'image/%' AND a.held_at IS NULL ORDER BY a.id LIMIT 1) chosen ON true
        WHERE j.user_id=v_user AND j.state='STORED' AND j.deleted_at IS NULL ORDER BY j.created_at DESC LIMIT 24) x;
    RETURN jsonb_build_object('ok',true,'images',v_images);
END $$;

CREATE OR REPLACE FUNCTION public.music_list_albums(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE u UUID; rows JSONB; options JSONB; BEGIN
    SELECT id INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
    IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    SELECT coalesce(jsonb_agg(private.music_album_json(a) ORDER BY a.updated_at DESC),'[]'::jsonb)
      INTO rows FROM public.music_albums a WHERE a.user_id=u AND a.status<>'deleted';
    SELECT coalesce(jsonb_agg(jsonb_build_object('publication_id',p.id,'song_id',s.id,'slug',p.slug,'title',s.title)
        ORDER BY p.published_at DESC),'[]'::jsonb) INTO options
      FROM public.music_publications p JOIN public.music_songs s ON s.id=p.song_id AND s.user_id=p.user_id AND s.status='active'
      WHERE p.user_id=u AND p.status='published';
    RETURN jsonb_build_object('ok',true,'albums',rows,'available_tracks',options);
END $$;

CREATE OR REPLACE FUNCTION public.music_create_album(
    p_auth_id TEXT,p_id UUID,p_title TEXT,p_album_type TEXT,p_description TEXT,p_artwork_asset_id UUID,p_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u UUID; a public.music_albums%ROWTYPE; BEGIN
    IF p_id IS NULL OR p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 80
       OR p_album_type NOT IN('album','ep','single') OR p_description IS NULL OR char_length(p_description)>500
       OR p_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
    SELECT id INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL FOR UPDATE;
    IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    IF NOT private.music_album_artwork_ok(u,p_artwork_asset_id) THEN RETURN jsonb_build_object('ok',false,'code','ARTWORK_NOT_READY'); END IF;
    SELECT * INTO a FROM public.music_albums WHERE user_id=u AND create_key=p_key;
    IF FOUND THEN
        IF a.status='deleted' THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
        IF a.title IS DISTINCT FROM btrim(p_title) OR a.album_type IS DISTINCT FROM p_album_type OR a.description IS DISTINCT FROM btrim(p_description)
           OR a.artwork_asset_id IS DISTINCT FROM p_artwork_asset_id OR a.source_playlist_id IS NOT NULL
        THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
        RETURN jsonb_build_object('ok',true,'idempotent',true,'album',private.music_album_json(a));
    END IF;
    INSERT INTO public.music_albums(id,user_id,title,album_type,description,artwork_asset_id,create_key)
    VALUES(p_id,u,btrim(p_title),p_album_type,btrim(p_description),p_artwork_asset_id,p_key) RETURNING * INTO a;
    RETURN jsonb_build_object('ok',true,'idempotent',false,'album',private.music_album_json(a));
END $$;

CREATE OR REPLACE FUNCTION public.music_convert_playlist_to_album(
    p_auth_id TEXT,p_id UUID,p_playlist_id UUID,p_title TEXT,p_album_type TEXT,p_description TEXT,p_artwork_asset_id UUID,p_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u UUID; pl public.music_playlists%ROWTYPE; a public.music_albums%ROWTYPE; included INTEGER; total INTEGER; BEGIN
    SELECT id INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL FOR UPDATE;
    SELECT * INTO pl FROM public.music_playlists WHERE id=p_playlist_id AND user_id=u AND status='active' FOR SHARE;
    IF u IS NULL OR NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    IF p_id IS NULL OR p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 80 OR p_album_type NOT IN('album','ep','single') OR p_description IS NULL
       OR char_length(p_description)>500 OR p_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
    IF NOT private.music_album_artwork_ok(u,p_artwork_asset_id) THEN RETURN jsonb_build_object('ok',false,'code','ARTWORK_NOT_READY'); END IF;
    SELECT * INTO a FROM public.music_albums WHERE user_id=u AND create_key=p_key;
    IF FOUND THEN
        IF a.status='deleted' THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
        IF a.title IS DISTINCT FROM btrim(p_title) OR a.album_type IS DISTINCT FROM p_album_type OR a.description IS DISTINCT FROM btrim(p_description)
           OR a.artwork_asset_id IS DISTINCT FROM p_artwork_asset_id OR a.source_playlist_id IS DISTINCT FROM p_playlist_id
        THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
        RETURN jsonb_build_object('ok',true,'idempotent',true,'album',private.music_album_json(a),
            'included_count',a.source_included_count,'excluded_count',a.source_excluded_count);
    END IF;
    INSERT INTO public.music_albums(id,user_id,title,album_type,description,artwork_asset_id,create_key,source_playlist_id,source_included_count,source_excluded_count)
      VALUES(p_id,u,btrim(p_title),p_album_type,btrim(p_description),p_artwork_asset_id,p_key,p_playlist_id,0,0) RETURNING * INTO a;
    SELECT count(*) INTO total FROM public.music_playlist_items WHERE playlist_id=pl.id;
    INSERT INTO public.music_album_items(album_id,user_id,song_id,position)
    SELECT a.id,u,s.id,row_number() OVER(ORDER BY i.position)
      FROM public.music_playlist_items i
      JOIN public.music_songs s ON s.id=i.song_id AND s.user_id=u AND s.status='active'
      JOIN public.music_publications p ON p.song_id=s.id AND p.user_id=u AND p.status='published'
     WHERE i.playlist_id=pl.id ORDER BY i.position LIMIT 50;
    GET DIAGNOSTICS included=ROW_COUNT;
    UPDATE public.music_albums SET revision=1,source_included_count=included,source_excluded_count=greatest(0,total-included),updated_at=now() WHERE id=a.id RETURNING * INTO a;
    RETURN jsonb_build_object('ok',true,'idempotent',false,'album',private.music_album_json(a),
        'included_count',included,'excluded_count',greatest(0,total-included));
END $$;

CREATE OR REPLACE FUNCTION public.music_patch_album(
    p_auth_id TEXT,p_id UUID,p_expected INTEGER,p_action TEXT,p_title TEXT,p_album_type TEXT,p_description TEXT,
    p_artwork_asset_id UUID,p_publication_ids UUID[],p_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u UUID; a public.music_albums%ROWTYPE; seen public.music_album_mutations%ROWTYPE; req JSONB; result JSONB; newrev INTEGER; BEGIN
    SELECT id INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
    IF u IS NULL OR p_expected<0 OR p_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
    req:=jsonb_build_object('action',p_action,'expected',p_expected,'title',p_title,'album_type',p_album_type,'description',p_description,
        'artwork_asset_id',p_artwork_asset_id,'publication_ids',coalesce(to_jsonb(p_publication_ids),'[]'::jsonb));
    SELECT * INTO seen FROM public.music_album_mutations WHERE user_id=u AND idempotency_key=p_key;
    IF FOUND THEN IF seen.album_id IS DISTINCT FROM p_id OR seen.request IS DISTINCT FROM req THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
        RETURN seen.result||jsonb_build_object('idempotent',true); END IF;
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
        -- Publishing commits the visible live subset. Removed or unpublished songs
        -- do not remain hidden members that can unexpectedly reappear later.
        DELETE FROM public.music_album_items i WHERE i.album_id=p_id AND NOT EXISTS(
            SELECT 1 FROM public.music_publications p JOIN public.music_songs s
              ON s.id=p.song_id AND s.user_id=p.user_id AND s.status='active'
            WHERE p.song_id=i.song_id AND p.user_id=u AND p.status='published');
        UPDATE public.music_albums SET status='published',slug=coalesce(slug,substr(replace(gen_random_uuid()::text,'-',''),1,24)),
            published_at=coalesce(published_at,now()),unpublished_at=NULL WHERE id=p_id;
    ELSIF p_action='unpublish' THEN
        UPDATE public.music_albums SET status='unpublished',unpublished_at=now() WHERE id=p_id;
    ELSIF p_action='delete' THEN
        result:=jsonb_build_object('ok',true,'idempotent',false,'deleted',true);
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

CREATE OR REPLACE FUNCTION public.music_read_public_album(p_slug TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.music_albums%ROWTYPE; row JSONB; BEGIN
    SELECT * INTO a FROM public.music_albums WHERE slug=p_slug AND status='published';
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    SELECT jsonb_build_object('id',a.id,'slug',a.slug,'title',a.title,'album_type',a.album_type,'description',a.description,
        'has_artwork',a.artwork_asset_id IS NOT NULL,'published_at',a.published_at,
        'handle',cp.handle,'display_name',cp.display_name,'creator_id',ma.public_id,
        'tracks',private.music_album_tracks(a.id)) INTO row
      FROM public.music_creator_profiles cp JOIN public.music_actors ma ON ma.user_id=cp.user_id WHERE cp.user_id=a.user_id;
    IF row IS NULL OR jsonb_array_length(row->'tracks')=0 THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    RETURN jsonb_build_object('ok',true,'album',row);
END $$;

CREATE OR REPLACE FUNCTION public.music_resolve_album_artwork(p_slug TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE row JSONB; BEGIN
    SELECT jsonb_build_object('ok',true,'r2_key',asset.r2_key,'mime_type',asset.mime_type) INTO row
    FROM public.music_albums album
    JOIN public.assets asset ON asset.id=album.artwork_asset_id AND asset.mime_type LIKE 'image/%' AND asset.held_at IS NULL
    JOIN public.jobs job ON job.id=asset.job_id AND job.user_id=album.user_id AND job.deleted_at IS NULL
    JOIN public.content_scans scan ON scan.asset_id=asset.id AND scan.status='clean'
    WHERE album.slug=p_slug AND album.status='published';
    RETURN coalesce(row,jsonb_build_object('ok',false,'code','NOT_FOUND'));
END $$;

CREATE OR REPLACE FUNCTION public.music_read_public_album_for_viewer(p_auth_id TEXT,p_slug TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result JSONB; actor UUID; BEGIN
    IF NOT EXISTS(SELECT 1 FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL) THEN RETURN jsonb_build_object('error','account_not_found'); END IF;
    result:=public.music_read_public_album(p_slug);
    actor:=(result->'album'->>'creator_id')::UUID;
    IF actor IS NOT NULL AND private.music_actor_blocked(p_auth_id,actor) THEN
        RETURN jsonb_build_object('ok',true,'blocked',jsonb_build_object('creator_id',result->'album'->>'creator_id','display_name',result->'album'->>'display_name'));
    END IF;
    RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.music_discover_albums_for_viewer(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rows JSONB; BEGIN
    IF NOT EXISTS(SELECT 1 FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL) THEN RETURN jsonb_build_object('error','account_not_found'); END IF;
    SELECT coalesce(jsonb_agg(x.album ORDER BY x.published_at DESC),'[]'::jsonb) INTO rows FROM (
      SELECT a.published_at,(public.music_read_public_album(a.slug)->'album') AS album
      FROM public.music_albums a JOIN public.music_actors ma ON ma.user_id=a.user_id
      WHERE a.status='published' AND NOT private.music_actor_blocked(p_auth_id,ma.public_id)
      ORDER BY a.published_at DESC LIMIT 50
    ) x WHERE x.album IS NOT NULL;
    RETURN jsonb_build_object('ok',true,'albums',rows);
END $$;

CREATE OR REPLACE FUNCTION public.music_list_profile_albums(p_handle TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rows JSONB; BEGIN
    SELECT coalesce(jsonb_agg(x.album ORDER BY x.published_at DESC),'[]'::jsonb) INTO rows FROM (
      SELECT a.published_at,public.music_read_public_album(a.slug)->'album' AS album
      FROM public.music_albums a JOIN public.music_creator_profiles cp ON cp.user_id=a.user_id
      WHERE cp.handle=p_handle AND a.status='published' ORDER BY a.published_at DESC LIMIT 50
    ) x WHERE x.album IS NOT NULL;
    RETURN jsonb_build_object('ok',true,'albums',rows);
END $$;

CREATE OR REPLACE FUNCTION public.music_list_profile_albums_for_viewer(p_auth_id TEXT,p_handle TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor UUID; BEGIN
    SELECT ma.public_id INTO actor FROM public.music_creator_profiles cp JOIN public.music_actors ma ON ma.user_id=cp.user_id WHERE cp.handle=p_handle;
    IF actor IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    IF private.music_actor_blocked(p_auth_id,actor) THEN RETURN jsonb_build_object('ok',true,'albums','[]'::jsonb); END IF;
    RETURN public.music_list_profile_albums(p_handle);
END $$;

CREATE OR REPLACE FUNCTION public.music_report_album(p_auth_id TEXT,p_slug TEXT,p_category TEXT,p_details TEXT,p_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE reporter UUID; a UUID; owner UUID; report public.music_album_reports%ROWTYPE; BEGIN
    IF p_category NOT IN('spam','abuse','privacy','rights','other') OR char_length(btrim(p_details)) NOT BETWEEN 3 AND 500
       OR p_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
    SELECT id INTO reporter FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL AND frozen_at IS NULL;
    SELECT id,user_id INTO a,owner FROM public.music_albums WHERE slug=p_slug AND status='published';
    IF reporter IS NULL OR a IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    IF reporter=owner THEN RETURN jsonb_build_object('ok',false,'code','SELF_REVIEW'); END IF;
    SELECT * INTO report FROM public.music_album_reports WHERE reporter_id=reporter AND idempotency_key=p_key;
    IF FOUND THEN IF report.album_id<>a OR report.category<>p_category OR report.details<>btrim(p_details) THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
      RETURN jsonb_build_object('ok',true,'idempotent',true,'status','reported'); END IF;
    IF EXISTS(SELECT 1 FROM public.music_album_reports WHERE reporter_id=reporter AND album_id=a) THEN
        RETURN jsonb_build_object('ok',true,'idempotent',true,'status','reported');
    END IF;
    IF (SELECT count(*) FROM public.music_album_reports WHERE reporter_id=reporter AND created_at>now()-interval '24 hours')
       + (SELECT count(*) FROM public.music_song_reports WHERE reporter_id=reporter AND created_at>now()-interval '24 hours')
       + (SELECT count(*) FROM public.music_comment_reports WHERE reporter_id=reporter AND created_at>now()-interval '24 hours') >= 20
    THEN RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED','retry_after_seconds',3600); END IF;
    INSERT INTO public.music_album_reports(album_id,reporter_id,category,details,idempotency_key)
      VALUES(a,reporter,p_category,btrim(p_details),p_key);
    RETURN jsonb_build_object('ok',true,'idempotent',false,'status','reported');
END $$;

CREATE OR REPLACE FUNCTION public.music_album_report_list(p_auth_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM public.users WHERE auth_id=p_auth_id AND is_admin IS TRUE AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE='42501';
    END IF;
    RETURN jsonb_build_object('ok',true,'album_reports',coalesce((SELECT jsonb_agg(x ORDER BY created_at,id) FROM (
        SELECT r.id,r.category,r.details,r.created_at,a.slug,a.title,a.status AS album_status,
            (SELECT count(*) FROM public.music_album_reports o WHERE o.album_id=r.album_id AND o.status='open') AS open_reports
        FROM public.music_album_reports r JOIN public.music_albums a ON a.id=r.album_id
        WHERE r.status='open' ORDER BY r.created_at,r.id LIMIT 50
    ) x),'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.music_album_report_resolve(p_auth_id TEXT,p_idempotency_key TEXT,p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE admin_id UUID; report public.music_album_reports%ROWTYPE; owner_id UUID; old public.music_comment_mutations%ROWTYPE; result JSONB; BEGIN
    SELECT id INTO admin_id FROM public.users WHERE auth_id=p_auth_id AND is_admin IS TRUE AND deleted_at IS NULL;
    IF admin_id IS NULL THEN RAISE EXCEPTION 'not_admin' USING ERRCODE='42501'; END IF;
    IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
       OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN('action','id','decision','reason'))
       OR p_payload->>'action' IS DISTINCT FROM 'resolve_album_report'
       OR p_payload->>'decision' IS NULL OR p_payload->>'decision' NOT IN('resolve','takedown')
       OR coalesce(p_payload->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' OR char_length(btrim(p_payload->>'reason')) NOT BETWEEN 3 AND 500
    THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
    PERFORM pg_advisory_xact_lock(519,hashtext(admin_id::text));
    SELECT * INTO old FROM public.music_comment_mutations WHERE user_id=admin_id AND idempotency_key=p_idempotency_key;
    IF FOUND THEN
        IF old.payload IS DISTINCT FROM p_payload THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
        RETURN old.result||jsonb_build_object('idempotent',true);
    END IF;
    SELECT * INTO report FROM public.music_album_reports WHERE id=(p_payload->>'id')::UUID FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    SELECT user_id INTO owner_id FROM public.music_albums WHERE id=report.album_id;
    IF report.reporter_id=admin_id OR owner_id=admin_id THEN RETURN jsonb_build_object('ok',false,'code','SELF_REVIEW'); END IF;
    IF report.status<>'open' THEN RETURN jsonb_build_object('ok',false,'code','ALREADY_REVIEWED'); END IF;
    IF p_payload->>'decision'='takedown' THEN
        UPDATE public.music_albums SET status='blocked',unpublished_at=coalesce(unpublished_at,now()),revision=revision+1,updated_at=now()
          WHERE id=report.album_id AND status<>'deleted';
        UPDATE public.music_album_reports SET status='resolved',resolved_by=admin_id,resolved_at=now()
          WHERE album_id=report.album_id AND status='open';
    ELSE
        UPDATE public.music_album_reports SET status='resolved',resolved_by=admin_id,resolved_at=now() WHERE id=report.id;
    END IF;
    result:=jsonb_build_object('ok',true,'id',report.id,'status','resolved','prior_status','open','decision',p_payload->>'decision');
    INSERT INTO public.music_comment_mutations(user_id,idempotency_key,payload,result) VALUES(admin_id,p_idempotency_key,p_payload,result);
    RETURN result;
END $$;

-- Dedicated export reader keeps the existing privacy export snapshot/AAL boundary while
-- avoiding a copy of the large generic reader. Album membership is part of the export.
CREATE OR REPLACE FUNCTION public.read_music_album_export_page(
    p_auth_id TEXT,p_aal TEXT,p_export_id UUID,p_after TEXT,p_key TEXT,p_page_size INTEGER DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE u public.users%ROWTYPE; request public.privacy_export_requests%ROWTYPE; rows JSONB; boundary JSONB; n INTEGER; BEGIN
    SELECT * INTO u FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
    SELECT * INTO request FROM public.privacy_export_requests WHERE id=p_export_id AND user_id=u.id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','export_not_found'); END IF;
    IF request.expires_at<=now() THEN RETURN jsonb_build_object('ok',false,'error','export_expired'); END IF;
    IF private.account_deletion_blockers(u.id,p_auth_id) && ARRAY['account_frozen','account_on_hold']::text[] THEN RETURN jsonb_build_object('ok',false,'error','account_restricted'); END IF;
    IF coalesce(p_aal,'')<>'aal2' AND EXISTS(SELECT 1 FROM auth.mfa_factors WHERE user_id=p_auth_id::uuid AND factor_type='totp' AND status='verified') THEN RETURN jsonb_build_object('ok',false,'error','mfa_required'); END IF;
    IF p_page_size IS NOT NULL AND p_page_size NOT BETWEEN 1 AND 200 THEN RETURN jsonb_build_object('ok',false,'error','invalid_section'); END IF;
    n:=least(coalesce(p_page_size,200),200);
    WITH page AS (
      SELECT jsonb_build_object('id',a.id,'title',a.title,'album_type',a.album_type,'description',a.description,'status',a.status,'slug',a.slug,
        'artwork_asset_id',a.artwork_asset_id,
        'has_artwork',a.artwork_asset_id IS NOT NULL,'published_at',a.published_at,'created_at',a.created_at,
        'tracks',private.music_album_tracks_export(a.id)) AS data,a.created_at AS ord,a.id AS tie
      FROM public.music_albums a WHERE a.user_id=u.id AND a.created_at<=request.as_of
        AND (p_after IS NULL OR (a.created_at,a.id)>(p_after::timestamptz,p_key::uuid)) ORDER BY a.created_at,a.id LIMIT n
    ) SELECT coalesce(jsonb_agg(data ORDER BY ord,tie),'[]'::jsonb),
        (SELECT jsonb_build_object('after',ord,'key',tie) FROM page ORDER BY ord DESC,tie DESC LIMIT 1) INTO rows,boundary FROM page;
    IF jsonb_array_length(rows)<n THEN boundary:=NULL; END IF;
    RETURN jsonb_build_object('ok',true,'rows',rows,'next',boundary);
END $$;

-- Reporting and mutation receipts are incidental data and must not prevent an
-- otherwise eligible account erasure. Owned albums/items remain content blockers.
CREATE OR REPLACE FUNCTION private.music_albums_forget_erased_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        DELETE FROM public.music_album_reports WHERE reporter_id=NEW.id;
        UPDATE public.music_album_reports SET resolved_by=NULL WHERE resolved_by=NEW.id;
        DELETE FROM public.music_album_mutations WHERE user_id=NEW.id;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS users_music_albums_forget_erased ON public.users;
CREATE TRIGGER users_music_albums_forget_erased AFTER UPDATE OF deleted_at ON public.users
    FOR EACH ROW EXECUTE FUNCTION private.music_albums_forget_erased_user();

CREATE OR REPLACE FUNCTION private.account_deletion_blockers(p_user_id UUID,p_auth_id TEXT)
RETURNS TEXT[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_blockers TEXT[]; v_auth UUID; v_ref RECORD; v_music_present BOOLEAN; BEGIN
  v_blockers:=ARRAY[]::TEXT[];
  BEGIN v_auth:=p_auth_id::uuid; EXCEPTION WHEN invalid_text_representation THEN v_auth:=NULL; END;
  IF EXISTS(SELECT 1 FROM public.users u WHERE u.id=p_user_id AND u.frozen_at IS NOT NULL) THEN v_blockers:=array_append(v_blockers,'account_frozen'); END IF;
  IF EXISTS(SELECT 1 FROM public.evidence_holds h JOIN public.jobs j ON j.id=h.job_id WHERE j.user_id=p_user_id AND h.released_at IS NULL)
     OR EXISTS(SELECT 1 FROM public.assets a JOIN public.jobs j ON j.id=a.job_id WHERE j.user_id=p_user_id AND a.held_at IS NOT NULL) THEN v_blockers:=array_append(v_blockers,'account_on_hold'); END IF;
  IF EXISTS(SELECT 1 FROM public.credit_subscriptions s WHERE s.user_id=p_user_id AND s.status IN('active','past_due'))
     OR EXISTS(SELECT 1 FROM public.social_publish_subscriptions s WHERE s.user_id=p_user_id AND s.status IN('active','past_due')) THEN v_blockers:=array_append(v_blockers,'active_subscription'); END IF;
  IF EXISTS(SELECT 1 FROM public.jobs j WHERE j.user_id=p_user_id AND j.state IN('DEBITED','SUBMITTED','FAILOVER')) THEN v_blockers:=array_append(v_blockers,'generation_in_progress'); END IF;
  IF EXISTS(SELECT 1 FROM public.top_ups t WHERE t.user_id=p_user_id AND t.status='pending' AND t.created_at>now()-interval '2 hours') THEN v_blockers:=array_append(v_blockers,'top_up_in_progress'); END IF;
  IF EXISTS(SELECT 1 FROM public.cinema_content c WHERE c.creator_id=p_user_id)
     OR EXISTS(SELECT 1 FROM public.cinema_uploads c WHERE c.creator_id=p_user_id AND c.deleted_at IS NULL) THEN v_blockers:=array_append(v_blockers,'cinema_content_present'); END IF;
  IF v_auth IS NOT NULL AND EXISTS(SELECT 1 FROM public.projects p WHERE p.owner_id=v_auth AND p.deleted_at IS NULL) THEN v_blockers:=array_append(v_blockers,'projects_present'); END IF;
  IF EXISTS(SELECT 1 FROM public.social_brands b JOIN public.social_brand_members m ON m.brand_id=b.id WHERE b.owner_user_id=p_user_id AND m.user_id<>p_user_id) THEN v_blockers:=array_append(v_blockers,'publish_team_present'); END IF;
  IF EXISTS(SELECT 1 FROM public.voice_profiles v WHERE v.user_id=p_user_id AND v.status<>'revoked') THEN v_blockers:=array_append(v_blockers,'voice_profile_present'); END IF;
  IF EXISTS(SELECT 1 FROM public.music_albums a WHERE a.user_id=p_user_id AND a.status<>'deleted') THEN
      v_blockers:=array_append(v_blockers,'music_content_present');
  END IF;
  FOR v_ref IN SELECT c.conrelid,a.attname FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class r ON r.oid=c.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
      JOIN LATERAL unnest(c.conkey) k(attnum) ON true JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
      WHERE c.contype='f' AND c.confrelid='public.users'::regclass AND n.nspname='public' AND r.relname LIKE 'music!_%' ESCAPE '!'
      AND r.relname NOT IN('music_reference_links','music_song_reactions','music_creator_follows','music_social_mutations',
          'music_comments','music_comment_reports','music_comment_mutations','music_play_listens','music_song_reports',
          'music_mixdown_reservations','music_actors','music_user_blocks','music_albums','music_album_items','music_album_reports','music_album_mutations')
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I=$1)',v_ref.conrelid::regclass,v_ref.attname) INTO v_music_present USING p_user_id;
    IF v_music_present THEN v_blockers:=array_append(v_blockers,'music_content_present'); EXIT; END IF;
  END LOOP;
  RETURN v_blockers;
END $$;
REVOKE ALL ON FUNCTION private.account_deletion_blockers(UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role;

DO $$ BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0600(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(TEXT) RENAME TO telemetry_path_allowed_pre_0600;
    END IF;
END $$;
CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path='' AS $$
    SELECT p_path IN ('/api/music/albums/:id','/api/music/albums/:id/artwork','/api/v1/music/albums','/api/v1/music/albums/:id',
        '/api/v1/music/albums/artwork','/api/v1/music/albums/from-playlist','/api/v1/music/explore/albums','/api/v1/music/explore/albums/:id',
        '/api/v1/music/album-reports','/app/music/albums','/music/albums/:id')
        OR public.telemetry_path_allowed_pre_0600(p_path);
$$;
REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT) FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION public.music_list_albums(TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_list_album_artwork(TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_create_album(TEXT,UUID,TEXT,TEXT,TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_convert_playlist_to_album(TEXT,UUID,UUID,TEXT,TEXT,TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_patch_album(TEXT,UUID,INTEGER,TEXT,TEXT,TEXT,TEXT,UUID,UUID[],TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_read_public_album(TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_resolve_album_artwork(TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_read_public_album_for_viewer(TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_discover_albums_for_viewer(TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_list_profile_albums(TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_list_profile_albums_for_viewer(TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_report_album(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_album_report_list(TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_album_report_resolve(TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.read_music_album_export_page(TEXT,TEXT,UUID,TEXT,TEXT,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_list_albums(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_list_album_artwork(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_create_album(TEXT,UUID,TEXT,TEXT,TEXT,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_convert_playlist_to_album(TEXT,UUID,UUID,TEXT,TEXT,TEXT,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_patch_album(TEXT,UUID,INTEGER,TEXT,TEXT,TEXT,TEXT,UUID,UUID[],TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_read_public_album(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_resolve_album_artwork(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_read_public_album_for_viewer(TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_discover_albums_for_viewer(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_list_profile_albums(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_list_profile_albums_for_viewer(TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_report_album(TEXT,TEXT,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_album_report_list(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_album_report_resolve(TEXT,TEXT,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_music_album_export_page(TEXT,TEXT,UUID,TEXT,TEXT,INTEGER) TO service_role;
