-- 0618_project_folders.sql
-- Workspace-scoped project folders, bounded nesting and conflict-safe project moves.
-- Authenticated clients can read through RLS; all writes go through validated RPCs.
BEGIN;

CREATE TABLE IF NOT EXISTS public.project_folders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
    parent_id uuid,
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120 AND name !~ '[[:cntrl:]]'),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(id, workspace_id),
    CONSTRAINT project_folder_parent_fk FOREIGN KEY(parent_id, workspace_id)
        REFERENCES public.project_folders(id, workspace_id) ON DELETE RESTRICT,
    CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX IF NOT EXISTS project_folders_sibling_name
    ON public.project_folders(workspace_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));
CREATE INDEX IF NOT EXISTS project_folders_workspace_parent ON public.project_folders(workspace_id, parent_id, name, id);

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS folder_id uuid;
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_folder_fk;
ALTER TABLE public.projects ADD CONSTRAINT projects_folder_fk FOREIGN KEY(folder_id, workspace_id)
    REFERENCES public.project_folders(id, workspace_id) ON DELETE SET NULL (folder_id);
CREATE INDEX IF NOT EXISTS projects_workspace_folder ON public.projects(workspace_id, folder_id, created_at DESC) WHERE deleted_at IS NULL;

-- A project leaves its folder when it is soft-deleted. This keeps folder deletion
-- deterministic and prevents the FK's later SET NULL from producing a second,
-- misleading PROJECT_DELETED audit event for an already deleted project.
CREATE OR REPLACE FUNCTION private.clear_project_folder_on_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN NEW.folder_id := NULL; END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS clear_project_folder_on_delete ON public.projects;
CREATE TRIGGER clear_project_folder_on_delete BEFORE UPDATE OF deleted_at ON public.projects
FOR EACH ROW EXECUTE FUNCTION private.clear_project_folder_on_delete();

CREATE TABLE IF NOT EXISTS private.project_folder_requests (
    actor_id uuid NOT NULL,
    request_key text NOT NULL CHECK (request_key ~ '^[A-Za-z0-9._-]{8,128}$'),
    payload jsonb NOT NULL,
    folder_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(actor_id, request_key)
);
ALTER TABLE private.project_folder_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.project_folder_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.project_folder_requests FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX IF NOT EXISTS project_folder_requests_created ON private.project_folder_requests(created_at);

ALTER TABLE public.project_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_folders FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_folders FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.project_folders TO authenticated;
DROP POLICY IF EXISTS project_folder_read ON public.project_folders;
CREATE POLICY project_folder_read ON public.project_folders FOR SELECT TO authenticated
    USING (private.workspace_role(workspace_id) IS NOT NULL);

-- Retain the complete action allowlist from 0568 and add the folder actions.
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_action_check;
ALTER TABLE public.audit_events ADD CONSTRAINT audit_events_action_check CHECK (action IN (
    'PROJECT_CREATED','PROJECT_UPDATED','PROJECT_DELETED','PROJECT_DOCUMENT_SAVED','PROJECT_DOCUMENT_RESTORED',
    'PROJECT_ASSET_RESERVED','PROJECT_ASSET_INSPECTED','PROJECT_ASSET_REJECTED','PROJECT_PRO_HEAD_SET',
    'PROJECT_FOLDER_CREATED','PROJECT_FOLDER_RENAMED','PROJECT_FOLDER_DELETED','PROJECT_FOLDER_MOVED'
));

