-- 0621 — Reactivate the verified Create Music offer after separating the failed
-- generic model-QA path from the durable Music pipeline.
--
-- Production evidence (xdxdzmsztyzbnzeforxx, 2026-11-26 Europe/London):
--   * The two jobs named by 0611 were not Music generations: neither had a
--     music_generation_candidate, request, quote or crun_dispatch row. They were
--     generic model-QA jobs and therefore did not exercise Music settlement.
--   * Six ace-step Music candidates completed through crun_dispatch and reached
--     STORED. The latest pair finished on 2026-11-24 at 18:47 UTC.
--   * crun_dispatch_health() was clear and worker_task_health.crun_dispatch was
--     succeeding once per minute at the reactivation review.
--
-- Only ace-step is relisted. ace-step-1.5 stays inactive until it has its own
-- create-to-library evidence. Web and mobile share this catalog gate, so one
-- verified offer makes Create Music available on both clients.
--
-- Idempotent for an already-active ace-step row. Rollback: a forward migration
-- setting ace-step inactive; existing jobs continue through retained dispatch.

BEGIN;

DO $$
DECLARE
    affected BIGINT;
    health JSONB;
    reordered JSONB;
BEGIN
    -- A fresh migration replay has no customer jobs or worker heartbeats. An
    -- existing environment does, and must pass the live operational evidence
    -- before the offer can be re-enabled there.
    IF EXISTS (SELECT 1 FROM public.jobs) THEN
        SELECT public.crun_dispatch_health() INTO health;
        IF COALESCE((health->>'unknown')::BIGINT, 0) <> 0
           OR COALESCE((health->>'accepted_unobservable')::BIGINT, 0) <> 0
           OR COALESCE((health->>'authoritative_pending')::BIGINT, 0) <> 0 THEN
            RAISE EXCEPTION 'Crun dispatch is not healthy enough to reactivate Music: %', health;
        END IF;

        IF NOT EXISTS (
            SELECT 1
              FROM public.worker_task_health
             WHERE task = 'crun_dispatch'
               AND last_ok
               AND last_success >= statement_timestamp() - interval '10 minutes'
        ) THEN
            RAISE EXCEPTION 'Crun dispatch worker has no successful heartbeat in the last 10 minutes';
        END IF;

        SELECT count(*) INTO affected
          FROM public.jobs j
          JOIN public.music_generation_candidates c ON c.job_id = j.id
          JOIN public.music_generation_requests r ON r.id = c.generation_request_id
          JOIN public.music_generation_quotes q ON q.id = r.quote_id
          JOIN public.crun_dispatch d ON d.job_id = j.id
         WHERE j.model_id = 'ace-step'
           AND j.provider = 'crun'
           AND j.state = 'STORED'
           AND r.status = 'succeeded'
           AND q.provider_contract = 'crun-suno-v1'
           AND q.provider_endpoint = 'crun:suno/music-generate'
           AND d.state = 'CLOSED'
           AND d.provider_job_id = j.provider_job_id;
        IF affected < 2 THEN
            RAISE EXCEPTION 'Expected at least two stored durable ace-step Music candidates, found %', affected;
        END IF;
    END IF;

    IF NOT (public.music_get_crun_availability()->>'ok')::BOOLEAN
       OR NOT (public.music_get_crun_availability()->>'admission_open')::BOOLEAN
       OR NOT (public.music_get_crun_availability()->>'endpoint_open')::BOOLEAN
       OR NOT (public.music_get_crun_availability()->'suno_models'->>'v6')::BOOLEAN THEN
        RAISE EXCEPTION 'Crun Suno v6 availability gate is closed';
    END IF;

    UPDATE public.model_routes
       SET state = 'active',
           provenance = 'licensed_reseller',
           parity_record = COALESCE(parity_record,
             'production Music proof 2026-11-23/24: six ace-step candidates completed through crun_dispatch and reached STORED; CRUN Suno v6 custom probe task 838759d0-0003-45f2-8dce-0d0440e58a0e completed in 31 seconds; licensed reseller evidence retained by owner'),
           updated_at = statement_timestamp()
     WHERE model_id = 'ace-step'
       AND supplier = 'crun'
       AND endpoint = 'crun:suno/music-generate'
       AND cost_per_unit = 0.0536
       AND cost_unit = 'per_generation'
       AND billing_seconds IS NULL
       AND state IN ('standby', 'active')
       AND provenance IN ('unverified', 'licensed_reseller');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one ace-step Crun route to verify and activate, updated %', affected;
    END IF;

    IF EXISTS (SELECT 1 FROM public.model_catalog WHERE id = 'ace-step' AND provider <> 'crun') THEN
        SELECT public.model_route_reorder(
            'ace-step',
            (SELECT array_agg(id ORDER BY CASE supplier WHEN 'crun' THEN 0 ELSE 1 END, priority)
               FROM public.model_routes
              WHERE model_id = 'ace-step' AND state = 'active'),
            'Verified Create Music CRUN route first (0621)'
        ) INTO reordered;
        IF reordered->>'ok' IS DISTINCT FROM 'true' THEN
            RAISE EXCEPTION 'Could not put verified CRUN route first for ace-step: %', reordered;
        END IF;
    END IF;

    UPDATE public.model_catalog
       SET active = true,
           credits_5s = 4,
           updated_at = statement_timestamp()
     WHERE id = 'ace-step'
       AND modality = 'text-to-audio'
       AND provider = 'crun'
       AND provider_endpoint = 'crun:suno/music-generate'
       AND credits_5s IN (2, 4)
       AND provider_cost_per_unit = 0.0536
       AND cost_unit = 'per_generation'
       AND billing_seconds IS NULL
       AND NOT gated_flag
       AND active IN (false, true);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one verified ace-step Music offer to reactivate, updated %', affected;
    END IF;

    IF (SELECT count(*)
          FROM public.model_catalog
         WHERE id = 'ace-step'
           AND active
           AND provider = 'crun'
           AND provider_endpoint = 'crun:suno/music-generate'
           AND credits_5s * 0.033 >= 2 * provider_cost_per_unit) <> 1 THEN
        RAISE EXCEPTION 'Active ace-step Music catalog/provider/margin assertion failed';
    END IF;

    IF (SELECT count(*)
          FROM public.model_routes
         WHERE model_id = 'ace-step'
           AND state = 'active'
           AND breaker_opened_at IS NULL
           AND parity_record IS NOT NULL
           AND btrim(parity_record) <> ''
           AND ((priority = 1 AND supplier = 'crun' AND endpoint = 'crun:suno/music-generate'
                 AND provenance = 'licensed_reseller')
             OR (priority = 2 AND supplier = 'fal' AND endpoint = 'fal-ai/ace-step'))) <> 2 THEN
        RAISE EXCEPTION 'Expected verified CRUN first and fal second for ace-step';
    END IF;

    IF (SELECT active FROM public.model_catalog WHERE id = 'ace-step-1.5') IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'ace-step-1.5 must remain inactive until separately verified';
    END IF;
END $$;

COMMIT;
