-- 0527: Music notifications (Suno parity S-U4) through the existing push outbox (0348, ADR-0113).
--
-- Three events reach a person's phone:
--   music_follower          someone followed you as a Music creator
--   music_comment_approved  an administrator approved your comment (0518 holds every comment)
--   music_reply             an approved reply to your comment
--
-- As for jobs, the outbox is filled by the per-minute SWEEP, never by the follow
-- or comment write paths: push_enqueue_music_events reads events from the last
-- 15 minutes, so switching it on never replays history, and the follow and
-- comment RPCs are unchanged. One outbox row per event key, whatever retries
-- happen. The lock screen never names the other person (see lib/pushNotifications.js).
-- Someone the person has blocked (user_blocks) never causes a push. Rows are
-- erased with the account by 0348's trigger (push_outbox.user_id).
--
-- push_outbox gains a second shape: job rows keep job_id; Music rows carry a
-- unique music_event_key and a fixed-form app path instead. push_claim_batch is
-- 0348's body with the jobs join made LEFT, so Music rows are claimed too.
-- Off until MUSIC_RUNTIME_FLAGS notifications is true (and, as for every push,
-- PUSH_NOTIFICATIONS_ENABLED). Nothing here touches the ledger.

ALTER TABLE public.push_outbox ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE public.push_outbox
    ADD COLUMN IF NOT EXISTS music_event_key TEXT,
    ADD COLUMN IF NOT EXISTS music_path TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS push_outbox_music_event_key_idx
    ON public.push_outbox (music_event_key) WHERE music_event_key IS NOT NULL;

ALTER TABLE public.push_outbox
    DROP CONSTRAINT IF EXISTS push_outbox_kind_check,
    DROP CONSTRAINT IF EXISTS push_outbox_shape_check;
ALTER TABLE public.push_outbox
    ADD CONSTRAINT push_outbox_kind_check CHECK (kind IN (
        'job_done', 'job_failed', 'music_follower', 'music_comment_approved', 'music_reply')),
    ADD CONSTRAINT push_outbox_shape_check CHECK (
        (kind IN ('job_done', 'job_failed') AND job_id IS NOT NULL AND music_event_key IS NULL AND music_path IS NULL)
        OR (kind IN ('music_follower', 'music_comment_approved', 'music_reply') AND job_id IS NULL
            AND music_event_key ~ '^(follow|approved|reply):[0-9a-f-]{36}:[0-9]{1,20}$'
            AND music_path ~ '^/music/(tracks/[a-f0-9]{24}|creators/[a-z][a-z0-9_]{2,29})$'));

CREATE OR REPLACE FUNCTION public.push_enqueue_music_events(p_limit INTEGER DEFAULT 200)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_n INTEGER;
    v_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000));
