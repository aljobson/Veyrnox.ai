-- Persist the editor document shapes already accepted by the shared JS contract:
-- 4:5/custom canvases, optional covers, and server-derived editing summaries.
-- This migration is authored only; deployment remains a separate release action.
BEGIN;

CREATE OR REPLACE FUNCTION private.project_canvas_aspect_within_bounds(value text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE parts text[]; width integer; height integer;
BEGIN
    IF value IN ('16:9','9:16','1:1','4:5') THEN RETURN true; END IF;
    parts:=regexp_match(value,'^custom:([1-9][0-9]{0,2})x([1-9][0-9]{0,2})$');
    IF parts IS NULL THEN RETURN false; END IF;
    width:=parts[1]::integer; height:=parts[2]::integer;
    RETURN width<=100 AND height<=100 AND width*4>=height AND width<=height*4
       AND NOT EXISTS(SELECT 1 FROM generate_series(2,least(width,height)) divisor
                      WHERE width%divisor=0 AND height%divisor=0);
END $$;

CREATE OR REPLACE FUNCTION private.project_cover_within_bounds(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE frame_value numeric; cover_text text;
BEGIN
    IF jsonb_typeof(value) IS DISTINCT FROM 'object'
       OR value-ARRAY['frame','text','text_color']<>'{}'::jsonb
       OR NOT value?&ARRAY['frame','text','text_color']
       OR jsonb_typeof(value->'frame') IS DISTINCT FROM 'number'
       OR jsonb_typeof(value->'text') IS DISTINCT FROM 'string'
       OR jsonb_typeof(value->'text_color') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    frame_value:=(value->>'frame')::numeric; cover_text:=value->>'text';
    RETURN frame_value=trunc(frame_value) AND frame_value BETWEEN 0 AND 2147483646
       AND char_length(cover_text)+char_length(regexp_replace(cover_text,U&'[^\+010000-\+10FFFF]','','g'))<=120
       AND value->>'text_color' ~ '^#[0-9A-Fa-f]{6}$';
END $$;

CREATE OR REPLACE FUNCTION private.project_editing_summary_within_bounds(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE source_frames numeric; edited_frames numeric; frames_per_second numeric;
BEGIN
    IF jsonb_typeof(value) IS DISTINCT FROM 'object'
       OR value-ARRAY['source_frames','edited_frames','fps']<>'{}'::jsonb
       OR NOT value?&ARRAY['source_frames','edited_frames','fps']
       OR EXISTS(SELECT 1 FROM jsonb_each(value) entry WHERE jsonb_typeof(entry.value) IS DISTINCT FROM 'number') THEN RETURN false; END IF;
    source_frames:=(value->>'source_frames')::numeric; edited_frames:=(value->>'edited_frames')::numeric; frames_per_second:=(value->>'fps')::numeric;
    RETURN source_frames=trunc(source_frames) AND edited_frames=trunc(edited_frames) AND frames_per_second=trunc(frames_per_second)
       AND source_frames BETWEEN 1 AND 9007199254740991 AND edited_frames BETWEEN 1 AND 9007199254740991
       AND frames_per_second BETWEEN 1 AND 9007199254740991 AND source_frames>edited_frames;
END $$;

-- Reuse the established bounded timeline validator after replacing only the
-- newly widened aspect value. All clip/media/track limits remain unchanged.
CREATE OR REPLACE FUNCTION private.project_editor_timeline_within_bounds(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
    SELECT CASE WHEN value IS NULL OR jsonb_typeof(value)='null' THEN true
      WHEN jsonb_typeof(value) IS DISTINCT FROM 'object'
        OR NOT (value->>'aspect'='source' OR private.project_canvas_aspect_within_bounds(value->>'aspect')) THEN false
      ELSE private.project_timeline_within_bounds(jsonb_set(value,'{aspect}','"1:1"'::jsonb,false)) END;
$$;

CREATE OR REPLACE FUNCTION private.project_document_within_bounds(content jsonb, project uuid) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE schema_version integer; brief_text text;
BEGIN
    IF jsonb_typeof(content) IS DISTINCT FROM 'object'
       OR jsonb_typeof(content->'schema_version') IS DISTINCT FROM 'number'
       OR content->>'schema_version' NOT IN ('1','2','3','4')
       OR jsonb_typeof(content->'project_id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(content->'brief') IS DISTINCT FROM 'string'
       OR jsonb_typeof(content->'canvas') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    schema_version:=(content->>'schema_version')::integer; brief_text:=content->>'brief';
    IF schema_version NOT IN (1,2,3,4) OR content->>'project_id' IS DISTINCT FROM project::text
       OR char_length(brief_text)+char_length(regexp_replace(brief_text,U&'[^\+010000-\+10FFFF]','','g'))>6000
       OR (content->'canvas')-ARRAY['aspect_ratio','frame_rate']<>'{}'::jsonb
       OR NOT ((content->'canvas')?&ARRAY['aspect_ratio','frame_rate'])
       OR NOT private.project_canvas_aspect_within_bounds(content#>>'{canvas,aspect_ratio}')
       OR coalesce(content#>'{canvas,frame_rate}','null'::jsonb) NOT IN ('24'::jsonb,'25'::jsonb,'30'::jsonb,'60'::jsonb)
       OR octet_length(content::text)>32768 THEN RETURN false; END IF;
    IF schema_version=1 THEN
        RETURN content-ARRAY['schema_version','project_id','brief','canvas','cover']='{}'::jsonb
           AND (NOT (content?'cover') OR private.project_cover_within_bounds(content->'cover'));
    ELSIF schema_version IN (2,3) THEN
        RETURN content-ARRAY['schema_version','project_id','brief','canvas','timeline','cover','editing_summary']='{}'::jsonb
           AND content?'timeline'
           AND (NOT (content?'cover') OR private.project_cover_within_bounds(content->'cover'))
           AND (NOT (content?'editing_summary') OR private.project_editing_summary_within_bounds(content->'editing_summary'))
           AND private.project_editor_timeline_within_bounds(content->'timeline')
           AND (schema_version<>3 OR content->'timeline'->'schemaVersion'='3'::jsonb)
           AND (schema_version<>2 OR content->'timeline'->'schemaVersion' IS DISTINCT FROM '3'::jsonb);
    END IF;
    RETURN content-ARRAY['schema_version','project_id','brief','canvas','oddlings']='{}'::jsonb
       AND content?&ARRAY['schema_version','project_id','brief','canvas','oddlings']
       AND private.project_oddlings_within_bounds(content->'oddlings');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION private.save_project_document(
    project uuid, expected integer, content jsonb, request_key text, restore_revision integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    actor uuid:=auth.uid(); existing public.project_document_versions; saved public.project_document_versions;
    head integer; org uuid; request_id uuid; raw_id text; restored jsonb;
BEGIN
    IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,34));
    PERFORM 1 FROM public.projects WHERE id=project FOR UPDATE;
    IF coalesce(private.project_role(project),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR') THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
    IF expected IS NULL OR expected<0 OR request_key IS NULL OR request_key!~'^[A-Za-z0-9._-]{8,128}$'
       OR (restore_revision IS NOT NULL AND (restore_revision<1 OR content IS NOT NULL))
       OR (restore_revision IS NULL AND content IS NULL) THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='PT400'; END IF;
    SELECT * INTO existing FROM public.project_document_versions v
     WHERE v.project_id=project AND v.actor_id=actor AND v.request_key=save_project_document.request_key;
    IF FOUND THEN
        IF existing.expected_revision<>expected OR existing.restored_from IS DISTINCT FROM restore_revision
           OR (restore_revision IS NULL AND existing.document IS DISTINCT FROM content) THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='PT409'; END IF;
        RETURN jsonb_build_object('revision',existing.revision,'document',existing.document,'created_at',existing.created_at,'restored_from',existing.restored_from,'idempotent',true);
    END IF;
    SELECT coalesce(max(v.revision),0) INTO head FROM public.project_document_versions v WHERE v.project_id=project;
    IF expected<>head THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
    IF head>=1000 THEN RAISE EXCEPTION 'LIMIT_REACHED' USING ERRCODE='PT429',DETAIL='project_revisions'; END IF;
    IF restore_revision IS NOT NULL THEN
        SELECT v.document INTO restored FROM public.project_document_versions v WHERE v.project_id=project AND v.revision=restore_revision;
        IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
        content:=restored;
    END IF;
    IF NOT private.project_document_within_bounds(content,project) THEN RAISE EXCEPTION 'INVALID_DOCUMENT' USING ERRCODE='PT400'; END IF;
    IF head>0 AND EXISTS(SELECT 1 FROM public.project_document_versions v WHERE v.project_id=project AND v.revision=head
       AND (v.document->'schema_version'='4'::jsonb)<>(content->'schema_version'='4'::jsonb)) THEN RAISE EXCEPTION 'KIND_CONFLICT' USING ERRCODE='PT409'; END IF;
    IF (SELECT count(*) FROM public.audit_events WHERE actor_id=actor AND created_at>now()-interval '1 minute')>=30 THEN RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE='PT429'; END IF;
    IF (SELECT count(*) FROM public.audit_events e WHERE e.actor_id=actor AND e.created_at>now()-interval '1 day'
       AND e.action IN ('PROJECT_DOCUMENT_SAVED','PROJECT_DOCUMENT_RESTORED'))>=2000 THEN RAISE EXCEPTION 'LIMIT_REACHED' USING ERRCODE='PT429',DETAIL='daily_document_saves'; END IF;
    INSERT INTO public.project_document_versions(project_id,revision,document,actor_id,restored_from,expected_revision,request_key)
     VALUES(project,head+1,content,actor,restore_revision,expected,request_key) RETURNING * INTO saved;
    SELECT w.organisation_id INTO org FROM public.projects p JOIN public.workspaces w ON w.id=p.workspace_id WHERE p.id=project;
    raw_id:=nullif(current_setting('request.headers',true),'')::jsonb->>'x-request-id';
    BEGIN request_id:=raw_id::uuid; EXCEPTION WHEN invalid_text_representation THEN request_id:=NULL; END;
    INSERT INTO public.audit_events(request_id,actor_id,organisation_id,action,resource_id)
     VALUES(coalesce(request_id,gen_random_uuid()),actor,org,CASE WHEN restore_revision IS NULL THEN 'PROJECT_DOCUMENT_SAVED' ELSE 'PROJECT_DOCUMENT_RESTORED' END,project);
    RETURN jsonb_build_object('revision',saved.revision,'document',saved.document,'created_at',saved.created_at,'restored_from',saved.restored_from,'idempotent',false);
END $$;

REVOKE ALL ON FUNCTION private.project_canvas_aspect_within_bounds(text),private.project_cover_within_bounds(jsonb),
 private.project_editing_summary_within_bounds(jsonb),private.project_editor_timeline_within_bounds(jsonb),private.project_document_within_bounds(jsonb,uuid),
 private.save_project_document(uuid,integer,jsonb,text,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.save_project_document(uuid,integer,jsonb,text,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
