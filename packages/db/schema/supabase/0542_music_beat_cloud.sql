-- ADR-0344: MUSIC_RUNTIME_FLAGS.beatCloud; free saves write no ledger rows.
BEGIN;
CREATE TABLE IF NOT EXISTS public.music_beat_projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 beat_id uuid NOT NULL, title text NOT NULL CHECK (char_length(title) <= 80 AND pg_catalog.btrim(title, E' \t\n\r') <> ''),
 doc_json text NOT NULL CHECK (octet_length(doc_json) <= 262144),
 doc_version smallint NOT NULL CHECK (doc_version BETWEEN 1 AND 4),
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0), create_key text NOT NULL, last_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,beat_id)
);
CREATE INDEX IF NOT EXISTS music_beat_projects_updated ON public.music_beat_projects(user_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS public.music_beat_project_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES public.music_beat_projects(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, revision integer NOT NULL CHECK (revision > 0),
 title text NOT NULL CHECK (char_length(title) <= 80 AND pg_catalog.btrim(title, E' \t\n\r') <> ''),
 doc_json text NOT NULL CHECK (octet_length(doc_json) <= 262144),
 reason text NOT NULL CHECK (reason IN ('autosave','checkpoint','conflict','stash')),
 request_key text, saved_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS music_beat_versions_revision ON public.music_beat_project_versions(project_id,revision) WHERE reason <> 'stash';
CREATE UNIQUE INDEX IF NOT EXISTS music_beat_versions_request ON public.music_beat_project_versions(project_id,request_key) WHERE request_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS music_beat_versions_saved ON public.music_beat_project_versions(project_id,saved_at DESC);
CREATE TABLE IF NOT EXISTS public.music_beat_project_takes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES public.music_beat_projects(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 take_ref text NOT NULL CHECK (take_ref ~ '^[A-Za-z0-9_-]{1,128}$'), r2_key text NOT NULL UNIQUE,
 byte_size bigint NOT NULL CHECK (byte_size BETWEEN 44 AND 60000000),
 duration_sec numeric NOT NULL CHECK (duration_sec > 0 AND duration_sec <= 600),
 status text NOT NULL CHECK (status IN ('pending','ready')), upload_expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), ready_at timestamptz, UNIQUE(project_id,take_ref)
);
CREATE TABLE IF NOT EXISTS private.music_beat_save_windows (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 minute_start timestamptz NOT NULL, minute_count integer NOT NULL CHECK (minute_count >= 0),
 day_start timestamptz NOT NULL, day_count integer NOT NULL CHECK (day_count >= 0)
);
ALTER TABLE public.music_beat_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_beat_projects FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.music_beat_projects FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (id,beat_id,title,doc_json,doc_version,revision,created_at,updated_at) ON public.music_beat_projects TO authenticated;
DROP POLICY IF EXISTS owner_read ON public.music_beat_projects;
CREATE POLICY owner_read ON public.music_beat_projects FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
ALTER TABLE public.music_beat_project_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_beat_project_versions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.music_beat_project_versions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (id,project_id,revision,title,doc_json,reason,saved_at) ON public.music_beat_project_versions TO authenticated;
DROP POLICY IF EXISTS owner_read ON public.music_beat_project_versions;
CREATE POLICY owner_read ON public.music_beat_project_versions FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
ALTER TABLE public.music_beat_project_takes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_beat_project_takes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.music_beat_project_takes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (id,project_id,take_ref,byte_size,duration_sec,status,created_at,ready_at) ON public.music_beat_project_takes TO authenticated;
DROP POLICY IF EXISTS owner_read ON public.music_beat_project_takes;
CREATE POLICY owner_read ON public.music_beat_project_takes FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
ALTER TABLE private.music_beat_save_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.music_beat_save_windows FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.music_beat_save_windows FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.reap_music_beat_take() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 INSERT INTO public.asset_reap_queue(r2_key,not_before)
 VALUES(OLD.r2_key,greatest(pg_catalog.now(),coalesce(OLD.upload_expires_at,pg_catalog.now()) + interval '5 minutes'))
 ON CONFLICT (r2_key) DO UPDATE SET not_before = greatest(public.asset_reap_queue.not_before,EXCLUDED.not_before);
 RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS music_beat_take_reap ON public.music_beat_project_takes;
CREATE TRIGGER music_beat_take_reap AFTER DELETE ON public.music_beat_project_takes FOR EACH ROW EXECUTE FUNCTION private.reap_music_beat_take();
REVOKE ALL ON FUNCTION private.reap_music_beat_take() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.consume_music_beat_save(actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w private.music_beat_save_windows; stamp timestamptz := pg_catalog.now();
BEGIN
 INSERT INTO private.music_beat_save_windows VALUES(actor,stamp,0,stamp,0) ON CONFLICT (user_id) DO NOTHING;
 SELECT * INTO w FROM private.music_beat_save_windows WHERE user_id = actor FOR UPDATE;
 IF stamp >= w.minute_start + interval '1 minute' THEN w.minute_start := stamp; w.minute_count := 0; END IF;
 IF stamp >= w.day_start + interval '1 day' THEN w.day_start := stamp; w.day_count := 0; END IF;
 IF w.minute_count >= 20 OR w.day_count >= 2000 THEN RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE = 'PT429'; END IF;
 UPDATE private.music_beat_save_windows SET minute_start=w.minute_start,minute_count=w.minute_count+1,
 day_start=w.day_start,day_count=w.day_count+1 WHERE user_id=actor;
END $$;
REVOKE ALL ON FUNCTION private.consume_music_beat_save(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.save_music_beat_project(p_beat_id uuid,p_expected_revision integer,p_doc text,p_title text,p_mode text,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid(); parsed jsonb; saved public.music_beat_projects;
 prior public.music_beat_projects; stashed public.music_beat_project_versions; replay boolean := false;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'PT401'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,542));
 IF p_beat_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 0 AND 2147483646
 OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,128}$'
 OR p_title IS NULL OR pg_catalog.char_length(p_title) > 80 OR pg_catalog.btrim(p_title, E' \t\n\r') = ''
 OR p_doc IS NULL OR pg_catalog.octet_length(p_doc)>262144
 OR p_mode IS NULL OR p_mode NOT IN ('autosave','checkpoint','stash') THEN
 RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = 'PT400'; END IF;
 BEGIN
 parsed := p_doc::jsonb;
 IF pg_catalog.jsonb_typeof(parsed) IS DISTINCT FROM 'object' OR parsed->>'kind' IS DISTINCT FROM 'veyrnox.music.beat'
 OR parsed->'version' NOT IN ('1'::jsonb,'2'::jsonb,'3'::jsonb,'4'::jsonb) OR parsed->'version' IS NULL
 OR pg_catalog.lower(parsed->>'id') IS DISTINCT FROM p_beat_id::text
 OR parsed->>'title' IS DISTINCT FROM p_title THEN RAISE EXCEPTION 'invalid'; END IF;
 IF (parsed->>'version')::integer >= 2 THEN
 IF pg_catalog.jsonb_typeof(parsed->'tracks') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid'; END IF;
 IF pg_catalog.jsonb_array_length(parsed->'tracks')>16 THEN RAISE EXCEPTION 'invalid'; END IF;
 END IF;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = 'PT400'; END;
 SELECT * INTO saved FROM public.music_beat_projects WHERE user_id=actor AND beat_id=p_beat_id FOR UPDATE;
 prior := saved;
 IF p_mode='stash' THEN
 IF saved.id IS NULL THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 IF saved.revision<>p_expected_revision THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 SELECT * INTO stashed FROM public.music_beat_project_versions WHERE project_id=saved.id AND request_key=p_idempotency_key;
 IF FOUND THEN
 IF stashed.doc_json<>p_doc OR stashed.title<>p_title THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='PT409'; END IF;
 replay := true;
 ELSE
 IF saved.revision<>p_expected_revision THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 PERFORM private.consume_music_beat_save(actor);
 INSERT INTO public.music_beat_project_versions(project_id,user_id,revision,title,doc_json,reason,request_key)
 VALUES(saved.id,actor,p_expected_revision,p_title,p_doc,'stash',p_idempotency_key);
 END IF;
 ELSE
 IF p_expected_revision=0 THEN
 IF saved.id IS NOT NULL THEN
 IF saved.create_key=p_idempotency_key THEN
 IF saved.revision>1 THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 IF saved.doc_json<>p_doc OR saved.title<>p_title THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='PT409'; END IF;
 replay:=true;
 ELSE RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 ELSIF (SELECT pg_catalog.count(*) FROM public.music_beat_projects WHERE user_id=actor)>=50 THEN
 RAISE EXCEPTION 'LIMIT_REACHED' USING ERRCODE='PT429', DETAIL='music_beat_projects'; END IF;
 ELSE
 IF saved.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
 IF saved.last_key=p_idempotency_key AND saved.revision=p_expected_revision+1 THEN
 IF saved.doc_json<>p_doc OR saved.title<>p_title THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='PT409'; END IF;
 replay:=true;
 ELSIF saved.revision<>p_expected_revision THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 END IF;
 IF NOT replay THEN
 PERFORM private.consume_music_beat_save(actor);
 IF saved.id IS NULL THEN
 INSERT INTO public.music_beat_projects(user_id,beat_id,title,doc_json,doc_version,create_key,last_key)
 VALUES(actor,p_beat_id,p_title,p_doc,(parsed->>'version')::smallint,p_idempotency_key,p_idempotency_key) RETURNING * INTO saved;
 ELSE
 UPDATE public.music_beat_projects SET title=p_title,doc_json=p_doc,doc_version=(parsed->>'version')::smallint,
 revision=revision+1,last_key=p_idempotency_key,updated_at=pg_catalog.now() WHERE id=saved.id RETURNING * INTO saved;
 END IF;
 IF p_mode='checkpoint' AND prior.id IS NOT NULL THEN
 INSERT INTO public.music_beat_project_versions(project_id,user_id,revision,title,doc_json,reason)
 VALUES(prior.id,actor,prior.revision,prior.title,prior.doc_json,'conflict') ON CONFLICT (project_id,revision) WHERE reason<>'stash' DO NOTHING;
 END IF;
 IF p_mode='checkpoint' OR NOT EXISTS(SELECT 1 FROM public.music_beat_project_versions WHERE project_id=saved.id AND saved_at>pg_catalog.now()-interval '5 minutes') THEN
 INSERT INTO public.music_beat_project_versions(project_id,user_id,revision,title,doc_json,reason)
 VALUES(saved.id,actor,saved.revision,saved.title,saved.doc_json,CASE WHEN p_mode='checkpoint' THEN 'checkpoint' ELSE 'autosave' END);
 END IF;
 END IF;
 END IF;
 IF NOT replay THEN
 DELETE FROM public.music_beat_project_versions WHERE id IN (SELECT id FROM public.music_beat_project_versions
 WHERE project_id=saved.id ORDER BY saved_at DESC,revision DESC,id DESC OFFSET 20);
 END IF;
 RETURN pg_catalog.jsonb_build_object('id',saved.id,'beat_id',saved.beat_id,'title',saved.title,'doc_version',saved.doc_version,
 'revision',saved.revision,'created_at',saved.created_at,'updated_at',saved.updated_at,'idempotent',replay)
 || CASE WHEN p_mode='stash' THEN '{"stashed":true}'::jsonb ELSE '{}'::jsonb END;
END $$;

CREATE OR REPLACE FUNCTION private.remove_music_beat_project(p_beat_id uuid,p_expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=auth.uid(); saved public.music_beat_projects;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
 IF p_beat_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<1 THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='PT400'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,542));
 SELECT * INTO saved FROM public.music_beat_projects WHERE user_id=actor AND beat_id=p_beat_id FOR UPDATE;
 IF NOT FOUND THEN RETURN '{"removed":true,"idempotent":true}'::jsonb; END IF;
 IF saved.revision<>p_expected_revision THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 PERFORM 1 FROM public.music_beat_project_takes WHERE project_id=saved.id FOR UPDATE;
 DELETE FROM public.music_beat_projects WHERE id=saved.id;
 RETURN '{"removed":true}'::jsonb;
