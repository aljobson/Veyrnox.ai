-- Supabase performance advisor 0003 (auth_rls_initplan): editor_render_read
-- called auth.uid() once per row. Wrapping it in a scalar subquery makes
-- Postgres evaluate it once per statement. Same predicate, same role, same
-- command; only the planning changes. ALTER POLICY keeps the policy's roles
-- and is safe to replay.
BEGIN;

ALTER POLICY editor_render_read ON public.editor_library_renders
 USING(owner_id=(SELECT auth.uid()) AND state<>'removed' AND expires_at>now());

NOTIFY pgrst,'reload schema';
COMMIT;
