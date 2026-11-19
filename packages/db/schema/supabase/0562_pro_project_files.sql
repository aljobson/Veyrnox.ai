-- ADR-0362: immutable JSON project files, revision heads and fenced physical cleanup.
BEGIN;
CREATE TABLE IF NOT EXISTS public.project_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES public.projects(id),
 kind text NOT NULL DEFAULT 'pro_project' CHECK (kind='pro_project'),
 r2_key text NOT NULL UNIQUE CHECK (r2_key ~ '^org/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/project/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/file/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/v1\.fcproj$'),
 state text NOT NULL DEFAULT 'quarantined' CHECK (state IN ('quarantined','inspected','rejected')),
 cleanup_state text NOT NULL DEFAULT 'live' CHECK (cleanup_state IN ('live','claimed','purged')),
 declared_bytes bigint NOT NULL CHECK (declared_bytes BETWEEN 1 AND 8388608),
 byte_size bigint CHECK (byte_size BETWEEN 1 AND 8388608),
 content_sha256 text CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
 schema_version integer CHECK (schema_version >= 1), -- the upper bound lives only in lib/proProjectScan.mjs (MAX_SCHEMA)
 content_fingerprint text CHECK (content_fingerprint ~ '^[0-9a-f]{64}$'),
 label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 120 AND label !~ '[/\\[:cntrl:]]'),
 actor_id uuid NOT NULL, -- historical attribution, deliberately no user FK
 request_key text NOT NULL CHECK (request_key ~ '^[A-Za-z0-9._-]{8,128}$'),
 reject_reason text CHECK (reject_reason IN ('invalid_json','invalid_utf8','invalid_shape','invalid_format','invalid_schema','invalid_project','size_mismatch','too_deep','too_complex','too_large')),
 created_at timestamptz NOT NULL DEFAULT now(), inspected_at timestamptz,
 claim_key uuid, claimed_at timestamptz, purged_at timestamptz,
 cleanup_attempts integer NOT NULL DEFAULT 0 CHECK (cleanup_attempts>=0),
 cleanup_last_error text CHECK (cleanup_last_error IN ('delete_failed','finish_failed','invalid_key')),
 UNIQUE(project_id,actor_id,request_key),
 CONSTRAINT project_files_verdict_complete CHECK (
  (state='quarantined' AND inspected_at IS NULL AND byte_size IS NULL AND content_sha256 IS NULL AND schema_version IS NULL AND content_fingerprint IS NULL AND reject_reason IS NULL)
  OR (state='inspected' AND inspected_at IS NOT NULL AND byte_size=declared_bytes AND byte_size IS NOT NULL AND content_sha256 IS NOT NULL AND schema_version IS NOT NULL AND content_fingerprint IS NOT NULL AND reject_reason IS NULL)
  OR (state='rejected' AND inspected_at IS NOT NULL AND reject_reason IS NOT NULL AND byte_size IS NULL AND content_sha256 IS NULL AND schema_version IS NULL AND content_fingerprint IS NULL)),
 CHECK ((cleanup_state='live' AND claim_key IS NULL AND claimed_at IS NULL AND purged_at IS NULL)
  OR (cleanup_state='claimed' AND claim_key IS NOT NULL AND claimed_at IS NOT NULL AND purged_at IS NULL)
  OR (cleanup_state='purged' AND claim_key IS NOT NULL AND claimed_at IS NOT NULL AND purged_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS public.project_pro_heads (
 project_id uuid NOT NULL REFERENCES public.projects(id), revision integer NOT NULL CHECK (revision BETWEEN 1 AND 1000),
 file_id uuid NOT NULL REFERENCES public.project_files(id), actor_id uuid NOT NULL,
 expected_revision integer NOT NULL CHECK (expected_revision>=0 AND revision=expected_revision+1),
 request_key text NOT NULL CHECK (request_key ~ '^[A-Za-z0-9._-]{8,128}$'),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(project_id,revision), UNIQUE(project_id,actor_id,request_key)
);
CREATE INDEX IF NOT EXISTS project_files_project ON public.project_files(project_id,created_at,id);
CREATE INDEX IF NOT EXISTS project_files_cleanup ON public.project_files(cleanup_state,created_at);
CREATE INDEX IF NOT EXISTS project_pro_heads_file ON public.project_pro_heads(file_id);
-- Rate-limit bookkeeping lives here, not in audit_events: audit rows share a 30-per-minute budget
-- with save_project_document, create_project, mutate_project and reserve_project_asset.
CREATE TABLE IF NOT EXISTS private.project_file_requests (
 actor_id uuid NOT NULL, kind text NOT NULL CHECK (kind IN ('reserve','inspect')), requested_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS project_file_requests_actor ON private.project_file_requests(actor_id,kind,requested_at);
ALTER TABLE private.project_file_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.project_file_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.project_file_requests FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.project_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_files FORCE ROW LEVEL SECURITY;
ALTER TABLE public.project_pro_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_pro_heads FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_files,public.project_pro_heads FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT(id,project_id,kind,r2_key,state,cleanup_state,declared_bytes,byte_size,content_sha256,schema_version,content_fingerprint,label,actor_id,reject_reason,created_at,inspected_at) ON public.project_files TO authenticated;
GRANT SELECT(project_id,revision,file_id,actor_id,created_at) ON public.project_pro_heads TO authenticated;
GRANT SELECT ON public.project_files,public.project_pro_heads TO service_role;
REVOKE INSERT,UPDATE ON public.project_files,public.project_pro_heads FROM service_role;
DROP POLICY IF EXISTS project_file_read ON public.project_files;
-- Write roles only until the owner signs off on viewers downloading arbitrary project bytes
-- (no upload-admission gate covers this JSON surface) and the media manifest exists.
CREATE POLICY project_file_read ON public.project_files FOR SELECT TO authenticated USING (
 private.project_role(project_id) IN ('OWNER','ADMIN','CREATOR','EDITOR'));
DROP POLICY IF EXISTS project_pro_head_read ON public.project_pro_heads;
CREATE POLICY project_pro_head_read ON public.project_pro_heads FOR SELECT TO authenticated USING (
 private.project_role(project_id) IN ('OWNER','ADMIN','CREATOR','EDITOR','VIEWER','REVIEWER'));
CREATE OR REPLACE FUNCTION private.project_file_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' OR TG_TABLE_NAME='project_pro_heads' THEN RAISE EXCEPTION 'Immutable project history' USING ERRCODE='42501'; END IF;
 IF (NEW.id,NEW.project_id,NEW.kind,NEW.r2_key,NEW.declared_bytes,NEW.label,NEW.actor_id,NEW.request_key,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.project_id,OLD.kind,OLD.r2_key,OLD.declared_bytes,OLD.label,OLD.actor_id,OLD.request_key,OLD.created_at) THEN
  RAISE EXCEPTION 'Immutable file origin' USING ERRCODE='42501'; END IF;
 IF (NEW.state,NEW.byte_size,NEW.content_sha256,NEW.schema_version,NEW.content_fingerprint,NEW.reject_reason,NEW.inspected_at)
 IS DISTINCT FROM (OLD.state,OLD.byte_size,OLD.content_sha256,OLD.schema_version,OLD.content_fingerprint,OLD.reject_reason,OLD.inspected_at)
 AND (OLD.state<>'quarantined' OR OLD.cleanup_state<>'live' OR NEW.cleanup_state<>'live' OR NEW.state NOT IN ('inspected','rejected')) THEN
  RAISE EXCEPTION 'Final file verdict' USING ERRCODE='42501'; END IF;
 IF (OLD.cleanup_state='purged' AND NEW IS DISTINCT FROM OLD)
 OR (OLD.cleanup_state='claimed' AND NEW.cleanup_state='live') OR (OLD.cleanup_state='live' AND NEW.cleanup_state='purged') THEN
  RAISE EXCEPTION 'Illegal cleanup transition' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS project_file_guard ON public.project_files;
CREATE TRIGGER project_file_guard BEFORE UPDATE OR DELETE ON public.project_files FOR EACH ROW EXECUTE FUNCTION private.project_file_guard();
DROP TRIGGER IF EXISTS project_pro_head_guard ON public.project_pro_heads;
CREATE TRIGGER project_pro_head_guard BEFORE UPDATE OR DELETE ON public.project_pro_heads FOR EACH ROW EXECUTE FUNCTION private.project_file_guard();
DROP TRIGGER IF EXISTS project_files_no_truncate ON public.project_files;
CREATE TRIGGER project_files_no_truncate BEFORE TRUNCATE ON public.project_files FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_no_truncate();
DROP TRIGGER IF EXISTS project_pro_heads_no_truncate ON public.project_pro_heads;
CREATE TRIGGER project_pro_heads_no_truncate BEFORE TRUNCATE ON public.project_pro_heads FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_no_truncate();
-- Latest local definition is 0141; retain every existing action.
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_action_check;
ALTER TABLE public.audit_events ADD CONSTRAINT audit_events_action_check CHECK (action IN (
 'PROJECT_CREATED','PROJECT_UPDATED','PROJECT_DELETED','PROJECT_DOCUMENT_SAVED','PROJECT_DOCUMENT_RESTORED',
 'PROJECT_ASSET_RESERVED','PROJECT_ASSET_INSPECTED','PROJECT_ASSET_REJECTED','PROJECT_PRO_HEAD_SET'));
CREATE OR REPLACE FUNCTION private.project_file_quota() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; used bigint; objects bigint; pending bigint;
BEGIN
 SELECT w.organisation_id INTO org FROM public.projects p JOIN public.workspaces w ON w.id=p.workspace_id WHERE p.id=NEW.project_id;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text,562));
 SELECT coalesce(sum(f.declared_bytes),0),count(*),count(*) FILTER (WHERE f.state='quarantined') INTO used,objects,pending
 FROM public.project_files f JOIN public.projects p ON p.id=f.project_id JOIN public.workspaces w ON w.id=p.workspace_id
 WHERE w.organisation_id=org AND f.cleanup_state<>'purged';
 IF used+NEW.declared_bytes>209715200 OR objects>=100 OR pending>=20 THEN
  RAISE EXCEPTION 'STORAGE_QUOTA_EXCEEDED' USING ERRCODE='PT429'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS project_file_quota ON public.project_files;
CREATE TRIGGER project_file_quota BEFORE INSERT ON public.project_files FOR EACH ROW EXECUTE FUNCTION private.project_file_quota();
CREATE OR REPLACE FUNCTION private.reserve_project_file(p_project_id uuid,p_label text,p_declared_bytes bigint,p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); f public.project_files; org uuid; fid uuid:=gen_random_uuid(); replay boolean:=false;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,563));
 PERFORM 1 FROM public.projects WHERE id=p_project_id FOR UPDATE;
 IF coalesce(private.project_role(p_project_id),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR') THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
 IF p_label IS NULL OR char_length(btrim(p_label)) NOT BETWEEN 1 AND 120 OR char_length(p_label)>120 OR p_label ~ '[/\\[:cntrl:]]'
 OR p_declared_bytes IS NULL OR p_declared_bytes NOT BETWEEN 1 AND 8388608 OR p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9._-]{8,128}$' THEN
  RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='PT400'; END IF;
 SELECT * INTO f FROM public.project_files WHERE project_id=p_project_id AND actor_id=actor AND request_key=p_request_key FOR UPDATE;
 IF FOUND THEN
  IF f.label<>p_label OR f.declared_bytes<>p_declared_bytes THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='PT409'; END IF;
  IF f.cleanup_state<>'live' THEN RAISE EXCEPTION 'FILE_UNAVAILABLE' USING ERRCODE='PT409'; END IF;
  replay:=true;
 ELSE
  DELETE FROM private.project_file_requests WHERE actor_id=actor AND requested_at<clock_timestamp()-interval '1 minute';
  IF (SELECT count(*) FROM private.project_file_requests WHERE actor_id=actor AND kind='reserve')>=30 THEN
   RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE='PT429'; END IF;
  SELECT w.organisation_id INTO org FROM public.projects p JOIN public.workspaces w ON w.id=p.workspace_id WHERE p.id=p_project_id;
  INSERT INTO public.project_files(id,project_id,r2_key,label,declared_bytes,actor_id,request_key)
  VALUES(fid,p_project_id,'org/'||org||'/project/'||p_project_id||'/file/'||fid||'/v1.fcproj',p_label,p_declared_bytes,actor,p_request_key) RETURNING * INTO f;
  INSERT INTO private.project_file_requests(actor_id,kind) VALUES(actor,'reserve');
 END IF;
 IF f.state='quarantined' AND f.created_at<clock_timestamp()-interval '14 minutes' THEN RAISE EXCEPTION 'UPLOAD_CLOSED' USING ERRCODE='PT409'; END IF;
 RETURN (to_jsonb(f)-'request_key'-'claim_key')||jsonb_build_object('file_id',f.id,'idempotent',replay);
