-- 0251_refunded_jobs_recent.sql
-- How many of a user's jobs on the given models were refunded in the last
-- rolling day (audit 2026-10-09, M-07).
--
-- A composite job (Clip Editor, Auto Short) is billed once and runs as
-- several provider steps; when a late step fails the parent is refunded in
-- full while the steps already run are our cost, and nothing limited how
-- often one account could do that. The Worker asks this count before the
-- debit of a composite job (lib/compositeRefunds.js) and refuses the next one
-- at its ceiling. Read-only, over the existing jobs(user_id, created_at)
-- index; a Worker running before this is applied gets an error from the
-- missing function and admits the job as before.

CREATE OR REPLACE FUNCTION public.refunded_jobs_recent(p_user_id UUID, p_model_ids TEXT[])
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT count(*)::integer
    FROM public.jobs j
    WHERE j.user_id = p_user_id
      AND j.model_id = ANY (p_model_ids)
      AND j.state = 'REFUNDED'
      AND j.created_at > now() - interval '1 day';
$$;

REVOKE ALL ON FUNCTION public.refunded_jobs_recent(UUID, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refunded_jobs_recent(UUID, TEXT[]) TO service_role;
