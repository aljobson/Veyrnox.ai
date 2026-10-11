-- Private first-party audience signals. No token, IP, device or financial data.
BEGIN;
CREATE TABLE IF NOT EXISTS public.cinema_watch_sessions (
 id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
 content_id UUID NOT NULL REFERENCES public.cinema_content(id) ON DELETE RESTRICT,
 upload_id UUID NOT NULL REFERENCES public.cinema_uploads(id) ON DELETE RESTRICT,
 stream_uid TEXT NOT NULL CHECK(stream_uid ~ '^[A-Za-z0-9]{32}$'),
 duration_seconds INTEGER NOT NULL CHECK(duration_seconds BETWEEN 1 AND 600),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), expires_at TIMESTAMPTZ NOT NULL,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '15 minutes')
);
CREATE INDEX IF NOT EXISTS cinema_watch_sessions_user_idx ON public.cinema_watch_sessions(user_id,created_at);
CREATE INDEX IF NOT EXISTS cinema_watch_sessions_content_idx ON public.cinema_watch_sessions(content_id);
CREATE INDEX IF NOT EXISTS cinema_watch_sessions_upload_idx ON public.cinema_watch_sessions(upload_id);
CREATE TABLE IF NOT EXISTS public.cinema_audience_clock (
 user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE RESTRICT,
 last_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS public.cinema_watch_events (
 id UUID PRIMARY KEY, session_id UUID NOT NULL REFERENCES public.cinema_watch_sessions(id) ON DELETE RESTRICT,
 payload JSONB NOT NULL, covered INT8MULTIRANGE NOT NULL, seconds INTEGER NOT NULL CHECK(seconds BETWEEN 0 AND 60),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS cinema_watch_events_session_idx ON public.cinema_watch_events(session_id,created_at);
CREATE TABLE IF NOT EXISTS public.cinema_share_actions (
 actor_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT, idempotency_key UUID NOT NULL,
 content_id UUID NOT NULL REFERENCES public.cinema_content(id) ON DELETE RESTRICT,
 kind TEXT NOT NULL CHECK(kind IN ('copy','share')), created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS cinema_share_actions_target_idx ON public.cinema_share_actions(content_id,created_at);
ALTER TABLE public.cinema_watch_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_watch_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_audience_clock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_audience_clock FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_watch_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_watch_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_share_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinema_share_actions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cinema_watch_sessions,public.cinema_audience_clock,public.cinema_watch_events,public.cinema_share_actions FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['cinema_watch_sessions','cinema_watch_events','cinema_share_actions'] LOOP
 EXECUTE format('DROP TRIGGER IF EXISTS audience_immutable ON public.%I',t);
 EXECUTE format('CREATE TRIGGER audience_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.cinema_publication_append_only()',t);
 EXECUTE format('DROP TRIGGER IF EXISTS audience_no_truncate ON public.%I',t);
 EXECUTE format('CREATE TRIGGER audience_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_no_truncate()',t);
 END LOOP;
END $$;
-- Called only after an authorized playback request mints its token. Zero initial watch time.
CREATE OR REPLACE FUNCTION public.begin_cinema_watch_session(p_auth_id TEXT,p_content_id UUID,p_session_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_upload public.cinema_uploads%ROWTYPE; v_old public.cinema_watch_sessions%ROWTYPE; v_ent JSONB; v_now TIMESTAMPTZ;
BEGIN
 v_user:=public.cinema_community_actor(p_auth_id);
 IF v_user IS NULL THEN RETURN jsonb_build_object('error','profile_required'); END IF;
 IF p_session_id IS NULL OR public.cinema_community_root(p_content_id) IS NULL THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
 PERFORM pg_advisory_xact_lock(281,hashtext(v_user::text));
 IF public.cinema_community_actor(p_auth_id) IS DISTINCT FROM v_user THEN RETURN jsonb_build_object('error','account_not_active'); END IF;
 v_ent:=public.cinema_entitlement(p_auth_id,p_content_id);
 IF v_ent->>'access' IS NULL OR v_ent->>'access' NOT IN ('free','unlocked','pass') THEN RETURN jsonb_build_object('error','locked'); END IF;
 SELECT * INTO v_upload FROM public.cinema_uploads WHERE content_id=p_content_id AND state='ready' AND stream_uid IS NOT NULL;
 IF NOT FOUND OR v_upload.duration_seconds IS NULL OR v_upload.duration_seconds<1 OR v_upload.duration_seconds>600 THEN RETURN jsonb_build_object('error','not_ready'); END IF;
 SELECT * INTO v_old FROM public.cinema_watch_sessions WHERE id=p_session_id;
 IF FOUND THEN
 IF v_old.user_id<>v_user OR v_old.content_id<>p_content_id THEN RETURN jsonb_build_object('error','idempotency_conflict'); END IF;
 RETURN jsonb_build_object('session_id',v_old.id,'expires_at',v_old.expires_at,'idempotent',true);
 END IF;
 v_now:=clock_timestamp();
 IF (SELECT count(*) FROM public.cinema_watch_sessions WHERE user_id=v_user AND created_at>v_now-interval '1 hour')>=60 THEN RETURN jsonb_build_object('error','rate_limited'); END IF;
 INSERT INTO public.cinema_watch_sessions(id,user_id,content_id,upload_id,stream_uid,duration_seconds,created_at,expires_at)
 VALUES(p_session_id,v_user,p_content_id,v_upload.id,v_upload.stream_uid,ceil(v_upload.duration_seconds)::integer,v_now,v_now+interval '15 minutes');
 INSERT INTO public.cinema_audience_clock(user_id,last_at) VALUES(v_user,v_now) ON CONFLICT(user_id) DO NOTHING;
 RETURN jsonb_build_object('session_id',p_session_id,'expires_at',v_now+interval '15 minutes','idempotent',false);
END $$;
CREATE OR REPLACE FUNCTION public.record_cinema_watch_progress(p_auth_id TEXT,p_session_id UUID,p_key UUID,p_seconds INTEGER,p_ranges JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_session public.cinema_watch_sessions%ROWTYPE; v_old public.cinema_watch_events%ROWTYPE;
 v_clock TIMESTAMPTZ; v_now TIMESTAMPTZ; v_budget INTEGER; v_payload JSONB; v_ranges INT8MULTIRANGE:='{}';
 v_piece JSONB; v_from INTEGER; v_to INTEGER; v_sum INTEGER:=0; v_take INTEGER; v_ent JSONB;
BEGIN
 v_user:=public.cinema_community_actor(p_auth_id);
 IF v_user IS NULL THEN RETURN jsonb_build_object('error','profile_required'); END IF;
 IF p_key IS NULL OR p_seconds IS NULL OR p_seconds NOT BETWEEN 1 AND 60 OR jsonb_typeof(p_ranges) IS DISTINCT FROM 'array' THEN RETURN jsonb_build_object('error','invalid_progress'); END IF;
 IF jsonb_array_length(p_ranges) NOT BETWEEN 1 AND 60 THEN RETURN jsonb_build_object('error','invalid_progress'); END IF;
 PERFORM pg_advisory_xact_lock(281,hashtext(v_user::text));
 IF public.cinema_community_actor(p_auth_id) IS DISTINCT FROM v_user THEN RETURN jsonb_build_object('error','account_not_active'); END IF;
 SELECT * INTO v_session FROM public.cinema_watch_sessions WHERE id=p_session_id AND user_id=v_user;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','session_not_found'); END IF;
 v_payload:=jsonb_build_object('session_id',p_session_id,'seconds',p_seconds,'ranges',p_ranges);
 SELECT * INTO v_old FROM public.cinema_watch_events WHERE id=p_key;
 IF FOUND THEN
 IF v_old.session_id<>p_session_id OR v_old.payload IS DISTINCT FROM v_payload THEN RETURN jsonb_build_object('error','idempotency_conflict'); END IF;
 RETURN jsonb_build_object('ok',true,'seconds',v_old.seconds,'idempotent',true);
 END IF;
 v_now:=clock_timestamp();
 IF v_session.expires_at<=v_now THEN RETURN jsonb_build_object('error','session_expired'); END IF;
 IF public.cinema_community_root(v_session.content_id) IS NULL OR NOT EXISTS(SELECT 1 FROM public.cinema_uploads u
 WHERE u.id=v_session.upload_id AND u.content_id=v_session.content_id AND u.state='ready' AND u.stream_uid=v_session.stream_uid AND ceil(u.duration_seconds)=v_session.duration_seconds) THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
 v_ent:=public.cinema_entitlement(p_auth_id,v_session.content_id);
 IF v_ent->>'access' IS NULL OR v_ent->>'access' NOT IN ('free','unlocked','pass') THEN RETURN jsonb_build_object('error','locked'); END IF;
 SELECT last_at INTO v_clock FROM public.cinema_audience_clock WHERE user_id=v_user FOR UPDATE;
 -- One real-time budget for all tabs and titles on the account. Initial billing never contributes.
 v_budget:=least(p_seconds,60,greatest(0,floor(extract(epoch FROM v_now-greatest(v_clock,v_session.created_at)))::integer));
 FOR v_piece IN SELECT value FROM jsonb_array_elements(p_ranges) LOOP
 IF jsonb_typeof(v_piece) IS DISTINCT FROM 'array' OR jsonb_array_length(v_piece)<>2 THEN RETURN jsonb_build_object('error','invalid_progress'); END IF;
 IF jsonb_typeof(v_piece->0) IS DISTINCT FROM 'number' OR jsonb_typeof(v_piece->1) IS DISTINCT FROM 'number' THEN RETURN jsonb_build_object('error','invalid_progress'); END IF;
 IF (v_piece->>0)::numeric<>trunc((v_piece->>0)::numeric) OR (v_piece->>1)::numeric<>trunc((v_piece->>1)::numeric)
 OR (v_piece->>0)::numeric<0 OR (v_piece->>1)::numeric>v_session.duration_seconds OR (v_piece->>1)::numeric<=(v_piece->>0)::numeric THEN RETURN jsonb_build_object('error','invalid_progress'); END IF;
 v_from:=(v_piece->>0)::integer; v_to:=(v_piece->>1)::integer;
 v_sum:=v_sum+v_to-v_from;
 IF v_sum>p_seconds THEN RETURN jsonb_build_object('error','invalid_progress'); END IF;
 v_take:=least(v_to-v_from,v_budget);
 IF v_take>0 THEN v_ranges:=v_ranges+int8multirange(int8range(v_from,v_from+v_take,'[)')); END IF;
 v_budget:=v_budget-v_take;
 END LOOP;
 v_take:=(SELECT coalesce(sum(upper(r)-lower(r)),0)::integer FROM unnest(v_ranges) r);
 INSERT INTO public.cinema_watch_events(id,session_id,payload,covered,seconds,created_at) VALUES(p_key,p_session_id,v_payload,v_ranges,v_take,v_now);
 UPDATE public.cinema_audience_clock SET last_at=v_now WHERE user_id=v_user;
 RETURN jsonb_build_object('ok',true,'seconds',v_take,'idempotent',false);
END $$;
CREATE OR REPLACE FUNCTION public.record_cinema_share_action(p_auth_id TEXT,p_content_id UUID,p_key UUID,p_kind TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_old public.cinema_share_actions%ROWTYPE;
BEGIN
 v_user:=public.cinema_community_actor(p_auth_id);
 IF v_user IS NULL THEN RETURN jsonb_build_object('error','profile_required'); END IF;
 IF p_key IS NULL OR p_kind IS NULL OR p_kind NOT IN ('copy','share') THEN RETURN jsonb_build_object('error','invalid_action'); END IF;
 PERFORM pg_advisory_xact_lock(281,hashtext(v_user::text));
 IF public.cinema_community_actor(p_auth_id) IS DISTINCT FROM v_user THEN RETURN jsonb_build_object('error','account_not_active'); END IF;
 IF public.cinema_community_root(p_content_id) IS NULL THEN RETURN jsonb_build_object('error','content_not_found'); END IF;
 SELECT * INTO v_old FROM public.cinema_share_actions WHERE actor_id=v_user AND idempotency_key=p_key;
 IF FOUND THEN
 IF v_old.content_id<>p_content_id OR v_old.kind<>p_kind THEN RETURN jsonb_build_object('error','idempotency_conflict'); END IF;
 RETURN jsonb_build_object('ok',true,'idempotent',true);
 END IF;
 IF (SELECT count(*) FROM public.cinema_share_actions WHERE actor_id=v_user AND created_at>clock_timestamp()-interval '1 hour')>=30 THEN RETURN jsonb_build_object('error','rate_limited'); END IF;
 INSERT INTO public.cinema_share_actions(actor_id,idempotency_key,content_id,kind) VALUES(v_user,p_key,p_content_id,p_kind);
 RETURN jsonb_build_object('ok',true,'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.begin_cinema_watch_session(TEXT,UUID,UUID),public.record_cinema_watch_progress(TEXT,UUID,UUID,INTEGER,JSONB),public.record_cinema_share_action(TEXT,UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.begin_cinema_watch_session(TEXT,UUID,UUID),public.record_cinema_watch_progress(TEXT,UUID,UUID,INTEGER,JSONB),public.record_cinema_share_action(TEXT,UUID,UUID,TEXT) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
