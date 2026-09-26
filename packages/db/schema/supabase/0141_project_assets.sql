-- Project media: durable asset records, quarantine and format inspection (ADR-0056).
-- Backlog M02, first slice. No moderation, no malware scanning, no derivatives, no UI.
--
-- `upload_reservations` (0129) is user-scoped, stateless and expires in sixteen
-- minutes; it reserves a key, it does not describe an asset. This adds the
-- project-scoped record and the verdict that decides whether bytes may be used.
--
-- Two trust boundaries, deliberately different:
--   reserve_project_asset            user's bearer token, RLS world, like 0140
--   record_project_asset_inspection  service_role only — a verdict the client
--                                    can assert is not a verdict
-- Downloads need no function: RLS plus `state = 'inspected'` already answers
-- "may this person have this object", and the presign needs server credentials
-- anyway, so the route reads through the user's token and signs.
BEGIN;

CREATE TABLE IF NOT EXISTS public.project_assets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES public.projects(id),
    -- Opaque, server-derived, and pinned by shape so no client input can steer a
    -- key across tenants or out of its prefix (ADR-0056 decision 4).
    r2_key text NOT NULL UNIQUE CHECK (r2_key ~ '^org/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/project/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/asset/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/v1\.[a-z0-9]{2,4}$'),
    state text NOT NULL DEFAULT 'quarantined' CHECK (state IN ('quarantined','inspected','rejected')),
    declared_type text NOT NULL,
    declared_bytes bigint NOT NULL CHECK (declared_bytes BETWEEN 1 AND 104857600),
    -- Written once, by the server, from the bytes themselves.
    sniffed_type text,
    byte_size bigint CHECK (byte_size IS NULL OR byte_size BETWEEN 1 AND 104857600),
    duration_ms integer CHECK (duration_ms IS NULL OR duration_ms BETWEEN 1 AND 3600000),
    width integer CHECK (width IS NULL OR width BETWEEN 1 AND 16384),
    height integer CHECK (height IS NULL OR height BETWEEN 1 AND 16384),
    reject_reason text CHECK (reject_reason IS NULL OR reject_reason ~ '^[a-z_]{3,40}$'),
    actor_id uuid NOT NULL, -- historical attribution survives Auth deletion, as 0140
    request_key text NOT NULL CHECK (request_key ~ '^[A-Za-z0-9._-]{8,128}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    inspected_at timestamptz,
    UNIQUE (project_id, actor_id, request_key),
    -- A settled row carries its verdict; an unsettled one carries none. This is
    -- what stops a half-written inspection reading as a pass.
    CONSTRAINT project_assets_verdict_complete CHECK (
        (state = 'quarantined' AND inspected_at IS NULL AND sniffed_type IS NULL AND reject_reason IS NULL)
     OR (state = 'inspected'   AND inspected_at IS NOT NULL AND sniffed_type IS NOT NULL AND reject_reason IS NULL)
     OR (state = 'rejected'    AND inspected_at IS NOT NULL AND reject_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS project_assets_project_idx ON public.project_assets(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_assets_quarantined_idx ON public.project_assets(created_at) WHERE state = 'quarantined';

ALTER TABLE public.project_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_assets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_assets FROM PUBLIC, anon, authenticated, service_role;
-- No client INSERT/UPDATE/DELETE, and no read of the request key.
GRANT SELECT (id,project_id,r2_key,state,declared_type,declared_bytes,sniffed_type,byte_size,duration_ms,width,height,reject_reason,actor_id,created_at,inspected_at)
    ON public.project_assets TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.project_assets TO service_role;
DROP POLICY IF EXISTS project_asset_read ON public.project_assets;
-- Stricter than 0140's document_read on purpose: target-state says billing roles
-- cannot read creative data, and a brief is not a face or a voice.
CREATE POLICY project_asset_read ON public.project_assets FOR SELECT TO authenticated
    USING (private.project_role(project_id) IN ('OWNER','ADMIN','CREATOR','EDITOR','VIEWER','REVIEWER'));

-- The origin is immutable and the verdict is final, even for a privileged rewrite.
CREATE OR REPLACE FUNCTION private.project_asset_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Project assets are immutable' USING ERRCODE = '42501';
    END IF;
    IF OLD.state <> 'quarantined' THEN
        RAISE EXCEPTION 'Project asset verdict is final' USING ERRCODE = '42501';
    END IF;
    IF NEW.state NOT IN ('inspected','rejected') THEN
        RAISE EXCEPTION 'Illegal project asset transition' USING ERRCODE = '42501';
    END IF;
    IF NEW.id <> OLD.id OR NEW.project_id <> OLD.project_id OR NEW.r2_key <> OLD.r2_key
        OR NEW.declared_type <> OLD.declared_type OR NEW.declared_bytes <> OLD.declared_bytes
        OR NEW.actor_id <> OLD.actor_id OR NEW.request_key <> OLD.request_key
        OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'Project asset origin is immutable' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS project_asset_guard ON public.project_assets;
CREATE TRIGGER project_asset_guard BEFORE UPDATE OR DELETE ON public.project_assets
FOR EACH ROW EXECUTE FUNCTION private.project_asset_guard();

ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_action_check;
ALTER TABLE public.audit_events ADD CONSTRAINT audit_events_action_check CHECK (action IN (
    'PROJECT_CREATED','PROJECT_UPDATED','PROJECT_DELETED','PROJECT_DOCUMENT_SAVED','PROJECT_DOCUMENT_RESTORED',
    'PROJECT_ASSET_RESERVED','PROJECT_ASSET_INSPECTED','PROJECT_ASSET_REJECTED'
));

-- The allowlist, duplicated from lib/uploadSource.js#ALLOWED_UPLOAD_TYPES so a
-- direct PostgREST call cannot reserve a type the app would refuse. Extensions
-- match that file; keep the two in step.
CREATE OR REPLACE FUNCTION private.project_asset_extension(media_type text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT CASE media_type
        WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp'
        WHEN 'video/mp4' THEN 'mp4' WHEN 'audio/mpeg' THEN 'mp3' WHEN 'audio/wav' THEN 'wav'
    END;
$$;
CREATE OR REPLACE FUNCTION private.project_asset_max_bytes(media_type text) RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT CASE WHEN media_type = 'video/mp4' THEN 104857600 ELSE 20971520 END;
$$;

CREATE OR REPLACE FUNCTION private.reserve_project_asset(
    project uuid, media_type text, declared_bytes bigint, request_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    actor uuid := auth.uid(); existing public.project_assets; saved public.project_assets;
    org uuid; ext text; asset_id uuid; key text; request_id uuid; raw_id text;
BEGIN
    IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'PT401'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(actor::text, 34));
    PERFORM 1 FROM public.projects WHERE id = project FOR UPDATE;
    IF coalesce(private.project_role(project),'') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR') THEN
        RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404';
    END IF;
    ext := private.project_asset_extension(media_type);
    IF ext IS NULL OR request_key IS NULL OR request_key !~ '^[A-Za-z0-9._-]{8,128}$'
        OR declared_bytes IS NULL OR declared_bytes < 1
        OR declared_bytes > private.project_asset_max_bytes(media_type) THEN
        RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = 'PT400';
    END IF;

    SELECT * INTO existing FROM public.project_assets a
        WHERE a.project_id = project AND a.actor_id = actor
          AND a.request_key = reserve_project_asset.request_key;
    IF FOUND THEN
        IF existing.declared_type <> media_type OR existing.declared_bytes <> declared_bytes THEN
            RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE = 'PT409';
        END IF;
        RETURN jsonb_build_object('asset_id',existing.id,'r2_key',existing.r2_key,
            'state',existing.state,'created_at',existing.created_at,'idempotent',true);
    END IF;

    IF (SELECT count(*) FROM public.audit_events WHERE actor_id = actor AND created_at > now() - interval '1 minute') >= 30 THEN
        RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE = 'PT429';
    END IF;

    SELECT w.organisation_id INTO org FROM public.projects p
        JOIN public.workspaces w ON w.id = p.workspace_id WHERE p.id = project;
    IF org IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404'; END IF;
    asset_id := gen_random_uuid();
    key := 'org/' || org::text || '/project/' || project::text || '/asset/' || asset_id::text || '/v1.' || ext;

    INSERT INTO public.project_assets(id,project_id,r2_key,declared_type,declared_bytes,actor_id,request_key)
        VALUES(asset_id,project,key,media_type,declared_bytes,actor,request_key) RETURNING * INTO saved;

    raw_id := nullif(current_setting('request.headers',true),'')::jsonb ->> 'x-request-id';
    BEGIN request_id := raw_id::uuid; EXCEPTION WHEN invalid_text_representation THEN request_id := NULL; END;
    INSERT INTO public.audit_events(request_id,actor_id,organisation_id,action,resource_id)
        VALUES(coalesce(request_id,gen_random_uuid()),actor,org,'PROJECT_ASSET_RESERVED',project);

    RETURN jsonb_build_object('asset_id',saved.id,'r2_key',saved.r2_key,
        'state',saved.state,'created_at',saved.created_at,'idempotent',false);
END $$;
CREATE OR REPLACE FUNCTION public.reserve_project_asset(
    p_project_id uuid, p_media_type text, p_declared_bytes bigint, p_idempotency_key text
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
    SELECT private.reserve_project_asset(p_project_id,p_media_type,p_declared_bytes,p_idempotency_key);
$$;

-- Service-role only. The verdict comes from the bytes, so only the Worker that
-- read them may settle an asset; there is no public shell on purpose.
CREATE OR REPLACE FUNCTION public.record_project_asset_inspection(
    p_asset_id uuid, p_sniffed_type text DEFAULT NULL, p_byte_size bigint DEFAULT NULL,
    p_duration_ms integer DEFAULT NULL, p_width integer DEFAULT NULL, p_height integer DEFAULT NULL,
    p_reject_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    row public.project_assets; org uuid; settled public.project_assets;
BEGIN
    SELECT * INTO row FROM public.project_assets WHERE id = p_asset_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404'; END IF;
    -- Replaying the same verdict is a no-op; a different one is a conflict.
    IF row.state <> 'quarantined' THEN
        IF (p_reject_reason IS NULL) = (row.state = 'inspected')
            AND coalesce(row.sniffed_type,'') = coalesce(p_sniffed_type,'')
            AND coalesce(row.reject_reason,'') = coalesce(p_reject_reason,'') THEN
            RETURN jsonb_build_object('asset_id',row.id,'state',row.state,'idempotent',true);
        END IF;
        RAISE EXCEPTION 'VERDICT_FINAL' USING ERRCODE = 'PT409';
    END IF;
    IF (p_reject_reason IS NULL) = (p_sniffed_type IS NULL) THEN
        -- Exactly one of "it passed, and this is what it is" or "it failed, because".
        RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = 'PT400';
    END IF;

    UPDATE public.project_assets SET
        state = CASE WHEN p_reject_reason IS NULL THEN 'inspected' ELSE 'rejected' END,
        sniffed_type = p_sniffed_type, byte_size = p_byte_size, duration_ms = p_duration_ms,
        width = p_width, height = p_height, reject_reason = p_reject_reason, inspected_at = now()
    WHERE id = p_asset_id RETURNING * INTO settled;

    SELECT w.organisation_id INTO org FROM public.projects p
        JOIN public.workspaces w ON w.id = p.workspace_id WHERE p.id = settled.project_id;
    INSERT INTO public.audit_events(request_id,actor_id,organisation_id,action,resource_id)
        VALUES(gen_random_uuid(),settled.actor_id,org,
        CASE WHEN p_reject_reason IS NULL THEN 'PROJECT_ASSET_INSPECTED' ELSE 'PROJECT_ASSET_REJECTED' END,
        settled.project_id);

    RETURN jsonb_build_object('asset_id',settled.id,'state',settled.state,
        'sniffed_type',settled.sniffed_type,'reject_reason',settled.reject_reason,'idempotent',false);
END $$;

REVOKE ALL ON FUNCTION private.project_asset_guard(), private.project_asset_extension(text),
    private.project_asset_max_bytes(text),
    private.reserve_project_asset(uuid,text,bigint,text),
    public.reserve_project_asset(uuid,text,bigint,text),
    public.record_project_asset_inspection(uuid,text,bigint,integer,integer,integer,text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.reserve_project_asset(uuid,text,bigint,text),
    public.reserve_project_asset(uuid,text,bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_project_asset_inspection(uuid,text,bigint,integer,integer,integer,text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
