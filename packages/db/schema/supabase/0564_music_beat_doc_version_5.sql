-- ADR-0361: prepare the reader rollout and protect already-loaded legacy clients.
-- 0560 is reserved by PR #2452. Never apply from a builder session.
BEGIN;
ALTER TABLE public.music_beat_projects DROP CONSTRAINT IF EXISTS music_beat_projects_doc_version_check;
ALTER TABLE public.music_beat_projects ADD CONSTRAINT music_beat_projects_doc_version_check CHECK (doc_version BETWEEN 1 AND 5);

CREATE OR REPLACE FUNCTION private.save_music_beat_project(p_beat_id uuid,p_expected_revision integer,p_doc text,p_title text,p_mode text,p_idempotency_key text,p_client_beat_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid(); parsed jsonb; saved public.music_beat_projects;
 prior public.music_beat_projects; stashed public.music_beat_project_versions; replay boolean := false;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'PT401'; END IF;
 IF p_client_beat_version IS NULL OR p_client_beat_version NOT BETWEEN 1 AND 5 THEN
 RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='PT400'; END IF;
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
 OR parsed->'version' NOT IN ('1'::jsonb,'2'::jsonb,'3'::jsonb,'4'::jsonb,'5'::jsonb) OR parsed->'version' IS NULL
 OR pg_catalog.lower(parsed->>'id') IS DISTINCT FROM p_beat_id::text
 OR parsed->>'title' IS DISTINCT FROM p_title THEN RAISE EXCEPTION 'invalid'; END IF;
 IF (parsed->>'version')::integer >= 2 THEN
 IF pg_catalog.jsonb_typeof(parsed->'tracks') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid'; END IF;
 IF pg_catalog.jsonb_array_length(parsed->'tracks')>16 THEN RAISE EXCEPTION 'invalid'; END IF;
 END IF;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = 'PT400'; END;
 SELECT * INTO saved FROM public.music_beat_projects WHERE user_id=actor AND beat_id=p_beat_id FOR UPDATE;
 IF saved.doc_version > p_client_beat_version OR (parsed->>'version')::integer > p_client_beat_version
 OR (saved.doc_version >= 5 AND (parsed->>'version')::integer < saved.doc_version) THEN
 RAISE EXCEPTION 'BEAT_CLIENT_OUTDATED' USING ERRCODE='PT409'; END IF;
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

CREATE OR REPLACE FUNCTION private.remove_music_beat_project(p_beat_id uuid,p_expected_revision integer,p_client_beat_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=auth.uid(); saved public.music_beat_projects;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
 IF p_beat_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<1 THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='PT400'; END IF;
 IF p_client_beat_version IS NULL OR p_client_beat_version NOT BETWEEN 1 AND 5 THEN
 RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='PT400'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,542));
 SELECT * INTO saved FROM public.music_beat_projects WHERE user_id=actor AND beat_id=p_beat_id FOR UPDATE;
 IF NOT FOUND THEN RETURN '{"removed":true,"idempotent":true}'::jsonb; END IF;
 IF saved.doc_version > p_client_beat_version THEN
 RAISE EXCEPTION 'BEAT_CLIENT_OUTDATED' USING ERRCODE='PT409'; END IF;
 IF saved.revision<>p_expected_revision THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 PERFORM 1 FROM public.music_beat_project_takes WHERE project_id=saved.id FOR UPDATE;
 DELETE FROM public.music_beat_projects WHERE id=saved.id;
 RETURN '{"removed":true}'::jsonb;
END $$;

CREATE OR REPLACE FUNCTION public.save_music_beat_project(p_beat_id uuid,p_expected_revision integer,p_doc text,p_title text,p_mode text,p_idempotency_key text,p_client_beat_version integer) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT private.save_music_beat_project(p_beat_id,p_expected_revision,p_doc,p_title,p_mode,p_idempotency_key,p_client_beat_version);
$$;
CREATE OR REPLACE FUNCTION private.save_music_beat_project(p_beat_id uuid,p_expected_revision integer,p_doc text,p_title text,p_mode text,p_idempotency_key text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT private.save_music_beat_project(p_beat_id,p_expected_revision,p_doc,p_title,p_mode,p_idempotency_key,4);
$$;
CREATE OR REPLACE FUNCTION public.save_music_beat_project(p_beat_id uuid,p_expected_revision integer,p_doc text,p_title text,p_mode text,p_idempotency_key text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT private.save_music_beat_project(p_beat_id,p_expected_revision,p_doc,p_title,p_mode,p_idempotency_key,4);
$$;
REVOKE ALL ON FUNCTION private.save_music_beat_project(uuid,integer,text,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.save_music_beat_project(uuid,integer,text,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION private.save_music_beat_project(uuid,integer,text,text,text,text,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.save_music_beat_project(uuid,integer,text,text,text,text,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.save_music_beat_project(uuid,integer,text,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_music_beat_project(uuid,integer,text,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.save_music_beat_project(uuid,integer,text,text,text,text,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_music_beat_project(uuid,integer,text,text,text,text,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_music_beat_project(p_beat_id uuid,p_expected_revision integer,p_client_beat_version integer) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT private.remove_music_beat_project(p_beat_id,p_expected_revision,p_client_beat_version);
$$;
CREATE OR REPLACE FUNCTION private.remove_music_beat_project(p_beat_id uuid,p_expected_revision integer) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT private.remove_music_beat_project(p_beat_id,p_expected_revision,4);
$$;
CREATE OR REPLACE FUNCTION public.remove_music_beat_project(p_beat_id uuid,p_expected_revision integer) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT private.remove_music_beat_project(p_beat_id,p_expected_revision,4);
$$;
REVOKE ALL ON FUNCTION private.remove_music_beat_project(uuid,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.remove_music_beat_project(uuid,integer) TO authenticated;
REVOKE ALL ON FUNCTION private.remove_music_beat_project(uuid,integer,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.remove_music_beat_project(uuid,integer,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.remove_music_beat_project(uuid,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_music_beat_project(uuid,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.remove_music_beat_project(uuid,integer,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_music_beat_project(uuid,integer,integer) TO authenticated;

COMMIT;
