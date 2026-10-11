-- Private saved titles and follows. All projections recheck current publication.
BEGIN;
CREATE TABLE IF NOT EXISTS public.cinema_saved_titles (
 user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 content_id UUID NOT NULL REFERENCES public.cinema_content(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(user_id,content_id)
);
CREATE INDEX IF NOT EXISTS cinema_saved_titles_target_idx ON public.cinema_saved_titles(content_id);
CREATE TABLE IF NOT EXISTS public.cinema_creator_follows (
 user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 creator_id UUID NOT NULL REFERENCES public.cinema_profiles(user_id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(user_id,creator_id), CHECK(user_id<>creator_id)
);
CREATE INDEX IF NOT EXISTS cinema_creator_follows_target_idx ON public.cinema_creator_follows(creator_id);
CREATE TABLE IF NOT EXISTS public.cinema_series_follows (
 user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 series_id UUID NOT NULL REFERENCES public.cinema_content(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(user_id,series_id)
);
CREATE INDEX IF NOT EXISTS cinema_series_follows_target_idx ON public.cinema_series_follows(series_id);
CREATE TABLE IF NOT EXISTS public.cinema_retention_requests (
 user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, request_key UUID NOT NULL,
 payload JSONB NOT NULL, result JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,request_key)
);
CREATE INDEX IF NOT EXISTS cinema_retention_requests_time_idx ON public.cinema_retention_requests(user_id,created_at);
ALTER TABLE public.cinema_saved_titles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_saved_titles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_creator_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_creator_follows FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_series_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_series_follows FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_retention_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_retention_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_saved_titles,public.cinema_creator_follows,public.cinema_series_follows,public.cinema_retention_requests FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.cinema_retention_title(p_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.cinema_content c WHERE c.id=p_id AND c.parent_id IS NULL
 AND c.published_at IS NOT NULL AND public.cinema_community_root(c.id)=c.id
 AND ((c.content_type IN ('FILM','SHORT','TRAILER') AND EXISTS(SELECT 1 FROM public.cinema_uploads x WHERE x.content_id=c.id AND x.state='ready'))
 OR (c.content_type='SERIES' AND EXISTS(SELECT 1 FROM public.cinema_content e JOIN public.cinema_content s ON s.id=e.parent_id
 JOIN public.cinema_uploads x ON x.content_id=e.id AND x.state='ready'
 WHERE s.parent_id=c.id AND e.content_type='EPISODE' AND public.cinema_community_root(e.id)=c.id))));
$$;
CREATE OR REPLACE FUNCTION public.cinema_retention_creator(p_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.cinema_profiles p WHERE p.user_id=p_id
 AND EXISTS(SELECT 1 FROM public.cinema_content c WHERE c.creator_id=p_id AND c.parent_id IS NULL AND public.cinema_retention_title(c.id)));
$$;
CREATE OR REPLACE FUNCTION public.read_cinema_retention(p_auth_id TEXT,p_content_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_title public.cinema_content%ROWTYPE;
BEGIN
 v_user:=public.cinema_community_actor(p_auth_id);
 IF v_user IS NULL THEN RETURN jsonb_build_object('error','profile_required'); END IF;
 IF NOT public.cinema_retention_title(p_content_id) THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
 SELECT * INTO v_title FROM public.cinema_content WHERE id=p_content_id;
 RETURN jsonb_build_object('content_id',p_content_id,'creator_id',v_title.creator_id,
 'series_id',CASE WHEN v_title.content_type='SERIES' THEN v_title.id ELSE NULL END,
 'own_creator',v_title.creator_id=v_user,
 'saved',EXISTS(SELECT 1 FROM public.cinema_saved_titles WHERE user_id=v_user AND content_id=p_content_id),
 'following_creator',EXISTS(SELECT 1 FROM public.cinema_creator_follows WHERE user_id=v_user AND creator_id=v_title.creator_id),
 'following_series',EXISTS(SELECT 1 FROM public.cinema_series_follows WHERE user_id=v_user AND series_id=p_content_id));
END $$;
CREATE OR REPLACE FUNCTION public.mutate_cinema_retention(p_auth_id TEXT,p_key UUID,p_kind TEXT,p_target_id UUID,p_active BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_old public.cinema_retention_requests%ROWTYPE; v_payload JSONB; v_result JSONB; v_total BIGINT; v_now TIMESTAMPTZ;
BEGIN
 v_user:=public.cinema_community_actor(p_auth_id);
 IF v_user IS NULL THEN RETURN jsonb_build_object('error','profile_required'); END IF;
 IF p_key IS NULL OR p_target_id IS NULL OR p_active IS NULL OR p_kind IS NULL OR p_kind NOT IN ('saved','creator','series') THEN RETURN jsonb_build_object('error','invalid_action'); END IF;
 PERFORM pg_advisory_xact_lock(283,hashtext(v_user::TEXT));
 PERFORM 1 FROM public.users WHERE id=v_user FOR SHARE;
 PERFORM 1 FROM public.cinema_memberships WHERE user_id=v_user FOR SHARE;
 IF public.cinema_community_actor(p_auth_id) IS DISTINCT FROM v_user THEN RETURN jsonb_build_object('error','account_not_active'); END IF;
 v_payload:=jsonb_build_object('kind',p_kind,'target_id',p_target_id,'active',p_active);
 v_now:=clock_timestamp();
 DELETE FROM public.cinema_retention_requests WHERE user_id=v_user AND created_at<v_now-interval '7 days';
 SELECT * INTO v_old FROM public.cinema_retention_requests WHERE user_id=v_user AND request_key=p_key;
 IF FOUND THEN
 IF v_old.payload IS DISTINCT FROM v_payload THEN RETURN jsonb_build_object('error','idempotency_conflict'); END IF;
 -- Replay acknowledges its original intent; a fresh read always reports current state.
 RETURN v_old.result||jsonb_build_object('idempotent',true);
 END IF;
 IF (SELECT count(*) FROM public.cinema_retention_requests WHERE user_id=v_user AND created_at>v_now-interval '1 minute')>=30
 OR (SELECT count(*) FROM public.cinema_retention_requests WHERE user_id=v_user AND created_at>v_now-interval '1 day')>=500 THEN RETURN jsonb_build_object('error','rate_limited'); END IF;
 IF p_active THEN
 IF p_kind='creator' AND p_target_id=v_user THEN RETURN jsonb_build_object('error','self_follow_forbidden'); END IF;
 IF (p_kind='creator' AND NOT public.cinema_retention_creator(p_target_id))
 OR (p_kind<>'creator' AND NOT public.cinema_retention_title(p_target_id))
 OR (p_kind='series' AND NOT EXISTS(SELECT 1 FROM public.cinema_content WHERE id=p_target_id AND content_type='SERIES')) THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
 SELECT count(*) INTO v_total FROM (
 SELECT content_id AS id FROM public.cinema_saved_titles WHERE user_id=v_user AND p_kind='saved' AND content_id<>p_target_id
 UNION ALL SELECT creator_id FROM public.cinema_creator_follows WHERE user_id=v_user AND p_kind='creator' AND creator_id<>p_target_id
 UNION ALL SELECT series_id FROM public.cinema_series_follows WHERE user_id=v_user AND p_kind='series' AND series_id<>p_target_id) entries;
 IF v_total>=1000 THEN RETURN jsonb_build_object('error','collection_limit'); END IF;
 IF p_kind='saved' THEN INSERT INTO public.cinema_saved_titles(user_id,content_id) VALUES(v_user,p_target_id) ON CONFLICT DO NOTHING;
 ELSIF p_kind='creator' THEN INSERT INTO public.cinema_creator_follows(user_id,creator_id) VALUES(v_user,p_target_id) ON CONFLICT DO NOTHING;
 ELSE INSERT INTO public.cinema_series_follows(user_id,series_id) VALUES(v_user,p_target_id) ON CONFLICT DO NOTHING; END IF;
 ELSE
 IF p_kind='saved' THEN DELETE FROM public.cinema_saved_titles WHERE user_id=v_user AND content_id=p_target_id;
 ELSIF p_kind='creator' THEN DELETE FROM public.cinema_creator_follows WHERE user_id=v_user AND creator_id=p_target_id;
 ELSE DELETE FROM public.cinema_series_follows WHERE user_id=v_user AND series_id=p_target_id; END IF;
 END IF;
 v_result:=jsonb_build_object('kind',p_kind,'target_id',p_target_id,'active',p_active,'idempotent',false);
 INSERT INTO public.cinema_retention_requests(user_id,request_key,payload,result) VALUES(v_user,p_key,v_payload,v_result);
 RETURN v_result;
END $$;
CREATE OR REPLACE FUNCTION public.list_cinema_retention(p_auth_id TEXT,p_kind TEXT,p_before_id UUID,p_limit INTEGER)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_before TIMESTAMPTZ; v_items JSONB;
BEGIN
 v_user:=public.cinema_community_actor(p_auth_id);
 IF v_user IS NULL THEN RETURN jsonb_build_object('error','profile_required'); END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('saved','creator','series') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 40 THEN RETURN jsonb_build_object('error','invalid_query'); END IF;
 IF p_before_id IS NOT NULL THEN
 SELECT created_at INTO v_before FROM (
 SELECT content_id AS id,created_at FROM public.cinema_saved_titles WHERE user_id=v_user AND p_kind='saved'
 UNION ALL SELECT creator_id,created_at FROM public.cinema_creator_follows WHERE user_id=v_user AND p_kind='creator'
 UNION ALL SELECT series_id,created_at FROM public.cinema_series_follows WHERE user_id=v_user AND p_kind='series') e WHERE id=p_before_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','invalid_cursor'); END IF;
 END IF;
 WITH entries AS (
 SELECT content_id AS id,created_at FROM public.cinema_saved_titles WHERE user_id=v_user AND p_kind='saved'
 UNION ALL SELECT creator_id,created_at FROM public.cinema_creator_follows WHERE user_id=v_user AND p_kind='creator'
 UNION ALL SELECT series_id,created_at FROM public.cinema_series_follows WHERE user_id=v_user AND p_kind='series'),
 visible AS (
 SELECT e.*,p.username,p.display_name,c.title,c.id AS content_id
 FROM entries e
 JOIN LATERAL (SELECT x.id,x.title,x.creator_id FROM public.cinema_content x
 WHERE ((p_kind='creator' AND x.creator_id=e.id) OR (p_kind<>'creator' AND x.id=e.id))
 AND x.parent_id IS NULL AND public.cinema_retention_title(x.id)
 ORDER BY x.published_at DESC,x.id DESC LIMIT 1) c ON true
 JOIN public.cinema_profiles p ON p.user_id=c.creator_id
 WHERE p_before_id IS NULL OR (e.created_at,e.id)<(v_before,p_before_id)
 ORDER BY e.created_at DESC,e.id DESC LIMIT p_limit+1)
 SELECT coalesce(jsonb_agg(jsonb_build_object('target_id',id,'content_id',content_id,'title',title,'username',username,'display_name',display_name) ORDER BY created_at DESC,id DESC),'[]'::jsonb) INTO v_items FROM visible;
 RETURN jsonb_build_object('kind',p_kind,'items',v_items);
END $$;
REVOKE ALL ON FUNCTION public.cinema_retention_title(UUID),public.cinema_retention_creator(UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.read_cinema_retention(TEXT,UUID),public.mutate_cinema_retention(TEXT,UUID,TEXT,UUID,BOOLEAN),public.list_cinema_retention(TEXT,TEXT,UUID,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_cinema_retention(TEXT,UUID),public.mutate_cinema_retention(TEXT,UUID,TEXT,UUID,BOOLEAN),public.list_cinema_retention(TEXT,TEXT,UUID,INTEGER) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