CREATE OR REPLACE FUNCTION private.check_project_folder_write_limit(actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF (SELECT count(*) FROM public.audit_events e WHERE e.actor_id=actor AND e.created_at>now()-interval '1 minute'
        AND e.action IN ('PROJECT_FOLDER_CREATED','PROJECT_FOLDER_RENAMED','PROJECT_FOLDER_DELETED','PROJECT_FOLDER_MOVED')) >= 30 THEN
        RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE='PT429';
    END IF;
    IF (SELECT count(*) FROM public.audit_events e WHERE e.actor_id=actor AND e.created_at>now()-interval '1 day'
        AND e.action IN ('PROJECT_FOLDER_CREATED','PROJECT_FOLDER_RENAMED','PROJECT_FOLDER_DELETED','PROJECT_FOLDER_MOVED')) >= 2000 THEN
        RAISE EXCEPTION 'LIMIT_REACHED' USING ERRCODE='PT429';
    END IF;
END $$;

CREATE OR REPLACE FUNCTION private.audit_project_folder_change(workspace uuid, resource uuid, event_action text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE request_id uuid; raw_id text; org uuid;
BEGIN
    IF event_action NOT IN ('PROJECT_FOLDER_CREATED','PROJECT_FOLDER_RENAMED','PROJECT_FOLDER_DELETED','PROJECT_FOLDER_MOVED') THEN
        RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='PT400';
    END IF;
    raw_id := nullif(current_setting('request.headers',true),'')::jsonb->>'x-request-id';
    BEGIN request_id := raw_id::uuid; EXCEPTION WHEN invalid_text_representation THEN request_id := NULL; END;
    SELECT organisation_id INTO org FROM public.workspaces WHERE id=workspace;
    INSERT INTO public.audit_events(request_id,actor_id,organisation_id,action,resource_id)
    VALUES(coalesce(request_id,gen_random_uuid()),auth.uid(),org,event_action,resource);
END $$;

CREATE OR REPLACE FUNCTION private.create_project_folder(workspace uuid, parent uuid, folder_name text, request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid(); existing private.project_folder_requests; created public.project_folders; payload jsonb; parent_depth integer;
BEGIN
    IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
    IF coalesce(private.workspace_role(workspace),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR') THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
    IF request_key IS NULL OR request_key !~ '^[A-Za-z0-9._-]{8,128}$' OR folder_name IS NULL
        OR char_length(btrim(folder_name)) NOT BETWEEN 1 AND 120 OR folder_name ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='PT400';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(actor::text, 604));
    PERFORM pg_advisory_xact_lock(hashtextextended(workspace::text, 604));
    DELETE FROM private.project_folder_requests WHERE created_at < now() - interval '30 days';
    payload := jsonb_build_object('workspace',workspace,'parent',parent,'name',btrim(folder_name));
    SELECT * INTO existing FROM private.project_folder_requests r WHERE r.actor_id=actor AND r.request_key=$4;
    IF FOUND THEN
        IF existing.payload <> payload THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='PT409'; END IF;
        SELECT * INTO created FROM public.project_folders WHERE id=existing.folder_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
        RETURN jsonb_build_object('folder',to_jsonb(created),'idempotent',true);
    END IF;
    PERFORM private.check_project_folder_write_limit(actor);
    IF parent IS NOT NULL THEN
        WITH RECURSIVE ancestors AS (
            SELECT f.id,f.parent_id,1 AS depth FROM public.project_folders f WHERE f.id=parent AND f.workspace_id=workspace
            UNION ALL SELECT f.id,f.parent_id,a.depth+1 FROM public.project_folders f JOIN ancestors a ON f.id=a.parent_id WHERE a.depth<4
        ) SELECT max(depth) INTO parent_depth FROM ancestors;
        IF parent_depth IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
        IF parent_depth >= 4 THEN RAISE EXCEPTION 'FOLDER_DEPTH_LIMIT' USING ERRCODE='PT409'; END IF;
    END IF;
    IF (SELECT count(*) FROM public.project_folders f WHERE f.workspace_id=workspace) >= 200 THEN
        RAISE EXCEPTION 'LIMIT_REACHED' USING ERRCODE='PT429';
    END IF;
    INSERT INTO public.project_folders(workspace_id,parent_id,name) VALUES(workspace,parent,btrim(folder_name)) RETURNING * INTO created;
    INSERT INTO private.project_folder_requests(actor_id,request_key,payload,folder_id) VALUES(actor,request_key,payload,created.id);
    PERFORM private.audit_project_folder_change(workspace,created.id,'PROJECT_FOLDER_CREATED');
    RETURN jsonb_build_object('folder',to_jsonb(created),'idempotent',false);
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'NAME_CONFLICT' USING ERRCODE='PT409';
END $$;

CREATE OR REPLACE FUNCTION private.mutate_project_folder(folder uuid, expected_version integer, folder_name text, remove boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=auth.uid(); current public.project_folders; updated public.project_folders;
BEGIN
    IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,604));
    SELECT * INTO current FROM public.project_folders WHERE id=folder FOR UPDATE;
    IF NOT FOUND OR coalesce(private.workspace_role(current.workspace_id),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR') THEN
        RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';
    END IF;
    IF expected_version IS NULL OR current.version<>expected_version THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
    IF remove IS NULL OR (NOT remove AND (folder_name IS NULL OR char_length(btrim(folder_name)) NOT BETWEEN 1 AND 120 OR folder_name ~ '[[:cntrl:]]')) THEN
        RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='PT400';
    END IF;
    PERFORM private.check_project_folder_write_limit(actor);
    IF remove THEN
        IF EXISTS(SELECT 1 FROM public.project_folders WHERE parent_id=folder)
            OR EXISTS(SELECT 1 FROM public.projects WHERE folder_id=folder AND deleted_at IS NULL) THEN
            RAISE EXCEPTION 'FOLDER_NOT_EMPTY' USING ERRCODE='PT409';
        END IF;
        DELETE FROM public.project_folders WHERE id=folder RETURNING * INTO updated;
        PERFORM private.audit_project_folder_change(current.workspace_id,current.id,'PROJECT_FOLDER_DELETED');
        RETURN to_jsonb(updated);
    END IF;
    UPDATE public.project_folders SET name=btrim(folder_name),version=version+1,updated_at=now() WHERE id=folder RETURNING * INTO updated;
    PERFORM private.audit_project_folder_change(current.workspace_id,current.id,'PROJECT_FOLDER_RENAMED');
    RETURN to_jsonb(updated);
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'NAME_CONFLICT' USING ERRCODE='PT409';
END $$;

CREATE OR REPLACE FUNCTION private.move_project_to_folder(project uuid, expected_version integer, folder uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=auth.uid(); current public.projects; updated public.projects;
BEGIN
    IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,604));
    SELECT * INTO current FROM public.projects WHERE id=project AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR coalesce(private.project_role(project),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR') THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
    IF expected_version IS NULL OR current.version<>expected_version THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
    IF folder IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.project_folders f WHERE f.id=folder AND f.workspace_id=current.workspace_id) THEN
        RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';
    END IF;
    PERFORM private.check_project_folder_write_limit(actor);
    UPDATE public.projects SET folder_id=folder,version=version+1,updated_at=now() WHERE id=project RETURNING * INTO updated;
    PERFORM private.audit_project_folder_change(current.workspace_id,current.id,'PROJECT_FOLDER_MOVED');
    RETURN to_jsonb(updated);
END $$;

CREATE OR REPLACE FUNCTION public.create_project_folder(p_workspace_id uuid,p_parent_id uuid,p_name text,p_idempotency_key text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.create_project_folder(p_workspace_id,p_parent_id,p_name,p_idempotency_key); $$;
CREATE OR REPLACE FUNCTION public.mutate_project_folder(p_folder_id uuid,p_expected_version integer,p_name text,p_remove boolean DEFAULT false) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.mutate_project_folder(p_folder_id,p_expected_version,p_name,p_remove); $$;
CREATE OR REPLACE FUNCTION public.move_project_to_folder(p_project_id uuid,p_expected_version integer,p_folder_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.move_project_to_folder(p_project_id,p_expected_version,p_folder_id); $$;

REVOKE ALL ON FUNCTION private.clear_project_folder_on_delete(),private.check_project_folder_write_limit(uuid),private.audit_project_folder_change(uuid,uuid,text),private.create_project_folder(uuid,uuid,text,text),private.mutate_project_folder(uuid,integer,text,boolean),private.move_project_to_folder(uuid,integer,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.create_project_folder(uuid,uuid,text,text),private.mutate_project_folder(uuid,integer,text,boolean),private.move_project_to_folder(uuid,integer,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.create_project_folder(uuid,uuid,text,text),public.mutate_project_folder(uuid,integer,text,boolean),public.move_project_to_folder(uuid,integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_project_folder(uuid,uuid,text,text),public.mutate_project_folder(uuid,integer,text,boolean),public.move_project_to_folder(uuid,integer,uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