END $$;

CREATE OR REPLACE FUNCTION private.reserve_music_beat_take(p_beat_id uuid,p_take_ref text,p_byte_size bigint,p_duration_sec numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=auth.uid(); project uuid; take public.music_beat_project_takes; replay boolean;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,542));
 IF p_take_ref IS NULL OR p_take_ref !~ '^[A-Za-z0-9_-]{1,128}$' OR p_byte_size IS NULL OR p_byte_size NOT BETWEEN 44 AND 60000000
 OR p_duration_sec IS NULL OR NOT (p_duration_sec>0 AND p_duration_sec<=600) THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='PT400'; END IF;
 SELECT id INTO project FROM public.music_beat_projects WHERE user_id=actor AND beat_id=p_beat_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
 SELECT * INTO take FROM public.music_beat_project_takes WHERE project_id=project AND take_ref=p_take_ref FOR UPDATE;
 replay:=FOUND;
 IF replay THEN
 IF take.byte_size<>p_byte_size THEN RAISE EXCEPTION 'TAKE_CHANGED' USING ERRCODE='PT409'; END IF;
 IF take.status='ready' THEN RETURN pg_catalog.jsonb_build_object('take_id',take.id,'status','ready','idempotent',true); END IF;
 ELSE
 IF (SELECT pg_catalog.count(*) FROM public.music_beat_project_takes WHERE project_id=project)>=64
 OR (SELECT coalesce(pg_catalog.sum(byte_size),0) FROM public.music_beat_project_takes WHERE user_id=actor)+p_byte_size>1000000000 THEN
 RAISE EXCEPTION 'LIMIT_REACHED' USING ERRCODE='PT429',DETAIL='music_beat_takes'; END IF;
 END IF;
 PERFORM private.consume_music_beat_save(actor);
 IF replay THEN UPDATE public.music_beat_project_takes SET upload_expires_at=pg_catalog.now()+interval '15 minutes' WHERE id=take.id RETURNING * INTO take;
 ELSE INSERT INTO public.music_beat_project_takes(project_id,user_id,take_ref,r2_key,byte_size,duration_sec,status,upload_expires_at)
 VALUES(project,actor,p_take_ref,'music-beat-takes/'||actor::text||'/'||pg_catalog.gen_random_uuid()::text||'.wav',p_byte_size,p_duration_sec,'pending',pg_catalog.now()+interval '15 minutes') RETURNING * INTO take; END IF;
 RETURN pg_catalog.jsonb_build_object('take_id',take.id,'status',take.status,'r2_key',take.r2_key,'byte_size',take.byte_size,'upload_expires_at',take.upload_expires_at,'idempotent',replay);