END $$;
CREATE OR REPLACE FUNCTION public.reserve_project_file(p_project_id uuid,p_label text,p_declared_bytes bigint,p_request_key text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.reserve_project_file(p_project_id,p_label,p_declared_bytes,p_request_key); $$;
CREATE OR REPLACE FUNCTION private.consume_project_file_inspection(p_project_id uuid,p_file_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); f public.project_files; org uuid;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
 IF coalesce(private.project_role(p_project_id),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR') THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
 SELECT * INTO f FROM public.project_files WHERE id=p_file_id AND project_id=p_project_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
 IF f.cleanup_state<>'live' THEN RAISE EXCEPTION 'FILE_UNAVAILABLE' USING ERRCODE='PT409'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,564));
 DELETE FROM private.project_file_requests WHERE actor_id=actor AND requested_at<clock_timestamp()-interval '1 minute';
 IF (SELECT count(*) FROM private.project_file_requests WHERE actor_id=actor AND kind='inspect')>=10 THEN
  RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE='PT429'; END IF;
 INSERT INTO private.project_file_requests(actor_id,kind) VALUES(actor,'inspect');
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.consume_project_file_inspection(p_project_id uuid,p_file_id uuid) RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.consume_project_file_inspection(p_project_id,p_file_id); $$;
CREATE OR REPLACE FUNCTION private.set_pro_project_head(p_project_id uuid,p_expected_revision integer,p_file_id uuid,p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); f public.project_files; h public.project_pro_heads; head integer; org uuid;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='PT401'; END IF;
 -- Fixed lock order: project, then file. Cleanup never takes a project lock.
 PERFORM 1 FROM public.projects WHERE id=p_project_id FOR UPDATE;
 IF coalesce(private.project_role(p_project_id),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR') THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
 IF p_expected_revision IS NULL OR p_expected_revision<0 OR p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9._-]{8,128}$' OR p_file_id IS NULL THEN
  RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='PT400'; END IF;
 SELECT * INTO f FROM public.project_files WHERE id=p_file_id AND project_id=p_project_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
 IF f.cleanup_state<>'live' THEN RAISE EXCEPTION 'FILE_UNAVAILABLE' USING ERRCODE='PT409'; END IF;
 IF f.state<>'inspected' THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='PT400'; END IF;
 SELECT * INTO h FROM public.project_pro_heads WHERE project_id=p_project_id AND actor_id=actor AND request_key=p_request_key;
 IF FOUND THEN
  IF h.file_id<>p_file_id OR h.expected_revision<>p_expected_revision THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='PT409'; END IF;
  RETURN jsonb_build_object('revision',h.revision,'file_id',h.file_id,'idempotent',true);
 END IF;
 SELECT coalesce(max(revision),0) INTO head FROM public.project_pro_heads WHERE project_id=p_project_id;
 IF head<>p_expected_revision THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 IF head>=1000 THEN RAISE EXCEPTION 'LIMIT_REACHED' USING ERRCODE='PT429'; END IF;
 INSERT INTO public.project_pro_heads(project_id,revision,file_id,actor_id,expected_revision,request_key) VALUES(p_project_id,head+1,p_file_id,actor,p_expected_revision,p_request_key);
 SELECT w.organisation_id INTO org FROM public.projects p JOIN public.workspaces w ON w.id=p.workspace_id WHERE p.id=p_project_id;
 INSERT INTO public.audit_events(request_id,actor_id,organisation_id,action,resource_id) VALUES(gen_random_uuid(),actor,org,'PROJECT_PRO_HEAD_SET',p_project_id);
 RETURN jsonb_build_object('revision',head+1,'file_id',p_file_id,'idempotent',false);