BEGIN
    WITH people AS (
        SELECT DISTINCT t.user_id FROM public.push_tokens t
         WHERE t.disabled_at IS NULL AND t.notify_jobs
    ), follows AS (
        SELECT f.creator_user_id AS user_id, 'music_follower'::text AS kind,
               'follow:' || f.follower_id || ':' || floor(extract(epoch FROM f.created_at))::bigint AS event_key,
               '/music/creators/' || cp.handle AS path, f.follower_id AS actor
          FROM people p
          JOIN public.music_creator_follows f ON f.creator_user_id = p.user_id
          JOIN public.music_creator_profiles cp ON cp.user_id = f.creator_user_id
         WHERE f.created_at > now() - interval '15 minutes'
    ), approved AS (
        SELECT c.author_id AS user_id, 'music_comment_approved'::text AS kind,
               'approved:' || c.id || ':' || floor(extract(epoch FROM c.reviewed_at))::bigint AS event_key,
               '/music/tracks/' || pub.slug AS path, NULL::uuid AS actor
          FROM people p
          JOIN public.music_comments c ON c.author_id = p.user_id
          JOIN public.music_publications pub ON pub.id = c.publication_id AND pub.status = 'published'
         WHERE c.status = 'approved' AND c.reviewed_at > now() - interval '15 minutes'
    ), replies AS (
        SELECT parent.author_id AS user_id, 'music_reply'::text AS kind,
               'reply:' || c.id || ':' || floor(extract(epoch FROM c.reviewed_at))::bigint AS event_key,
               '/music/tracks/' || pub.slug AS path, c.author_id AS actor
          FROM people p
          JOIN public.music_comments parent ON parent.author_id = p.user_id AND parent.status = 'approved'
          JOIN public.music_comments c ON c.parent_id = parent.id
          JOIN public.music_publications pub ON pub.id = c.publication_id AND pub.status = 'published'
         WHERE c.status = 'approved' AND c.reviewed_at > now() - interval '15 minutes'
           AND c.author_id <> parent.author_id
    ), due AS (
        SELECT e.* FROM (SELECT * FROM follows UNION ALL SELECT * FROM approved UNION ALL SELECT * FROM replies) e
         WHERE e.actor IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.user_blocks b WHERE b.blocker_id = e.user_id AND b.blocked_id = e.actor)
         LIMIT v_limit
    ), ins AS (
        INSERT INTO public.push_outbox (user_id, kind, music_event_key, music_path)
        SELECT user_id, kind, event_key, path FROM due
        ON CONFLICT (music_event_key) WHERE music_event_key IS NOT NULL DO NOTHING
        RETURNING 1
    )
    SELECT count(*) INTO v_n FROM ins;
    RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.push_enqueue_music_events(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_enqueue_music_events(INTEGER) TO service_role;

-- 0348's claim, with LEFT JOINs so Music rows (no job) are claimed and carry their path.
CREATE OR REPLACE FUNCTION public.push_claim_batch(p_limit INTEGER DEFAULT 50, p_lease_seconds INTEGER DEFAULT 120)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_ids UUID[];
    v_out JSONB;
BEGIN
    WITH picked AS (
        SELECT o.id FROM public.push_outbox o
         WHERE o.state = 'pending' AND o.next_attempt_at <= now()
           AND (o.claimed_until IS NULL OR o.claimed_until < now())
         ORDER BY o.created_at
         LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
         FOR UPDATE SKIP LOCKED
    ), claimed AS (
        UPDATE public.push_outbox o
           SET attempts = o.attempts + 1,
               claimed_until = now() + make_interval(secs => GREATEST(30, LEAST(COALESCE(p_lease_seconds, 120), 600)))
          FROM picked WHERE o.id = picked.id
        RETURNING o.id
    )
    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_ids FROM claimed;
    -- Nobody left to tell: close the item instead of sending to no one.
    UPDATE public.push_outbox o
       SET state = 'dead', claimed_until = NULL, last_error = 'no_active_token'
     WHERE o.id = ANY(v_ids)
       AND NOT EXISTS (SELECT 1 FROM public.push_tokens t
                        WHERE t.user_id = o.user_id AND t.disabled_at IS NULL AND t.notify_jobs);

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', o.id, 'kind', o.kind, 'job_id', o.job_id, 'job_state', j.state::text,
               'modality', m.modality, 'attempts', o.attempts, 'music_path', o.music_path,
               'tokens', (SELECT jsonb_agg(jsonb_build_object('id', t.id, 'token', t.token))
                            FROM public.push_tokens t
                           WHERE t.user_id = o.user_id AND t.disabled_at IS NULL AND t.notify_jobs))
               ORDER BY o.created_at), '[]'::jsonb)
      INTO v_out
      FROM public.push_outbox o
      LEFT JOIN public.jobs j ON j.id = o.job_id
      LEFT JOIN public.model_catalog m ON m.id = j.model_id
     WHERE o.id = ANY(v_ids) AND o.state = 'pending';
    RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.push_claim_batch(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_claim_batch(INTEGER, INTEGER) TO service_role;
