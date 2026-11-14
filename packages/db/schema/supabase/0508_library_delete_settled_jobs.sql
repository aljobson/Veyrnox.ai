-- 0508: a person can delete a finished creation again (ADR-0116 amendment).
--
-- delete_user_job refused any job with a fal_dispatch row not in state CLOSED. Rows
-- move to CLOSED only when they were never sent (0230) or the job was cancelled
-- (0359); once fal accepts a request the row stays ACCEPTED for good. So every
-- creation sent through durable dispatch answered IN_PROGRESS for ever. A settled
-- job's request is finished whether it was accepted or rejected; only READY,
-- STARTED or UNKNOWN can still reach fal, and those still block.
--
-- Music jobs answer USED_BY_MUSIC. Music has its own songs, versions and stems, and
-- music_song_versions and music_target_stem_assets pin their files ON DELETE
-- RESTRICT, so deleting one from the general Library would fail on a foreign key.
-- This now includes zero-credit local renders (0504).
--
-- push_enqueue_job_events (0452) skips provider 'local': a local Music render finishes
-- while the person watches, so a "your creation is ready" notice is noise. The push
-- switch is staging only today.
--
-- Nothing here writes ledger_entries or credit_balances. Both bodies are otherwise 0450's
-- and 0452's.
-- Idempotent: OR REPLACE, explicit revoke and grant.

