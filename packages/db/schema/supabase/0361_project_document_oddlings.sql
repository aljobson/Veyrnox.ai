-- ADR-0246: bounded Oddlings collections, with a permanent editor/Oddlings kind lock.
-- Activation remains off until the owner-approved migration and 24-hour observation window.
BEGIN;

CREATE OR REPLACE FUNCTION private.project_oddling_picks_within_bounds(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT CASE WHEN jsonb_typeof(p) IS DISTINCT FROM 'object' THEN false ELSE coalesce(
        (SELECT count(*) FROM jsonb_object_keys(p)) <= 64
        AND NOT EXISTS (SELECT 1 FROM jsonb_each(p) AS pick(key, value) WHERE
            key !~ '^[a-z_]{1,40}$' OR key ~ U&'[\0001-\001F]'
            OR jsonb_typeof(value) IS DISTINCT FROM 'string'
            -- Match JS UTF-16 lengths: supplementary characters take two units.
            OR char_length(value #>> '{}') + char_length(regexp_replace(value #>> '{}', U&'[^\+010000-\+10FFFF]', '', 'g')) NOT BETWEEN 1 AND 160
            OR (value #>> '{}') ~ U&'[\0001-\001F]')
    , false) END;
$$;
REVOKE ALL ON FUNCTION private.project_oddling_picks_within_bounds(jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.project_oddlings_within_bounds(o jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT CASE WHEN jsonb_typeof(o) IS DISTINCT FROM 'object'
        OR jsonb_typeof(o->'items') IS DISTINCT FROM 'array' THEN false ELSE coalesce(
        o - ARRAY['version','items','draft'] = '{}'::jsonb AND o ?& ARRAY['version','items','draft']
        AND o->'version' = '1'::jsonb AND jsonb_array_length(o->'items') <= 24
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(o->'items') item WHERE NOT CASE
            WHEN jsonb_typeof(item) IS DISTINCT FROM 'object'
              OR jsonb_typeof(item->'savedAt') IS DISTINCT FROM 'number' THEN false
            ELSE coalesce(
                item - ARRAY['id','savedAt','name','picks','motionId'] = '{}'::jsonb
                AND item ?& ARRAY['id','savedAt','name','picks','motionId']
                AND jsonb_typeof(item->'id') = 'string' AND item->>'id' ~ '^[A-Za-z0-9._-]{1,80}$'
                AND (item->>'id') !~ U&'[\0001-\001F]'
                AND (item->>'savedAt')::numeric BETWEEN 0 AND 100000000000000
                AND (item->>'savedAt')::numeric = trunc((item->>'savedAt')::numeric)
                AND jsonb_typeof(item->'name') = 'string'
                AND char_length(item->>'name') + char_length(regexp_replace(item->>'name', U&'[^\+010000-\+10FFFF]', '', 'g')) BETWEEN 1 AND 40
                AND (item->>'name') !~ U&'[\0001-\001F]'
                AND jsonb_typeof(item->'motionId') = 'string' AND item->>'motionId' ~ '^[a-z0-9-]{0,40}$'
                AND (item->>'motionId') !~ U&'[\0001-\001F]'
                AND private.project_oddling_picks_within_bounds(item->'picks')
            , false) END)
        AND (SELECT count(DISTINCT item->>'id') FROM jsonb_array_elements(o->'items') item) = jsonb_array_length(o->'items')
        AND CASE WHEN o->'draft' = 'null'::jsonb THEN true
            WHEN jsonb_typeof(o->'draft') IS DISTINCT FROM 'object'
              OR jsonb_typeof(o->'draft'->'savedAt') IS DISTINCT FROM 'number' THEN false
            ELSE coalesce(
                (o->'draft') - ARRAY['savedAt','picks'] = '{}'::jsonb AND (o->'draft') ?& ARRAY['savedAt','picks']
                AND (o->'draft'->>'savedAt')::numeric BETWEEN 0 AND 100000000000000
                AND (o->'draft'->>'savedAt')::numeric = trunc((o->'draft'->>'savedAt')::numeric)
                AND private.project_oddling_picks_within_bounds(o->'draft'->'picks')
            , false) END
    , false) END;
$$;
REVOKE ALL ON FUNCTION private.project_oddlings_within_bounds(jsonb) FROM PUBLIC, anon, authenticated, service_role;

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
        OR coalesce(content->'schema_version', 'null'::jsonb) NOT IN ('1'::jsonb, '2'::jsonb, '3'::jsonb, '4'::jsonb)
        OR (content->'schema_version' = '1'::jsonb AND content - ARRAY['schema_version','project_id','brief','canvas'] <> '{}'::jsonb)
        OR (content->'schema_version' IN ('2'::jsonb, '3'::jsonb) AND (
               content - ARRAY['schema_version','project_id','brief','canvas','timeline'] <> '{}'::jsonb
            OR NOT (content ? 'timeline')
            OR NOT private.project_timeline_within_bounds(content->'timeline')
            OR (content->'schema_version' = '3'::jsonb AND content->'timeline'->'schemaVersion' IS DISTINCT FROM '3'::jsonb)
            OR (content->'schema_version' = '2'::jsonb AND content->'timeline'->'schemaVersion' = '3'::jsonb)))
        OR (content->'schema_version' = '4'::jsonb AND (
               content - ARRAY['schema_version','project_id','brief','canvas','oddlings'] <> '{}'::jsonb
            OR NOT (content ?& ARRAY['schema_version','project_id','brief','canvas','oddlings'])
            OR NOT private.project_oddlings_within_bounds(content->'oddlings')
            OR (content->>'brief') ~ U&'[\0001-\001F]'
            OR char_length(content->>'brief') + char_length(regexp_replace(content->>'brief', U&'[^\+010000-\+10FFFF]', '', 'g')) > 6000))
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
    -- The first revision fixes the project kind, including when restoring older work.
    IF head > 0 AND EXISTS (SELECT 1 FROM public.project_document_versions v
        WHERE v.project_id = project AND v.revision = head
          AND (v.document->'schema_version' = '4'::jsonb) <> (content->'schema_version' = '4'::jsonb)) THEN
        RAISE EXCEPTION 'KIND_CONFLICT' USING ERRCODE = 'PT409';
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
