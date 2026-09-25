-- Auth deletion must revoke access without deleting retained project/audit data.
-- Keep historical subject UUIDs on ownership/audit rows, as the existing public
-- user/financial records do. Live membership remains the authorization boundary.
BEGIN;
ALTER TABLE public.organisations DROP CONSTRAINT IF EXISTS organisations_owner_id_fkey;
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_owner_id_fkey;
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_actor_id_fkey;

ALTER TABLE public.organisation_members DROP CONSTRAINT IF EXISTS organisation_members_user_id_fkey;
ALTER TABLE public.organisation_members ADD CONSTRAINT organisation_members_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.workspace_members DROP CONSTRAINT IF EXISTS workspace_members_user_id_fkey;
ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.project_members DROP CONSTRAINT IF EXISTS project_members_user_id_fkey;
ALTER TABLE public.project_members ADD CONSTRAINT project_members_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE private.api_requests DROP CONSTRAINT IF EXISTS api_requests_actor_id_fkey;
ALTER TABLE private.api_requests ADD CONSTRAINT api_requests_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE CASCADE;
COMMIT;
