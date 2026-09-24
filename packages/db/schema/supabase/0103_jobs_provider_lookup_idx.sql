-- The index every provider webhook's first query needs (audit 2026-09-23).
--
-- app/api/webhook/{fal,kie,openrouter} all start by finding the job for a
-- (provider, provider_job_id). jobs carried only jobs_state_idx (partial, on
-- state) and jobs_user_id_idx (user_id, created_at DESC), so that lookup was
-- a sequential scan that grows with the table: the webhook slows down, fal
-- retries on timeout, and the retry scans again. job_steps got this index in
-- 0091; jobs never had it.
--
-- Not UNIQUE: a provider id is unique in practice, but a UNIQUE index would
-- turn a provider reusing one into a failed callback rather than a logged
-- mismatch, and the handlers already read a single row.
--
-- Idempotent: IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS jobs_provider_lookup_idx
    ON public.jobs (provider, provider_job_id)
    WHERE provider_job_id IS NOT NULL;
