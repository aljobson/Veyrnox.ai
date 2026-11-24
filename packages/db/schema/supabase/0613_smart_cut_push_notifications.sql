-- 0613: background Smart Cut analysis completion through the existing push outbox.
--
-- Speech analysis jobs are deliberately excluded from generic generation pushes by 0452.
-- This separate enqueue function preserves that boundary and uses distinct kinds so the
-- mobile client can reopen Smart Cut without receiving an analysis job id. It only reads
-- terminal jobs from the last 15 minutes; it never changes a job, analysis or ledger row.
-- The existing per-device notify_jobs choice gates both progress and completion.

ALTER TABLE public.push_outbox
    DROP CONSTRAINT IF EXISTS push_outbox_kind_check,
    DROP CONSTRAINT IF EXISTS push_outbox_shape_check;
ALTER TABLE public.push_outbox
    ADD CONSTRAINT push_outbox_kind_check CHECK (kind IN (
        'job_done', 'job_failed', 'smart_cut_done', 'smart_cut_failed',
        'music_follower', 'music_comment_approved', 'music_reply')),
    ADD CONSTRAINT push_outbox_shape_check CHECK (
        (kind IN ('job_done', 'job_failed', 'smart_cut_done', 'smart_cut_failed')
            AND job_id IS NOT NULL AND music_event_key IS NULL AND music_path IS NULL)
        OR (kind IN ('music_follower', 'music_comment_approved', 'music_reply') AND job_id IS NULL
            AND music_event_key ~ '^(follow|approved|reply):[0-9a-f-]{36}:[0-9]{1,20}$'
            AND music_path ~ '^/music/(tracks/[a-f0-9]{24}|creators/[a-z][a-z0-9_]{2,29})$'));

CREATE OR REPLACE FUNCTION public.push_enqueue_smart_cut_events(p_limit INTEGER DEFAULT 200)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_n INTEGER;
BEGIN
    WITH people AS (
        SELECT DISTINCT t.user_id FROM public.push_tokens t
         WHERE t.disabled_at IS NULL AND t.notify_jobs
    ), due AS (
        SELECT j.user_id, j.id AS job_id,
               CASE WHEN j.state = 'STORED' THEN 'smart_cut_done' ELSE 'smart_cut_failed' END AS kind
          FROM people p
          JOIN public.jobs j ON j.user_id = p.user_id
         WHERE j.created_at > now() - interval '2 hours'
           AND j.updated_at > now() - interval '15 minutes'
           AND j.state IN ('STORED', 'FAILED', 'REFUNDED')
           AND j.inputs->>'kind' = 'speech_analysis'
         ORDER BY j.updated_at
         LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000))
    ), ins AS (
        INSERT INTO public.push_outbox (user_id, job_id, kind)
        SELECT user_id, job_id, kind FROM due
        ON CONFLICT (job_id, kind) DO NOTHING
        RETURNING 1
    )
    SELECT count(*) INTO v_n FROM ins;
    RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.push_enqueue_smart_cut_events(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_enqueue_smart_cut_events(INTEGER) TO service_role;
