-- 0254_tenant_write_caps.sql
-- Caps on the tenant write functions a signed-in user can call directly
-- (audit 2026-10-09, P-05; ADR-0051).
--
-- TENANT_PROJECTS_ENABLED gates the Worker routes only. The public wrappers
-- create_project and save_project_document are executable by `authenticated`
-- on purpose (ADR-0051: RLS and these functions are the enforcing line), and
-- every production user holds a personal organisation and workspace. So with
-- the flag off, a user with the publishable key could still create projects
-- without limit and append document revisions at 30 a minute, tens of KB
-- each, into the ledger's database. project_document_versions is append-only
-- by trigger, so nothing ever removed them.
--
-- Three caps, each a 'LIMIT_REACHED' with SQLSTATE PT429 (the status the
-- tenant client already maps for RATE_LIMITED):
--
--   * 200 live projects per workspace (deleted_at IS NULL), in create_project.
--   * 1,000 revisions per project, in save_project_document. Together with
--     the existing 32 KiB document ceiling that bounds one project at 32 MiB.
--   * 2,000 document saves per actor per rolling day, in save_project_document,
--     counted from the audit rows the function writes.
--
-- The grants are unchanged: a flag-conditional REVOKE is not something a
-- migration applied to every environment can express, and the flag is on in
-- staging. Bodies are those of 0135 and 0140 with the caps added. Idempotent:
-- OR REPLACE, the index IF NOT EXISTS, REVOKE and GRANT re-run.

-- The per-actor, per-day count reads audit_events by actor and time; the
-- existing audit_events_actor index has no time column.
CREATE INDEX IF NOT EXISTS audit_events_actor_time ON public.audit_events(actor_id, created_at DESC);

