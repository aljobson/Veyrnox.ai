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
-- Runtime health and historical proof were checked against production before
-- this release. They deliberately are not migration preconditions: schema
-- replay, staging and disaster recovery databases must apply deterministically
-- even when they do not contain production history or a running worker.
--
-- Idempotent for an already-active ace-step row. Rollback: a forward migration
-- setting ace-step inactive; existing jobs continue through retained dispatch.

BEGIN;

DO $$
DECLARE
    affected BIGINT;
    reordered JSONB;
BEGIN
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
