-- 0386 — Veo 3.1 Fast: Crun becomes the first route and the price falls from 17 to 9 credits (ADR-0256, ADR-0037).
--
-- Evidence (owner's paid probe, 2026-10-24 22:35 local, scripts/probe-crun.mjs veo-fast, model
-- google/veo3-1-fast-t2v): task 492debcb-36c1-4cf5-9a16-5c378364851c succeeded after 70 s. Crun's log shows
-- 30 Crun credits for it, as expected. The owner's top-up rate is 206 Crun credits per $1 ($50 for 10,300), so
-- a clip costs 30 / 206 = $0.1456 (the earlier $0.134 assumed the $1,250 tier the owner does not buy).
-- The clip was fetched afterwards (the probe script's own download failed on the owner's router DNS, fixed
-- the same evening) and measured with ffprobe: 8.0 s, 1280x720, h264, with an AAC audio stream; two frames read
-- by Claude Code: a red paper boat on calm water at sunrise, sharp and coherent, no watermark or overlay.
-- NOT established: which model made it. A clip cannot prove that; it rests on Crun's model id and its written
-- answers.
--
-- What this does, in order, so every database reaches one state:
--   1. records the parity evidence above on the Crun route and sets its cost to $0.1456;
--   2. sets that route active (licensed_reseller since 0375, CRUN_ENABLED on in production);
--   3. puts Crun first through the guarded model_route_reorder where it is not already first (the same
--      function that carried Veo Lite; it re-checks parity, breakers and the offer's margin floor);
--   4. prices the offer at 9 credits, the smallest whole-credit price that keeps 50% at that cost
--      (ceil(0.1456 / 0.01796) = 9; $0.387 at the $129/3000 pack rate, $0.65 at the $10 pack).
-- The kie route ($0.30) stays second. At 9 credits it is above the floor (9 x 0.01796 = $0.1616), so a failover
-- hop onto it is refused unless a margin waiver is recorded (ADR-0256 decision 3): a job Crun refuses refunds.
--
-- Each UPDATE names the row's exact identity and asserts one row. Idempotent. Existing jobs keep the credits
-- they were debited. Rollback: a forward migration with model_route_reorder (kie first) and credits back at 17.

BEGIN;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_routes
       SET parity_record = 'probe 2026-10-24 (owner): google/veo3-1-fast-t2v, task 492debcb-36c1-4cf5-9a16-5c378364851c success after 70 s; charge 30 credits confirmed in Crun log; clip fetched and viewed by Claude (8.0 s 1280x720 h264 + aac, red paper boat at sunrise, no watermark); model identity rests on Crun id and its written answers',
           cost_per_unit = 0.1456, state = 'active', updated_at = now()
     WHERE supplier = 'crun' AND endpoint = 'crun:google/veo3-1-fast-t2v' AND model_id = 'veo-3.1-fast-kie'
       AND provenance = 'licensed_reseller' AND cost_unit = 'per_generation'
       AND cost_per_unit IN (0.1339, 0.1340, 0.1456) AND state IN ('standby', 'active')
       AND (parity_record IS NULL OR parity_record LIKE 'probe 2026-10-24 (owner): google/veo3-1-fast-t2v%');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one Crun Veo Fast route to prove and activate, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE res jsonb;
BEGIN
    IF EXISTS (SELECT 1 FROM public.model_catalog WHERE id = 'veo-3.1-fast-kie' AND provider <> 'crun') THEN
        SELECT public.model_route_reorder(
            'veo-3.1-fast-kie',
            (SELECT array_agg(id ORDER BY CASE supplier WHEN 'crun' THEN 0 ELSE 1 END, priority)
               FROM public.model_routes WHERE model_id = 'veo-3.1-fast-kie' AND state = 'active'),
            'Crun first for Veo Fast, parity 2026-10-24 (0386)'
        ) INTO res;
        IF NOT COALESCE((res->>'ok')::boolean, false) THEN
            RAISE EXCEPTION 'Could not put Crun first for veo-3.1-fast-kie: %', res;
        END IF;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog SET credits_5s = 9, provider_cost_per_unit = 0.1456, updated_at = now()
     WHERE id = 'veo-3.1-fast-kie' AND provider = 'crun' AND provider_endpoint = 'crun:google/veo3-1-fast-t2v'
       AND provider_cost_per_unit IN (0.1339, 0.1340, 0.1456) AND cost_unit = 'per_generation' AND billing_seconds IS NULL
       AND active AND credits_5s IN (17, 9);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one veo-3.1-fast-kie row on Crun, updated %', affected;
    END IF;
END $$;

COMMIT;