END $$;

CREATE OR REPLACE FUNCTION private.read_music_beat_take(p_beat_id uuid,p_take_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=auth.uid(); take public.music_beat_project_takes;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,542));
 SELECT t.* INTO take FROM public.music_beat_project_takes t JOIN public.music_beat_projects p ON p.id=t.project_id
 WHERE t.user_id=actor AND p.user_id=actor AND p.beat_id=p_beat_id AND t.id=p_take_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
 RETURN pg_catalog.jsonb_build_object('r2_key',take.r2_key,'byte_size',take.byte_size,'status',take.status);
END $$;

CREATE OR REPLACE FUNCTION private.confirm_music_beat_take(p_beat_id uuid,p_take_id uuid,p_byte_size bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=auth.uid(); take public.music_beat_project_takes;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,542));
 SELECT t.* INTO take FROM public.music_beat_project_takes t JOIN public.music_beat_projects p ON p.id=t.project_id
 WHERE t.user_id=actor AND p.user_id=actor AND p.beat_id=p_beat_id AND t.id=p_take_id FOR UPDATE OF t;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
 IF take.status='ready' THEN RETURN '{"status":"ready","idempotent":true}'::jsonb; END IF;
 IF p_byte_size IS DISTINCT FROM take.byte_size THEN RAISE EXCEPTION 'SIZE_MISMATCH' USING ERRCODE='PT409'; END IF;
 UPDATE public.music_beat_project_takes SET status='ready',ready_at=pg_catalog.now() WHERE id=take.id;
 RETURN '{"status":"ready","idempotent":false}'::jsonb;
