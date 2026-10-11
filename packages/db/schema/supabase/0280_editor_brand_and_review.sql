-- Workspace brand styles and comments pinned to saved project revisions.
-- Additive; independent EDITOR_SHARED_TOOLS_ENABLED gate remains false.
BEGIN;
-- Historical actors retain UUIDs without an auth FK (0136); memberships authorize every operation.
CREATE TABLE IF NOT EXISTS public.workspace_editor_brand_kits (
    workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id),
    version integer NOT NULL CHECK(version>0), kit jsonb NOT NULL CHECK(octet_length(kit::text)<=12288),
    actor_id uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.project_editor_comments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES public.projects(id),
    revision integer NOT NULL CHECK(revision>0), frame integer NOT NULL CHECK(frame BETWEEN 0 AND 18000),
    body text NOT NULL CHECK(char_length(btrim(body)) BETWEEN 1 AND 2000),
    actor_id uuid NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version>0),
    resolved boolean NOT NULL DEFAULT false, resolved_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY(project_id,revision) REFERENCES public.project_document_versions(project_id,revision)
);
CREATE INDEX IF NOT EXISTS project_editor_comments_project ON public.project_editor_comments(project_id,revision,created_at DESC,id);
CREATE TABLE IF NOT EXISTS private.editor_requests (
    actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, operation text NOT NULL,
    key text NOT NULL CHECK(key ~ '^[A-Za-z0-9._-]{8,128}$'), payload jsonb NOT NULL, result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,operation,key)
);
CREATE INDEX IF NOT EXISTS editor_requests_actor_time ON private.editor_requests(actor_id,created_at DESC);
ALTER TABLE public.workspace_editor_brand_kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_editor_brand_kits FORCE ROW LEVEL SECURITY;
ALTER TABLE public.project_editor_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_editor_comments FORCE ROW LEVEL SECURITY;
ALTER TABLE private.editor_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.editor_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_editor_brand_kits,public.project_editor_comments FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.workspace_editor_brand_kits,public.project_editor_comments TO authenticated;
REVOKE ALL ON private.editor_requests FROM PUBLIC,anon,authenticated;
DROP POLICY IF EXISTS brand_kit_read ON public.workspace_editor_brand_kits;
CREATE POLICY brand_kit_read ON public.workspace_editor_brand_kits FOR SELECT TO authenticated USING(private.workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS editor_comment_read ON public.project_editor_comments;
CREATE POLICY editor_comment_read ON public.project_editor_comments FOR SELECT TO authenticated USING(private.project_role(project_id) IS NOT NULL);

CREATE OR REPLACE FUNCTION private.editor_brand_kit_valid(k jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE item jsonb; style jsonb; field text; n numeric; bounds jsonb;
BEGIN
    IF jsonb_typeof(k) IS DISTINCT FROM 'object' OR k-ARRAY['schemaVersion','name','palette','fonts','textStyles','assets']<>'{}'::jsonb OR k->'schemaVersion' IS DISTINCT FROM '1'::jsonb
        OR jsonb_typeof(k->'name') IS DISTINCT FROM 'string' OR char_length(btrim(k->>'name')) NOT BETWEEN 1 AND 80 OR k->>'name' ~ '[[:cntrl:]]' OR k->>'name' !~ '[^[:space:]]' OR octet_length(k::text)>12288 THEN RETURN false; END IF;
    IF jsonb_typeof(k->'palette') IS DISTINCT FROM 'array' OR jsonb_typeof(k->'fonts') IS DISTINCT FROM 'array' OR jsonb_typeof(k->'textStyles') IS DISTINCT FROM 'array' OR jsonb_typeof(k->'assets') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(k->'palette') NOT BETWEEN 1 AND 12 OR jsonb_array_length(k->'fonts') NOT BETWEEN 1 AND 10 OR jsonb_array_length(k->'textStyles')>12 OR jsonb_array_length(k->'assets')>24 THEN RETURN false; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(k->'palette') LOOP IF jsonb_typeof(item)<>'string' OR item#>>'{}' !~ '^#[0-9a-fA-F]{6}$' THEN RETURN false; END IF; END LOOP;
    FOR item IN SELECT value FROM jsonb_array_elements(k->'fonts') LOOP IF jsonb_typeof(item)<>'string' OR item#>>'{}' NOT IN ('sans-serif','serif','monospace','Arial','Helvetica','Verdana','Georgia','Times New Roman','Courier New','Impact') THEN RETURN false; END IF; END LOOP;
    FOR item IN SELECT value FROM jsonb_array_elements(k->'textStyles') LOOP
        IF jsonb_typeof(item)<>'object' OR item-ARRAY['name','size','style']<>'{}'::jsonb OR jsonb_typeof(item->'name') IS DISTINCT FROM 'string' OR char_length(btrim(item->>'name')) NOT BETWEEN 1 AND 80 OR item->>'name' ~ '[[:cntrl:]]' OR item->>'name' !~ '[^[:space:]]' OR jsonb_typeof(item->'size') IS DISTINCT FROM 'number' OR (item->>'size')::numeric NOT BETWEEN 2 AND 40 OR (item->>'size')::numeric<>trunc((item->>'size')::numeric) THEN RETURN false; END IF;
        style:=item->'style';
        IF jsonb_typeof(style) IS DISTINCT FROM 'object' OR NOT style ?& ARRAY['color','background','backgroundOpacity','stroke','strokeWidth','weight','font','align'] OR style-ARRAY['color','background','backgroundOpacity','stroke','strokeWidth','weight','font','align','italic','underline','letterSpacing','lineHeight','shadowColor','shadowOpacity','shadowBlur','shadowX','shadowY']<>'{}'::jsonb THEN RETURN false; END IF;
        IF coalesce(style->>'weight','') NOT IN ('normal','bold') OR coalesce(style->>'align','') NOT IN ('left','center','right') OR coalesce(style->>'font','') NOT IN ('sans-serif','serif','monospace','Arial','Helvetica','Verdana','Georgia','Times New Roman','Courier New','Impact') THEN RETURN false; END IF;
        FOREACH field IN ARRAY ARRAY['color','background','stroke','shadowColor'] LOOP IF (field<>'shadowColor' OR style ? field) AND (jsonb_typeof(style->field) IS DISTINCT FROM 'string' OR style->>field !~ '^#[0-9a-fA-F]{6}$') THEN RETURN false; END IF; END LOOP;
        FOREACH field IN ARRAY ARRAY['italic','underline'] LOOP IF style ? field AND jsonb_typeof(style->field)<>'boolean' THEN RETURN false; END IF; END LOOP;
        bounds:='{"backgroundOpacity":[0,1],"strokeWidth":[0,12],"letterSpacing":[-10,30],"lineHeight":[0.8,3],"shadowOpacity":[0,1],"shadowBlur":[0,30],"shadowX":[-50,50],"shadowY":[-50,50]}'::jsonb;
        FOR field IN SELECT jsonb_object_keys(bounds) LOOP IF field IN ('backgroundOpacity','strokeWidth') OR style ? field THEN IF jsonb_typeof(style->field) IS DISTINCT FROM 'number' THEN RETURN false; END IF;n:=(style->>field)::numeric;IF n<(bounds->field->>0)::numeric OR n>(bounds->field->>1)::numeric THEN RETURN false; END IF;END IF;END LOOP;
    END LOOP;
    FOR item IN SELECT value FROM jsonb_array_elements(k->'assets') LOOP
        IF jsonb_typeof(item)<>'object' OR item-ARRAY['projectId','assetId','name','credit','usage','url']<>'{}'::jsonb OR NOT item ?& ARRAY['projectId','assetId','name','credit','usage','url'] THEN RETURN false;END IF;
        FOREACH field IN ARRAY ARRAY['projectId','assetId'] LOOP IF jsonb_typeof(item->field)<>'string' OR item->>field !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false;END IF;END LOOP;
        FOREACH field IN ARRAY ARRAY['name','credit','usage','url'] LOOP IF jsonb_typeof(item->field)<>'string' OR item->>field ~ '[[:cntrl:]]' THEN RETURN false;END IF;END LOOP;
        IF char_length(btrim(item->>'name')) NOT BETWEEN 1 AND 120 OR char_length(item->>'credit')>120 OR char_length(item->>'usage')>240 OR char_length(item->>'url')>1000 OR (item->>'url'<>'' AND item->>'url' !~ '^https://[^/@[:space:]]+([/?#]|$)') THEN RETURN false;END IF;
    END LOOP;
    RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION private.editor_brand_kit_valid(jsonb) FROM PUBLIC,anon,authenticated;

-- Called only by the internal writers after their resource permission checks.
-- Idempotency receipts are retained for seven days; writes cap at 30/min, 500/day.
CREATE OR REPLACE FUNCTION private.editor_request_probe(op text,request_key text,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); receipt private.editor_requests;
BEGIN
    IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401';END IF;
    IF request_key IS NULL OR request_key !~ '^[A-Za-z0-9._-]{8,128}$' THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='PT400';END IF;
    DELETE FROM private.editor_requests r WHERE r.actor_id=actor AND r.created_at<now()-interval '7 days';
    SELECT * INTO receipt FROM private.editor_requests r WHERE r.actor_id=actor AND r.operation=op AND r.key=request_key;
    IF FOUND THEN IF receipt.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='PT409';END IF;RETURN receipt.result || '{"idempotent":true}'::jsonb;END IF;
    IF (SELECT count(*) FROM private.editor_requests r WHERE r.actor_id=actor AND r.created_at>now()-interval '1 minute')>=30 OR (SELECT count(*) FROM private.editor_requests r WHERE r.actor_id=actor AND r.created_at>now()-interval '1 day')>=500 THEN RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE='PT429';END IF;
    RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.editor_request_probe(text,text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.read_editor_brand_kit(workspace uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE role text:=private.workspace_role(workspace); saved public.workspace_editor_brand_kits;
BEGIN
    IF role IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
    SELECT * INTO saved FROM public.workspace_editor_brand_kits WHERE workspace_id=workspace;
    RETURN jsonb_build_object('kit',saved.kit,'version',coalesce(saved.version,0),'canEdit',role IN ('OWNER','ADMIN','CREATOR','EDITOR'));
END $$;
CREATE OR REPLACE FUNCTION private.save_editor_brand_kit(workspace uuid,expected integer,kit jsonb,request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); head integer; payload jsonb; result jsonb; item jsonb;
BEGIN
    IF coalesce(private.workspace_role(workspace),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR') THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
    IF expected IS NULL OR expected<0 OR expected>=2147483647 OR NOT private.editor_brand_kit_valid(kit) THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='PT400';END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,85));PERFORM 1 FROM public.workspaces WHERE id=workspace FOR UPDATE;
    -- Recheck permissions after acquiring the resource lock, including soft deletion.
    IF coalesce(private.workspace_role(workspace),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR') THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
    payload:=jsonb_build_object('workspace',workspace,'expected',expected,'kit',kit);result:=private.editor_request_probe('brand.save',request_key,payload);IF result IS NOT NULL THEN RETURN result;END IF;
    SELECT coalesce(max(version),0) INTO head FROM public.workspace_editor_brand_kits WHERE workspace_id=workspace;
    IF head<>expected THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='PT409';END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(kit->'assets') LOOP
        IF NOT EXISTS(SELECT 1 FROM public.project_assets a JOIN public.projects p ON p.id=a.project_id WHERE a.id=(item->>'assetId')::uuid AND p.id=(item->>'projectId')::uuid AND p.workspace_id=workspace AND a.state='inspected' AND private.project_role(p.id) IS NOT NULL) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
    END LOOP;
    INSERT INTO public.workspace_editor_brand_kits(workspace_id,version,kit,actor_id) VALUES(workspace,head+1,kit,actor) ON CONFLICT(workspace_id) DO UPDATE SET version=EXCLUDED.version,kit=EXCLUDED.kit,actor_id=EXCLUDED.actor_id,updated_at=now();
    result:=jsonb_build_object('kit',kit,'version',head+1,'canEdit',true,'idempotent',false);
    INSERT INTO private.editor_requests(actor_id,operation,key,payload,result) VALUES(actor,'brand.save',request_key,payload,result);RETURN result;
END $$;

DROP FUNCTION IF EXISTS public.read_editor_review(uuid,integer);
DROP FUNCTION IF EXISTS private.read_editor_review(uuid,integer);
CREATE OR REPLACE FUNCTION private.read_editor_review(project uuid,revision integer,before_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE role text:=private.project_role(project); result jsonb; total integer; anchor public.project_editor_comments; more boolean; cursor uuid;
BEGIN
    IF role IS NULL OR NOT EXISTS(SELECT 1 FROM public.project_document_versions v WHERE v.project_id=project AND v.revision=read_editor_review.revision) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
    IF before_id IS NOT NULL THEN SELECT * INTO anchor FROM public.project_editor_comments c WHERE c.id=before_id AND c.project_id=project AND c.revision=read_editor_review.revision;IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;END IF;
    SELECT count(*) INTO total FROM public.project_editor_comments c WHERE c.project_id=project AND c.revision=read_editor_review.revision;
    SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.created_at DESC,c.id DESC),'[]'::jsonb) INTO result FROM (SELECT * FROM public.project_editor_comments WHERE project_id=project AND project_editor_comments.revision=read_editor_review.revision AND (before_id IS NULL OR (created_at,id)<(anchor.created_at,anchor.id)) ORDER BY created_at DESC,id DESC LIMIT 21) c;
    more:=jsonb_array_length(result)>20;IF more THEN cursor:=(result->19->>'id')::uuid;SELECT jsonb_agg(value ORDER BY ordinal) INTO result FROM jsonb_array_elements(result) WITH ORDINALITY v(value,ordinal) WHERE ordinal<=20;END IF;
    RETURN jsonb_build_object('comments',result,'total',total,'truncated',total>20,'nextCursor',cursor,'canComment',role IN ('OWNER','ADMIN','CREATOR','EDITOR','REVIEWER'),'canResolve',role IN ('OWNER','ADMIN','CREATOR','EDITOR'));
END $$;
CREATE OR REPLACE FUNCTION private.editor_review_frame_valid(project uuid,revision integer,frame integer) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE content jsonb; c jsonb; ending integer:=0; video_end integer:=0;
BEGIN
    SELECT document INTO content FROM public.project_document_versions v WHERE v.project_id=project AND v.revision=editor_review_frame_valid.revision;
    IF content->'timeline'->>'schemaVersion'='3' THEN
        FOR c IN SELECT value FROM jsonb_array_elements((content->'timeline'->'video')||(content->'timeline'->'audio')||(content->'timeline'->'text')) LOOP ending:=greatest(ending,((c->>'start')::numeric+(c->>'len')::numeric)::integer);END LOOP;
    ELSIF content->'timeline'->>'schemaVersion'='2' THEN
        FOR c IN SELECT value FROM jsonb_array_elements(content->'timeline'->'video') LOOP video_end:=video_end+(c->>'len')::integer;END LOOP;ending:=video_end;
        FOR c IN SELECT value FROM jsonb_array_elements((content->'timeline'->'audio')||(content->'timeline'->'text')) LOOP ending:=greatest(ending,((c->>'start')::numeric+(c->>'len')::numeric)::integer);END LOOP;
    END IF;
    RETURN frame BETWEEN 0 AND greatest(0,ending-1);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION private.editor_review_frame_valid(uuid,integer,integer) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.add_editor_review_comment(project uuid,revision integer,frame integer,body text,request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); payload jsonb; result jsonb; saved public.project_editor_comments;
BEGIN
    IF coalesce(private.project_role(project),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR','REVIEWER') THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
    IF revision IS NULL OR revision<1 OR frame IS NULL OR frame NOT BETWEEN 0 AND 18000 OR body IS NULL OR char_length(btrim(body)) NOT BETWEEN 1 AND 2000 OR body !~ '[^[:space:]]' OR body ~ '[\u0001-\u0008\u000b-\u001f\u007f]' THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='PT400';END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,85));PERFORM 1 FROM public.projects WHERE id=project FOR UPDATE;
    IF coalesce(private.project_role(project),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR','REVIEWER') THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
    payload:=jsonb_build_object('project',project,'revision',revision,'frame',frame,'body',body);result:=private.editor_request_probe('review.add',request_key,payload);IF result IS NOT NULL THEN RETURN result;END IF;
    IF NOT EXISTS(SELECT 1 FROM public.project_document_versions v WHERE v.project_id=project AND v.revision=add_editor_review_comment.revision) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
    IF NOT private.editor_review_frame_valid(project,revision,frame) THEN RAISE EXCEPTION 'INVALID_FRAME' USING ERRCODE='PT400';END IF;
    IF (SELECT count(*) FROM public.project_editor_comments WHERE project_id=project)>=2000 THEN RAISE EXCEPTION 'LIMIT_REACHED' USING ERRCODE='PT429';END IF;
    INSERT INTO public.project_editor_comments(project_id,revision,frame,body,actor_id) VALUES(project,revision,frame,body,actor) RETURNING * INTO saved;
    result:=jsonb_build_object('comment',to_jsonb(saved),'idempotent',false);INSERT INTO private.editor_requests(actor_id,operation,key,payload,result) VALUES(actor,'review.add',request_key,payload,result);RETURN result;
END $$;
CREATE OR REPLACE FUNCTION private.resolve_editor_review_comment(project uuid,comment uuid,expected integer,resolved boolean,request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); payload jsonb; result jsonb; saved public.project_editor_comments;
BEGIN
    IF coalesce(private.project_role(project),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR') THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
    IF expected IS NULL OR expected<1 OR expected>=2147483647 OR resolved IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='PT400';END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,85));PERFORM 1 FROM public.projects WHERE id=project FOR UPDATE;
    IF coalesce(private.project_role(project),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR') THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
    payload:=jsonb_build_object('project',project,'comment',comment,'expected',expected,'resolved',resolved);result:=private.editor_request_probe('review.resolve',request_key,payload);IF result IS NOT NULL THEN RETURN result;END IF;
    SELECT * INTO saved FROM public.project_editor_comments c WHERE c.id=comment AND c.project_id=project;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;IF saved.version<>expected THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='PT409';END IF;
    UPDATE public.project_editor_comments c SET resolved=resolve_editor_review_comment.resolved,resolved_by=CASE WHEN resolve_editor_review_comment.resolved THEN actor ELSE NULL END,version=c.version+1,updated_at=now() WHERE c.id=comment RETURNING * INTO saved;
    result:=jsonb_build_object('comment',to_jsonb(saved),'idempotent',false);INSERT INTO private.editor_requests(actor_id,operation,key,payload,result) VALUES(actor,'review.resolve',request_key,payload,result);RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.read_editor_brand_kit(p_workspace_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.read_editor_brand_kit(p_workspace_id)$$;
CREATE OR REPLACE FUNCTION public.save_editor_brand_kit(p_workspace_id uuid,p_expected_version integer,p_kit jsonb,p_idempotency_key text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.save_editor_brand_kit(p_workspace_id,p_expected_version,p_kit,p_idempotency_key)$$;
CREATE OR REPLACE FUNCTION public.read_editor_review(p_project_id uuid,p_revision integer,p_before_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.read_editor_review(p_project_id,p_revision,p_before_id)$$;
CREATE OR REPLACE FUNCTION public.add_editor_review_comment(p_project_id uuid,p_revision integer,p_frame integer,p_body text,p_idempotency_key text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.add_editor_review_comment(p_project_id,p_revision,p_frame,p_body,p_idempotency_key)$$;
CREATE OR REPLACE FUNCTION public.resolve_editor_review_comment(p_project_id uuid,p_comment_id uuid,p_expected_version integer,p_resolved boolean,p_idempotency_key text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.resolve_editor_review_comment(p_project_id,p_comment_id,p_expected_version,p_resolved,p_idempotency_key)$$;
REVOKE ALL ON FUNCTION private.read_editor_brand_kit(uuid),private.save_editor_brand_kit(uuid,integer,jsonb,text),private.read_editor_review(uuid,integer,uuid),private.add_editor_review_comment(uuid,integer,integer,text,text),private.resolve_editor_review_comment(uuid,uuid,integer,boolean,text),public.read_editor_brand_kit(uuid),public.save_editor_brand_kit(uuid,integer,jsonb,text),public.read_editor_review(uuid,integer,uuid),public.add_editor_review_comment(uuid,integer,integer,text,text),public.resolve_editor_review_comment(uuid,uuid,integer,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.read_editor_brand_kit(uuid),private.save_editor_brand_kit(uuid,integer,jsonb,text),private.read_editor_review(uuid,integer,uuid),private.add_editor_review_comment(uuid,integer,integer,text,text),private.resolve_editor_review_comment(uuid,uuid,integer,boolean,text),public.read_editor_brand_kit(uuid),public.save_editor_brand_kit(uuid,integer,jsonb,text),public.read_editor_review(uuid,integer,uuid),public.add_editor_review_comment(uuid,integer,integer,text,text),public.resolve_editor_review_comment(uuid,uuid,integer,boolean,text) TO authenticated;
COMMIT;