END $$;
CREATE OR REPLACE FUNCTION public.set_pro_project_head(p_project_id uuid,p_expected_revision integer,p_file_id uuid,p_request_key text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.set_pro_project_head(p_project_id,p_expected_revision,p_file_id,p_request_key); $$;
CREATE OR REPLACE FUNCTION public.record_project_file_inspection(p_file_id uuid,p_content_sha256 text,p_byte_size bigint,p_schema_version integer,p_content_fingerprint text,p_reject_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.project_files;
BEGIN
 SELECT * INTO f FROM public.project_files WHERE id=p_file_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
 IF f.cleanup_state<>'live' THEN RAISE EXCEPTION 'FILE_UNAVAILABLE' USING ERRCODE='PT409'; END IF;
 IF f.state<>'quarantined' THEN
  IF (f.content_sha256,f.byte_size,f.schema_version,f.content_fingerprint,f.reject_reason) IS DISTINCT FROM
   (p_content_sha256,p_byte_size,p_schema_version,p_content_fingerprint,p_reject_reason) THEN RAISE EXCEPTION 'VERDICT_FINAL' USING ERRCODE='PT409'; END IF;
 ELSE
  UPDATE public.project_files SET state=CASE WHEN p_reject_reason IS NULL THEN 'inspected' ELSE 'rejected' END,
   content_sha256=p_content_sha256,byte_size=p_byte_size,schema_version=p_schema_version,content_fingerprint=p_content_fingerprint,reject_reason=p_reject_reason,inspected_at=now()
  WHERE id=p_file_id RETURNING * INTO f;
 END IF;
 RETURN jsonb_build_object('file_id',f.id,'state',f.state,'cleanup_state',f.cleanup_state,'byte_size',f.byte_size,'content_sha256',f.content_sha256,'reject_reason',f.reject_reason);
END $$;
CREATE OR REPLACE FUNCTION public.claim_project_file_cleanup(p_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate uuid; locked uuid; eligible boolean; items jsonb:='[]'; f public.project_files;
BEGIN
 IF p_key IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='PT400'; END IF;
 DELETE FROM private.project_file_requests WHERE requested_at<clock_timestamp()-interval '1 day';
 -- A bounded, unlocked candidate snapshot. Each lock and eligibility re-check below
 -- is a SEPARATE statement (READ COMMITTED fresh snapshot after promotion commits).
 FOR candidate IN SELECT pf.id FROM public.project_files pf JOIN public.projects p ON p.id=pf.project_id
 WHERE (pf.cleanup_state='claimed' AND pf.claimed_at<now()-interval '1 hour') OR
 (pf.cleanup_state='live' AND ((pf.state IN ('quarantined','rejected') AND pf.created_at<now()-interval '24 hours')
 OR (pf.state='inspected' AND pf.created_at<now()-interval '30 days' AND NOT EXISTS(SELECT 1 FROM public.project_pro_heads h WHERE h.file_id=pf.id))
 OR p.deleted_at<now()-interval '30 days')) ORDER BY pf.created_at,pf.id LIMIT 20 LOOP
  locked:=NULL;
  SELECT id INTO locked FROM public.project_files WHERE id=candidate FOR UPDATE SKIP LOCKED;
  IF locked IS NULL THEN CONTINUE; END IF;
  SELECT ((pf.cleanup_state='claimed' AND pf.claimed_at<now()-interval '1 hour') OR
   (pf.cleanup_state='live' AND ((pf.state IN ('quarantined','rejected') AND pf.created_at<now()-interval '24 hours')
   OR (pf.state='inspected' AND pf.created_at<now()-interval '30 days' AND NOT EXISTS(SELECT 1 FROM public.project_pro_heads h WHERE h.file_id=pf.id))
   OR p.deleted_at<now()-interval '30 days'))) INTO eligible
  FROM public.project_files pf JOIN public.projects p ON p.id=pf.project_id WHERE pf.id=candidate;
  IF eligible THEN
   UPDATE public.project_files SET cleanup_state='claimed',claim_key=p_key,claimed_at=now(),cleanup_attempts=cleanup_attempts+1,cleanup_last_error=NULL
   WHERE id=candidate RETURNING * INTO f;
   items:=items||jsonb_build_array(jsonb_build_object('id',f.id,'r2_key',f.r2_key));
  END IF;
 END LOOP;
 RETURN jsonb_build_object('items',items,'claimed_unpurged',(SELECT count(*) FROM public.project_files WHERE cleanup_state='claimed'));
END $$;
CREATE OR REPLACE FUNCTION public.finish_project_file_cleanup(p_id uuid,p_key uuid,p_error text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_error IS NOT NULL AND p_error NOT IN ('delete_failed','finish_failed','invalid_key') THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='PT400'; END IF;
 UPDATE public.project_files SET cleanup_state=CASE WHEN p_error IS NULL THEN 'purged' ELSE 'claimed' END,
 purged_at=CASE WHEN p_error IS NULL THEN now() ELSE NULL END,cleanup_last_error=p_error
 WHERE id=p_id AND claim_key=p_key AND cleanup_state='claimed';
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION private.project_file_guard(),private.project_file_quota(),
 private.reserve_project_file(uuid,text,bigint,text),public.reserve_project_file(uuid,text,bigint,text),
 private.consume_project_file_inspection(uuid,uuid),public.consume_project_file_inspection(uuid,uuid),
 private.set_pro_project_head(uuid,integer,uuid,text),public.set_pro_project_head(uuid,integer,uuid,text),
 public.record_project_file_inspection(uuid,text,bigint,integer,text,text),public.claim_project_file_cleanup(uuid),public.finish_project_file_cleanup(uuid,uuid,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.reserve_project_file(uuid,text,bigint,text),public.reserve_project_file(uuid,text,bigint,text),
 private.consume_project_file_inspection(uuid,uuid),public.consume_project_file_inspection(uuid,uuid),
 private.set_pro_project_head(uuid,integer,uuid,text),public.set_pro_project_head(uuid,integer,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_project_file_inspection(uuid,text,bigint,integer,text,text),public.claim_project_file_cleanup(uuid),public.finish_project_file_cleanup(uuid,uuid,text) TO service_role;
-- Admin telemetry may record these route patterns (same wrapper pattern as 0546; tests/adminTelemetry).
DO $$ BEGIN
 IF to_regprocedure('public.telemetry_path_allowed_pre_0562(text)') IS NULL THEN
  ALTER FUNCTION public.telemetry_path_allowed(TEXT) RENAME TO telemetry_path_allowed_pre_0562;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT p_path IN ('/api/v1/projects/:id/pro/files','/api/v1/projects/:id/pro/files/:id/download','/api/v1/projects/:id/pro/files/:id/inspect','/api/v1/projects/:id/pro/head') OR public.telemetry_path_allowed_pre_0562(p_path)
$$;
REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT) FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
