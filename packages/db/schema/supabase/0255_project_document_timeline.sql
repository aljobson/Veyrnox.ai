-- Project document v2 (ADR-0080, slice 3): a project document may carry the browser editor's timeline. `schema_version`
-- 2 has exactly the v1 keys plus `timeline`, which is null or a timeline document (schemaVersion 2, 30 fps, at most 24 files,
-- 10 video clips, 10 sounds and 10 texts). This function only bounds the shape; the Worker route validates every number
-- (app/veyrnox/_lib/editorTimeline.mjs#validateTimeline) and refuses anything else. v1 documents keep saving as before.
--
-- The body of private.save_project_document below is 0254's (the tenant write caps: 1,000 revisions per project and 2,000
-- document saves per actor per day, each LIMIT_REACHED / PT429) with only the contract check changed. 0255 must stay the later
-- number so the caps are never lost; a later rewrite of this function must carry both.
--
-- Idempotent: OR REPLACE, the same revokes and grants by full signature.
BEGIN;

CREATE OR REPLACE FUNCTION private.project_timeline_within_bounds(t jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT t IS NULL OR jsonb_typeof(t) = 'null' OR (
        jsonb_typeof(t) = 'object'
        AND t - ARRAY['schemaVersion','fps','seq','aspect','media','video','audio','text'] = '{}'::jsonb
        AND t->'schemaVersion' = '2'::jsonb AND t->'fps' = '30'::jsonb
        AND jsonb_typeof(t->'seq') = 'number' AND (t->>'seq')::numeric BETWEEN 0 AND 1000000
        AND coalesce(t->>'aspect','') IN ('source','16:9','9:16','1:1')
        AND jsonb_typeof(t->'media') = 'object' AND (SELECT count(*) FROM jsonb_object_keys(t->'media')) <= 24
        AND jsonb_typeof(t->'video') = 'array' AND jsonb_array_length(t->'video') <= 10
        AND jsonb_typeof(t->'audio') = 'array' AND jsonb_array_length(t->'audio') <= 10
        AND jsonb_typeof(t->'text') = 'array' AND jsonb_array_length(t->'text') <= 10
    );
$$;
REVOKE ALL ON FUNCTION private.project_timeline_within_bounds(jsonb) FROM PUBLIC, anon, authenticated, service_role;

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
    -- Enforce the canonical contract even on direct PostgREST calls: v1 (brief and canvas) or v2 (0255: plus `timeline`,
    -- the browser editor's document or null, bounded by private.project_timeline_within_bounds; the Worker validates it in full).
    IF jsonb_typeof(content) IS DISTINCT FROM 'object'
        OR content->'schema_version' NOT IN ('1'::jsonb, '2'::jsonb)
        OR (content->'schema_version' = '1'::jsonb AND content - ARRAY['schema_version','project_id','brief','canvas'] <> '{}'::jsonb)
        OR (content->'schema_version' = '2'::jsonb AND (
               content - ARRAY['schema_version','project_id','brief','canvas','timeline'] <> '{}'::jsonb
            OR NOT (content ? 'timeline')
            OR NOT private.project_timeline_within_bounds(content->'timeline')))
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

REVOKE ALL ON FUNCTION private.save_project_document(uuid,integer,jsonb,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.save_project_document(uuid,integer,jsonb,text,integer) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
