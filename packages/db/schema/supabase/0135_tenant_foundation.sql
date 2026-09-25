-- Additive foundation. Existing user credit/asset ownership is unchanged.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE TABLE IF NOT EXISTS public.organisations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES auth.users(id),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    personal boolean NOT NULL DEFAULT false,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS organisations_personal_owner ON public.organisations(owner_id) WHERE personal;
CREATE TABLE IF NOT EXISTS public.organisation_members (
    organisation_id uuid NOT NULL REFERENCES public.organisations(id),
    user_id uuid NOT NULL REFERENCES auth.users(id),
    role text NOT NULL CHECK (role IN ('OWNER','ADMIN','CREATOR','EDITOR','REVIEWER','VIEWER','BILLING')),
    PRIMARY KEY(organisation_id, user_id)
);
CREATE INDEX IF NOT EXISTS organisation_members_user ON public.organisation_members(user_id, organisation_id);
CREATE TABLE IF NOT EXISTS public.workspaces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id uuid NOT NULL REFERENCES public.organisations(id),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    is_default boolean NOT NULL DEFAULT false,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspaces_org ON public.workspaces(organisation_id);
CREATE UNIQUE INDEX IF NOT EXISTS workspaces_default ON public.workspaces(organisation_id) WHERE is_default;
CREATE TABLE IF NOT EXISTS public.workspace_members (
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
    user_id uuid NOT NULL REFERENCES auth.users(id),
    role text NOT NULL CHECK (role IN ('CREATOR','EDITOR','REVIEWER','VIEWER')),
    PRIMARY KEY(workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS workspace_members_user ON public.workspace_members(user_id, workspace_id);
CREATE TABLE IF NOT EXISTS public.projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
    owner_id uuid NOT NULL REFERENCES auth.users(id),
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_workspace ON public.projects(workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS projects_owner ON public.projects(owner_id);
CREATE TABLE IF NOT EXISTS public.project_members (
    project_id uuid NOT NULL REFERENCES public.projects(id),
    user_id uuid NOT NULL REFERENCES auth.users(id),
    role text NOT NULL CHECK (role IN ('CREATOR','EDITOR','REVIEWER','VIEWER')),
    PRIMARY KEY(project_id, user_id)
);
CREATE INDEX IF NOT EXISTS project_members_user ON public.project_members(user_id, project_id);
CREATE TABLE IF NOT EXISTS public.audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id uuid NOT NULL,
    actor_id uuid REFERENCES auth.users(id),
    organisation_id uuid NOT NULL REFERENCES public.organisations(id),
    action text NOT NULL CHECK (action IN ('PROJECT_CREATED','PROJECT_UPDATED','PROJECT_DELETED')),
    resource_id uuid NOT NULL,
    result text NOT NULL DEFAULT 'success' CHECK (result = 'success'),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_org ON public.audit_events(organisation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor ON public.audit_events(actor_id);
CREATE TABLE IF NOT EXISTS private.api_requests (
    actor_id uuid NOT NULL REFERENCES auth.users(id),
    operation text NOT NULL,
    key text NOT NULL CHECK (key ~ '^[A-Za-z0-9._-]{8,128}$'),
    payload jsonb NOT NULL,
    resource_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(actor_id, operation, key)
);
ALTER TABLE private.api_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.api_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.api_requests FROM PUBLIC, anon, authenticated;

-- Fixed identity lookups break policy recursion. No caller-selected user ID.
CREATE OR REPLACE FUNCTION private.org_role(org uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT m.role FROM public.organisation_members m JOIN public.organisations o ON o.id = m.organisation_id
    WHERE m.organisation_id = org AND m.user_id = (SELECT auth.uid()) AND o.deleted_at IS NULL;
$$;
CREATE OR REPLACE FUNCTION private.workspace_role(workspace uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT CASE WHEN m.role IN ('OWNER','ADMIN') THEN m.role ELSE coalesce(wm.role, m.role) END
    FROM public.workspaces w
    JOIN public.organisations o ON o.id = w.organisation_id AND o.deleted_at IS NULL
    JOIN public.organisation_members m ON m.organisation_id = o.id AND m.user_id = (SELECT auth.uid())
    LEFT JOIN public.workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = m.user_id
    WHERE w.id = workspace AND w.deleted_at IS NULL AND m.role <> 'BILLING';
$$;
CREATE OR REPLACE FUNCTION private.project_role(project uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT CASE WHEN private.workspace_role(p.workspace_id) IN ('OWNER','ADMIN') THEN private.workspace_role(p.workspace_id)
        ELSE coalesce(pm.role, private.workspace_role(p.workspace_id)) END
    FROM public.projects p LEFT JOIN public.project_members pm ON pm.project_id = p.id AND pm.user_id = (SELECT auth.uid())
    WHERE p.id = project AND p.deleted_at IS NULL AND private.workspace_role(p.workspace_id) IS NOT NULL;
$$;

DO $$ DECLARE t text; BEGIN
    FOREACH t IN ARRAY ARRAY['organisations','organisation_members','workspaces','workspace_members','projects','project_members','audit_events'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
        EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    END LOOP;
END $$;
DROP POLICY IF EXISTS org_read ON public.organisations;
CREATE POLICY org_read ON public.organisations FOR SELECT TO authenticated USING (private.org_role(id) IS NOT NULL);
DROP POLICY IF EXISTS org_members_read ON public.organisation_members;
CREATE POLICY org_members_read ON public.organisation_members FOR SELECT TO authenticated USING (private.org_role(organisation_id) IS NOT NULL);
DROP POLICY IF EXISTS workspace_read ON public.workspaces;
CREATE POLICY workspace_read ON public.workspaces FOR SELECT TO authenticated USING (private.workspace_role(id) IS NOT NULL);
DROP POLICY IF EXISTS workspace_members_read ON public.workspace_members;
CREATE POLICY workspace_members_read ON public.workspace_members FOR SELECT TO authenticated USING (private.workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS project_read ON public.projects;
CREATE POLICY project_read ON public.projects FOR SELECT TO authenticated USING (private.project_role(id) IS NOT NULL);
DROP POLICY IF EXISTS project_members_read ON public.project_members;
CREATE POLICY project_members_read ON public.project_members FOR SELECT TO authenticated USING (private.project_role(project_id) IS NOT NULL);
DROP POLICY IF EXISTS audit_read ON public.audit_events;
CREATE POLICY audit_read ON public.audit_events FOR SELECT TO authenticated USING (private.org_role(organisation_id) IN ('OWNER','ADMIN'));

-- Provision once from the existing, trusted signup/shadow-user path. Backfill
-- only identified auth users. This does not grant credits or create shadow rows.
CREATE OR REPLACE FUNCTION private.provision_personal_tenant(subject uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE org uuid;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = subject AND email IS NOT NULL AND NOT coalesce(is_anonymous, false)) THEN RETURN; END IF;
    INSERT INTO public.organisations(owner_id, name, personal) VALUES(subject, 'Personal Organisation', true)
    ON CONFLICT (owner_id) WHERE personal DO NOTHING;
    SELECT id INTO org FROM public.organisations WHERE owner_id = subject AND personal;
    INSERT INTO public.organisation_members VALUES(org, subject, 'OWNER') ON CONFLICT DO NOTHING;
    INSERT INTO public.workspaces(organisation_id, name, is_default) VALUES(org, 'Default Workspace', true)
    ON CONFLICT (organisation_id) WHERE is_default DO NOTHING;
END $$;
CREATE OR REPLACE FUNCTION private.on_shadow_user_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN PERFORM private.provision_personal_tenant(NEW.auth_id::uuid); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS provision_personal_tenant ON public.users;
CREATE TRIGGER provision_personal_tenant AFTER INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION private.on_shadow_user_created();
SELECT private.provision_personal_tenant(a.id) FROM auth.users a JOIN public.users u ON u.auth_id = a.id::text;

CREATE OR REPLACE FUNCTION private.audit_project_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE request_id uuid; raw_id text; org uuid; action text;
BEGIN
    raw_id := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-request-id';
    BEGIN request_id := raw_id::uuid; EXCEPTION WHEN invalid_text_representation THEN request_id := NULL; END;
    SELECT organisation_id INTO org FROM public.workspaces WHERE id = NEW.workspace_id;
    action := CASE WHEN TG_OP = 'INSERT' THEN 'PROJECT_CREATED' WHEN NEW.deleted_at IS NOT NULL THEN 'PROJECT_DELETED' ELSE 'PROJECT_UPDATED' END;
    INSERT INTO public.audit_events(request_id, actor_id, organisation_id, action, resource_id)
    VALUES(coalesce(request_id, gen_random_uuid()), auth.uid(), org, action, NEW.id);
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS audit_project_change ON public.projects;
CREATE TRIGGER audit_project_change AFTER INSERT OR UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION private.audit_project_change();
CREATE OR REPLACE FUNCTION private.audit_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$ BEGIN RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = '42501'; END $$;
DROP TRIGGER IF EXISTS audit_append_only ON public.audit_events;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON public.audit_events FOR EACH ROW EXECUTE FUNCTION private.audit_append_only();

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
    INSERT INTO public.projects(workspace_id, owner_id, name) VALUES(workspace, actor, btrim(project_name)) RETURNING * INTO created;
    INSERT INTO private.api_requests(actor_id,operation,key,payload,resource_id) VALUES(actor,'project.create',request_key,payload,created.id);
    RETURN jsonb_build_object('project', to_jsonb(created), 'idempotent', false);
END $$;
CREATE OR REPLACE FUNCTION public.create_project(p_workspace_id uuid, p_name text, p_idempotency_key text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT private.create_project(p_workspace_id,p_name,p_idempotency_key); $$;

CREATE OR REPLACE FUNCTION private.mutate_project(project uuid, expected_version integer, project_name text, remove boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE updated public.projects; actor uuid := auth.uid(); role text;
BEGIN
    IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'PT401'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(actor::text, 34));
    SELECT * INTO updated FROM public.projects WHERE id = project FOR UPDATE;
    role := private.project_role(project);
    IF coalesce(role, '') NOT IN ('OWNER','ADMIN','CREATOR','EDITOR') THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'PT404'; END IF;
    IF remove AND role NOT IN ('OWNER','ADMIN') AND updated.owner_id <> actor THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'PT403'; END IF;
    IF expected_version IS NULL OR updated.version <> expected_version THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE = 'PT409'; END IF;
    IF remove IS NULL OR (NOT remove AND (project_name IS NULL OR char_length(btrim(project_name)) NOT BETWEEN 1 AND 120)) THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = 'PT400'; END IF;
    IF (SELECT count(*) FROM public.audit_events WHERE actor_id = actor AND created_at > now() - interval '1 minute') >= 30 THEN RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE = 'PT429'; END IF;
    UPDATE public.projects SET name = CASE WHEN remove THEN name ELSE btrim(project_name) END,
        deleted_at = CASE WHEN remove THEN now() ELSE NULL END, version = version + 1, updated_at = now()
    WHERE id = project RETURNING * INTO updated;
    RETURN to_jsonb(updated);
END $$;
CREATE OR REPLACE FUNCTION public.mutate_project(p_project_id uuid, p_expected_version integer, p_name text, p_remove boolean DEFAULT false) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT private.mutate_project(p_project_id,p_expected_version,p_name,p_remove); $$;

REVOKE ALL ON FUNCTION private.org_role(uuid), private.workspace_role(uuid), private.project_role(uuid),
    private.provision_personal_tenant(uuid), private.on_shadow_user_created(), private.audit_project_change(),
    private.audit_append_only(), private.create_project(uuid,text,text), private.mutate_project(uuid,integer,text,boolean)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.org_role(uuid), private.workspace_role(uuid), private.project_role(uuid), private.create_project(uuid,text,text), private.mutate_project(uuid,integer,text,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.create_project(uuid,text,text), public.mutate_project(uuid,integer,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_project(uuid,text,text), public.mutate_project(uuid,integer,text,boolean) TO authenticated;
COMMIT;