END $$;

CREATE OR REPLACE FUNCTION public.save_music_beat_project(p_beat_id uuid,p_expected_revision integer,p_doc text,p_title text,p_mode text,p_idempotency_key text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT private.save_music_beat_project(p_beat_id,p_expected_revision,p_doc,p_title,p_mode,p_idempotency_key); $$;
REVOKE ALL ON FUNCTION private.save_music_beat_project(uuid,integer,text,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.save_music_beat_project(uuid,integer,text,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.save_music_beat_project(uuid,integer,text,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_music_beat_project(uuid,integer,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_music_beat_project(p_beat_id uuid,p_expected_revision integer) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT private.remove_music_beat_project(p_beat_id,p_expected_revision); $$;
REVOKE ALL ON FUNCTION private.remove_music_beat_project(uuid,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.remove_music_beat_project(uuid,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.remove_music_beat_project(uuid,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_music_beat_project(uuid,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.reserve_music_beat_take(p_beat_id uuid,p_take_ref text,p_byte_size bigint,p_duration_sec numeric) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT private.reserve_music_beat_take(p_beat_id,p_take_ref,p_byte_size,p_duration_sec); $$;
REVOKE ALL ON FUNCTION private.reserve_music_beat_take(uuid,text,bigint,numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.reserve_music_beat_take(uuid,text,bigint,numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.reserve_music_beat_take(uuid,text,bigint,numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_music_beat_take(uuid,text,bigint,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_music_beat_take(p_beat_id uuid,p_take_id uuid,p_byte_size bigint) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT private.confirm_music_beat_take(p_beat_id,p_take_id,p_byte_size); $$;
REVOKE ALL ON FUNCTION private.confirm_music_beat_take(uuid,uuid,bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.confirm_music_beat_take(uuid,uuid,bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.confirm_music_beat_take(uuid,uuid,bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_music_beat_take(uuid,uuid,bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.read_music_beat_take(p_beat_id uuid,p_take_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT private.read_music_beat_take(p_beat_id,p_take_id); $$;
REVOKE ALL ON FUNCTION private.read_music_beat_take(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.read_music_beat_take(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.read_music_beat_take(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_music_beat_take(uuid,uuid) TO authenticated;

-- Admin telemetry: count the new routes (wrapper pattern from 0521/0538).
DO $$
BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0542(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(TEXT) RENAME TO telemetry_path_allowed_pre_0542;
    END IF;
END $$;
CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT p_path IN ('/api/v1/music/beat-projects', '/api/v1/music/beat-projects/:id',
        '/api/v1/music/beat-projects/:id/takes', '/api/v1/music/beat-projects/:id/takes/:id',
        '/api/v1/music/beat-projects/:id/versions', '/api/v1/music/beat-projects/:id/versions/:id')
        OR public.telemetry_path_allowed_pre_0542(p_path)
$$;
REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT) FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