CREATE OR REPLACE FUNCTION public.delete_user_job(p_auth_id TEXT, p_job_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user public.users%ROWTYPE;
    v_job  public.jobs%ROWTYPE;
    v_rate JSONB;
BEGIN
    SELECT * INTO v_user FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;

    v_rate := public.consume_job_read_request(v_user.id);
    IF v_rate->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_rate; END IF;

    -- Owner only; the lock serialises two deletes of the same job, so the second sees the first.
    SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id AND user_id = v_user.id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;

    IF v_job.deleted_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'replayed', true);
    END IF;
    -- A chat reply is not a creation (the Library never lists it); chat has its own delete.
    IF v_job.inputs->>'kind' IN ('chat','editor_ai_edit','speech_analysis') THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;

    -- A person cannot delete their way out of a dispute (ADR-0111).
    IF v_user.frozen_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN'); END IF;

    -- Only a settled job. SUCCEEDED means the file is still being copied. Once the job itself is
    -- settled, a fal request that was accepted or rejected is finished too: nothing ever moves those
    -- rows to CLOSED, so requiring CLOSED refused every creation sent through durable dispatch (0508).
    -- A request still READY, STARTED or UNKNOWN may yet reach fal, and still blocks.
    IF v_job.state NOT IN ('STORED', 'FAILED', 'REFUNDED')
       OR EXISTS (SELECT 1 FROM public.fal_dispatch d WHERE d.job_id = v_job.id
                  AND d.state NOT IN ('CLOSED', 'ACCEPTED', 'REJECTED')) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'IN_PROGRESS');
    END IF;

    -- Preserved material and open reports are not erased on request (ADR-0083).
    IF EXISTS (SELECT 1 FROM public.evidence_holds h WHERE h.job_id = v_job.id AND h.released_at IS NULL)
       OR EXISTS (SELECT 1 FROM public.assets a WHERE a.job_id = v_job.id AND a.held_at IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.content_reports r
                   WHERE r.subject_kind = 'job' AND r.subject_id = v_job.id AND r.status = 'open') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ON_HOLD');
    END IF;

    -- Still in use. A post that failed or was cancelled no longer needs the file.
    IF EXISTS (SELECT 1 FROM public.social_post_media m JOIN public.social_posts p ON p.id = m.post_id
                WHERE m.source_job_id = v_job.id AND p.status IN ('draft', 'scheduled', 'published')) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USED_BY_POST');
    END IF;
    IF EXISTS (SELECT 1 FROM public.cinema_uploads u WHERE u.source_job_id = v_job.id) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USED_BY_CINEMA');
    END IF;
    IF EXISTS (SELECT 1 FROM public.film_library_masters m WHERE m.source_job_id = v_job.id) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USED_BY_LIBRARY');
    END IF;
    -- Music keeps its own songs, versions and stems; their files are removed through Music.
    -- song versions and target stems also pin the asset ON DELETE RESTRICT, so this is the clean answer.
    IF EXISTS (SELECT 1 FROM public.music_song_versions v WHERE v.job_id = v_job.id)
       OR EXISTS (SELECT 1 FROM public.music_generation_candidates c WHERE c.job_id = v_job.id)
       OR EXISTS (SELECT 1 FROM public.music_stem_requests r WHERE r.job_id = v_job.id)
       OR EXISTS (SELECT 1 FROM public.music_target_stem_requests r WHERE r.job_id = v_job.id)
       OR EXISTS (SELECT 1 FROM public.music_track_add_requests r
                  WHERE r.track_job_id = v_job.id OR r.upload_job_id = v_job.id)
       OR EXISTS (SELECT 1 FROM public.assets a JOIN public.music_song_versions v ON v.audio_asset_id = a.id
                  WHERE a.job_id = v_job.id)
       OR EXISTS (SELECT 1 FROM public.assets a JOIN public.music_target_stem_assets t
                    ON a.id IN (t.target_asset_id, t.residual_asset_id)
                  WHERE a.job_id = v_job.id) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USED_BY_MUSIC');
    END IF;

    -- Recheck held material after acquiring every source asset in a stable order.
    PERFORM 1 FROM public.assets WHERE job_id = v_job.id ORDER BY id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.evidence_holds h WHERE h.job_id = v_job.id AND h.released_at IS NULL)
       OR EXISTS (SELECT 1 FROM public.assets a WHERE a.job_id = v_job.id AND a.held_at IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.content_reports r
                   WHERE r.subject_kind = 'job' AND r.subject_id = v_job.id AND r.status = 'open') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ON_HOLD');
    END IF;

    WITH gone AS (
        DELETE FROM public.assets WHERE job_id = v_job.id AND held_at IS NULL RETURNING r2_key
    )
    INSERT INTO public.asset_reap_queue (r2_key)
    SELECT r2_key FROM gone ON CONFLICT (r2_key) DO NOTHING;

    -- Intermediate output of a multi-step job (script text, scene and voice files).
    INSERT INTO public.asset_reap_queue (r2_key)
    SELECT s.output_r2_key FROM public.job_steps s WHERE s.job_id = v_job.id AND s.output_r2_key IS NOT NULL
    ON CONFLICT (r2_key) DO NOTHING;
    UPDATE public.job_steps SET output_r2_key = NULL, output_text = NULL WHERE job_id = v_job.id;

    -- The prompt, wherever it is kept. The job row, its state, model and credits stay: they back the ledger.
    UPDATE public.fal_dispatch SET payload = '{}'::jsonb WHERE job_id = v_job.id;
    UPDATE public.jobs SET inputs = '{}'::jsonb, deleted_at = now(), updated_at = now() WHERE id = v_job.id;

    RETURN jsonb_build_object('ok', true, 'replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.delete_user_job(TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_job(TEXT,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.push_enqueue_job_events(p_limit INTEGER DEFAULT 200)
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
               CASE WHEN j.state = 'STORED' THEN 'job_done' ELSE 'job_failed' END AS kind
          FROM people p
          JOIN public.jobs j ON j.user_id = p.user_id
         WHERE j.created_at > now() - interval '2 hours'
           AND j.updated_at > now() - interval '15 minutes'
           AND j.state IN ('STORED', 'FAILED', 'REFUNDED')
           AND j.error_code IS DISTINCT FROM 'user_cancelled'
           AND COALESCE(j.provider, '') <> 'openrouter-chat'
           AND j.inputs->>'kind' IS DISTINCT FROM 'speech_analysis'
           -- A local render (0504) finishes while the person watches; it is not news.
           AND COALESCE(j.provider, '') <> 'local'
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
REVOKE ALL ON FUNCTION public.push_enqueue_job_events(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_enqueue_job_events(INTEGER) TO service_role;