CREATE OR REPLACE FUNCTION private.create_project(workspace uuid, project_name text, request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid(); existing private.api_requests; created public.projects; payload jsonb;
BEGIN
    IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'PT401'; END IF;
    IF coalesce(private.workspace_role(workspace), '') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR') THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404'; END IF;
    IF request_key IS NULL OR request_key !~ '^[A-Za-z0-9._-]{8,128}$' OR project_name IS NULL OR char_length(btrim(project_name)) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = 'PT400'; END IF;
    -- Per-actor transaction lock: replay probe, rate limit and mutation atomic.
    PERFORM pg_advisory_xact_lock(hashtextextended(actor::text, 34));
    payload := jsonb_build_object('workspace',workspace,'name',btrim(project_name));
    SELECT * INTO existing FROM private.api_requests WHERE actor_id = actor AND operation = 'project.create' AND key = request_key;
    IF FOUND THEN
        IF existing.payload <> payload THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE = 'PT409'; END IF;
        IF private.project_role(existing.resource_id) IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404'; END IF;
        SELECT * INTO created FROM public.projects WHERE id = existing.resource_id;
        RETURN jsonb_build_object('project', to_jsonb(created), 'idempotent', true);
    END IF;
    IF (SELECT count(*) FROM public.audit_events WHERE actor_id = actor AND created_at > now() - interval '1 minute') >= 30 THEN RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE = 'PT429'; END IF;
    -- Cap: 200 live projects per workspace (0254). A removed project no longer counts.
    IF (SELECT count(*) FROM public.projects p WHERE p.workspace_id = workspace AND p.deleted_at IS NULL) >= 200 THEN
        RAISE EXCEPTION 'LIMIT_REACHED' USING ERRCODE = 'PT429', DETAIL = 'workspace_projects';
    END IF;
    INSERT INTO public.projects(workspace_id, owner_id, name) VALUES(workspace, actor, btrim(project_name)) RETURNING * INTO created;
    INSERT INTO private.api_requests(actor_id,operation,key,payload,resource_id) VALUES(actor,'project.create',request_key,payload,created.id);
    RETURN jsonb_build_object('project', to_jsonb(created), 'idempotent', false);
END $$;

CREATE OR REPLACE FUNCTION private.save_project_document(
    project uuid, expected integer, content jsonb, request_key text, restore_revision integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    actor uuid := auth.uid(); existing public.project_document_versions; saved public.project_document_versions;
    head integer; org uuid; request_id uuid; raw_id text; restored jsonb;
BEGIN
    IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'PT401'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(actor::text, 34));
    -- The same project lock used by rename/delete serializes all document writers.
    PERFORM 1 FROM public.projects WHERE id = project FOR UPDATE;
    IF coalesce(private.project_role(project),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR') THEN
        RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404';
    END IF;
    IF expected IS NULL OR expected < 0 OR request_key IS NULL OR request_key !~ '^[A-Za-z0-9._-]{8,128}$'
        OR (restore_revision IS NOT NULL AND (restore_revision < 1 OR content IS NOT NULL))
        OR (restore_revision IS NULL AND content IS NULL) THEN
        RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = 'PT400';
    END IF;
    SELECT * INTO existing FROM public.project_document_versions v
        WHERE v.project_id = project AND v.actor_id = actor AND v.request_key = save_project_document.request_key;
    IF FOUND THEN
        IF existing.expected_revision <> expected OR existing.restored_from IS DISTINCT FROM restore_revision
            OR (restore_revision IS NULL AND existing.document IS DISTINCT FROM content) THEN
            RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE = 'PT409';
        END IF;
        RETURN jsonb_build_object('revision',existing.revision,'document',existing.document,'created_at',existing.created_at,'restored_from',existing.restored_from,'idempotent',true);
    END IF;
    SELECT coalesce(max(v.revision),0) INTO head FROM public.project_document_versions v WHERE v.project_id = project;
    IF expected <> head THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE = 'PT409'; END IF;
    -- Cap: 1,000 revisions per project (0254). Revisions are append-only, so
    -- this is the project's size ceiling: 1,000 x 32 KiB.
    IF head >= 1000 THEN
        RAISE EXCEPTION 'LIMIT_REACHED' USING ERRCODE = 'PT429', DETAIL = 'project_revisions';
    END IF;
    IF restore_revision IS NOT NULL THEN
        SELECT v.document INTO restored FROM public.project_document_versions v WHERE v.project_id = project AND v.revision = restore_revision;
        IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404'; END IF;
        content := restored;
    END IF;
    -- Enforce the canonical v1 contract even on direct PostgREST calls.
    IF jsonb_typeof(content) IS DISTINCT FROM 'object'
        OR content - ARRAY['schema_version','project_id','brief','canvas'] <> '{}'::jsonb
        OR content->'schema_version' IS DISTINCT FROM '1'::jsonb
        OR content->>'project_id' IS DISTINCT FROM project::text
        OR jsonb_typeof(content->'brief') IS DISTINCT FROM 'string'
        OR char_length(content->>'brief') > 6000
        OR jsonb_typeof(content->'canvas') IS DISTINCT FROM 'object'
        OR (content->'canvas') - ARRAY['aspect_ratio','frame_rate'] <> '{}'::jsonb
        OR coalesce(content->'canvas'->>'aspect_ratio','') NOT IN ('16:9','9:16','1:1')
        OR coalesce(content->'canvas'->'frame_rate','null'::jsonb) NOT IN ('24'::jsonb,'25'::jsonb,'30'::jsonb,'60'::jsonb)
        OR octet_length(content::text) > 32768 THEN
        RAISE EXCEPTION 'INVALID_DOCUMENT' USING ERRCODE = 'PT400';
    END IF;
    IF (SELECT count(*) FROM public.audit_events WHERE actor_id = actor AND created_at > now() - interval '1 minute') >= 30 THEN
        RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE = 'PT429';
    END IF;
    -- Cap: 2,000 document saves per actor per rolling day (0254), from the
    -- audit rows this function writes. 2,000 x 32 KiB bounds a day at 64 MiB.
    IF (SELECT count(*) FROM public.audit_events e
         WHERE e.actor_id = actor AND e.created_at > now() - interval '1 day'
           AND e.action IN ('PROJECT_DOCUMENT_SAVED','PROJECT_DOCUMENT_RESTORED')) >= 2000 THEN
        RAISE EXCEPTION 'LIMIT_REACHED' USING ERRCODE = 'PT429', DETAIL = 'daily_document_saves';
    END IF;
    INSERT INTO public.project_document_versions(project_id,revision,document,actor_id,restored_from,expected_revision,request_key)
        VALUES(project,head+1,content,actor,restore_revision,expected,request_key) RETURNING * INTO saved;
    SELECT w.organisation_id INTO org FROM public.projects p JOIN public.workspaces w ON w.id = p.workspace_id WHERE p.id = project;
    raw_id := nullif(current_setting('request.headers',true),'')::jsonb ->> 'x-request-id';
    BEGIN request_id := raw_id::uuid; EXCEPTION WHEN invalid_text_representation THEN request_id := NULL; END;
    INSERT INTO public.audit_events(request_id,actor_id,organisation_id,action,resource_id)
        VALUES(coalesce(request_id,gen_random_uuid()),actor,org,
        CASE WHEN restore_revision IS NULL THEN 'PROJECT_DOCUMENT_SAVED' ELSE 'PROJECT_DOCUMENT_RESTORED' END,project);
    RETURN jsonb_build_object('revision',saved.revision,'document',saved.document,'created_at',saved.created_at,'restored_from',saved.restored_from,'idempotent',false);
END $$;

-- Same grants as 0135 and 0140: a replaced body keeps its ACL, but the
-- statement is re-run so the file states what holds.
REVOKE ALL ON FUNCTION private.create_project(uuid,text,text), private.save_project_document(uuid,integer,jsonb,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.create_project(uuid,text,text), private.save_project_document(uuid,integer,jsonb,text,integer) TO authenticated;
NOTIFY pgrst, 'reload schema';
