-- Versioned project briefs and canvas settings. No media or billing changes.
BEGIN;
CREATE TABLE IF NOT EXISTS public.project_document_versions (
    project_id uuid NOT NULL REFERENCES public.projects(id),
    revision integer NOT NULL CHECK (revision > 0),
    document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object' AND octet_length(document::text) <= 32768),
    actor_id uuid NOT NULL, -- historical attribution survives Auth deletion
    created_at timestamptz NOT NULL DEFAULT now(),
    restored_from integer,
    expected_revision integer NOT NULL CHECK (expected_revision >= 0),
    request_key text NOT NULL CHECK (request_key ~ '^[A-Za-z0-9._-]{8,128}$'),
    PRIMARY KEY (project_id, revision),
    UNIQUE (project_id, actor_id, request_key),
    FOREIGN KEY (project_id, restored_from) REFERENCES public.project_document_versions(project_id, revision)
);
ALTER TABLE public.project_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_document_versions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_document_versions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (project_id,revision,document,actor_id,created_at,restored_from) ON public.project_document_versions TO authenticated;
DROP POLICY IF EXISTS document_read ON public.project_document_versions;
CREATE POLICY document_read ON public.project_document_versions FOR SELECT TO authenticated USING (private.project_role(project_id) IS NOT NULL);

CREATE OR REPLACE FUNCTION private.project_document_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'Project history is immutable' USING ERRCODE = '42501'; END $$;
DROP TRIGGER IF EXISTS project_document_immutable ON public.project_document_versions;
CREATE TRIGGER project_document_immutable BEFORE UPDATE OR DELETE ON public.project_document_versions
FOR EACH ROW EXECUTE FUNCTION private.project_document_immutable();

ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_action_check;
ALTER TABLE public.audit_events ADD CONSTRAINT audit_events_action_check CHECK (action IN (
    'PROJECT_CREATED','PROJECT_UPDATED','PROJECT_DELETED','PROJECT_DOCUMENT_SAVED','PROJECT_DOCUMENT_RESTORED'
));

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
CREATE OR REPLACE FUNCTION public.save_project_document(
    p_project_id uuid, p_expected_revision integer, p_document jsonb, p_idempotency_key text, p_restore_revision integer DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
    SELECT private.save_project_document(p_project_id,p_expected_revision,p_document,p_idempotency_key,p_restore_revision);
$$;
REVOKE ALL ON FUNCTION private.project_document_immutable(), private.save_project_document(uuid,integer,jsonb,text,integer),
    public.save_project_document(uuid,integer,jsonb,text,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.save_project_document(uuid,integer,jsonb,text,integer),
    public.save_project_document(uuid,integer,jsonb,text,integer) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
