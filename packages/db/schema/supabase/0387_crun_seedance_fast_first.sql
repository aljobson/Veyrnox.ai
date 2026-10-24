-- 0387 — Seedance 2.0 Fast: Crun becomes the first route and the price falls from 26 to 19 credits (ADR-0256, ADR-0037).
--
-- Evidence (the owner's paid probes, 2026-10-24, scripts/probe-crun.mjs seedance-fast, model
-- bytedance/seedance2-0-fast-t2v, 5 s 720p text to video):
--   task eae4bdeb-29e2-4366-a365-780616a8aae0: success after 128 s, 66.86 Crun credits, a SILENT clip (Crun's
--     `audio` switch defaults to off and the adapter did not send it);
--   task 80967a17-4f33-4a02-bcc1-2f56d9a56499 (after the adapter began sending audio: true, PR 1617): success after
--     102 s, 5.09 s, 1280x720, h264 with an audio stream, 66.86 Crun credits (audio does not change the price).
--   Two frames of the second clip read by Claude Code: a red paper boat on still water, a drop on its peak, ripples,
--     sharp and coherent, no watermark or overlay.
-- The owner's top-up rate is 206 Crun credits per $1 ($50 for 10,300), so a clip costs 66.86 / 206 = $0.3246 (the
-- recorded standby cost, $0.2902, assumed the $1,250 tier the owner does not buy).
-- Output host static.mediaoss.bar is on the R2 copy allowlist (PR 1616).
-- NOT established: which model or channel makes it. Crun's schema offers `direct_byteplus` and `byteplus_fallback`,
-- so its default channel is not BytePlus direct; that rests on Crun's written answers. The current first route
-- (OpenRouter, $0.4536) is `official`; this one is `licensed_reseller`.
--
-- What this does, in order, so every database reaches one state:
--   1. records the parity evidence and the real cost on the Crun route and sets it active;
--   2. puts Crun first through the guarded model_route_reorder where it is not already first;
--   3. prices the offer at 19 credits, the smallest whole-credit price that keeps 50% at that cost
--      (ceil(0.3246 / 0.01796) = 19; 18 would cover only $0.3233; $0.817 at the $129/3000 pack rate).
-- OpenRouter ($0.4536) stays second; above the floor at 19 credits, so a failover hop onto it needs a margin waiver
-- (ADR-0256 decision 3) and a job Crun refuses refunds.
--
-- Each UPDATE names the row's exact identity and asserts one row. Idempotent. Existing jobs keep the credits they were
-- debited. Rollback: a forward migration with model_route_reorder (OpenRouter first) and credits back at 26.

BEGIN;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_routes
       SET parity_record = 'probe 2026-10-24 (owner): bytedance/seedance2-0-fast-t2v with audio:true, task 80967a17-4f33-4a02-bcc1-2f56d9a56499 success after 102 s, 5.09 s 1280x720 h264 + audio, 66.86 Crun credits; first probe eae4bdeb-29e2-4366-a365-780616a8aae0 was silent (audio off by default); clip fetched and viewed by Claude (no watermark); channel and model identity rest on Crun id and its written answers',
           cost_per_unit = 0.3246, state = 'active', updated_at = now()
     WHERE supplier = 'crun' AND endpoint = 'crun:bytedance/seedance2-0-fast-t2v' AND model_id = 'seedance-2.0-fast'
       AND provenance = 'licensed_reseller' AND cost_unit = 'per_generation'
       AND cost_per_unit IN (0.2902, 0.3246) AND state IN ('standby', 'active')
       AND (parity_record IS NULL OR parity_record LIKE 'probe 2026-10-24 (owner): bytedance/seedance2-0-fast-t2v%');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one Crun Seedance Fast route to prove and activate, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE res jsonb;
BEGIN
    IF EXISTS (SELECT 1 FROM public.model_catalog WHERE id = 'seedance-2.0-fast' AND provider <> 'crun') THEN
        SELECT public.model_route_reorder(
            'seedance-2.0-fast',
            (SELECT array_agg(id ORDER BY CASE supplier WHEN 'crun' THEN 0 ELSE 1 END, priority)
               FROM public.model_routes WHERE model_id = 'seedance-2.0-fast' AND state = 'active'),
            'Crun first for Seedance Fast, parity 2026-10-24 (0387)'
        ) INTO res;
        IF NOT COALESCE((res->>'ok')::boolean, false) THEN
            RAISE EXCEPTION 'Could not put Crun first for seedance-2.0-fast: %', res;
        END IF;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog SET credits_5s = 19, provider_cost_per_unit = 0.3246, updated_at = now()
     WHERE id = 'seedance-2.0-fast' AND provider = 'crun' AND provider_endpoint = 'crun:bytedance/seedance2-0-fast-t2v'
       AND provider_cost_per_unit IN (0.2902, 0.3246) AND cost_unit = 'per_generation' AND billing_seconds IS NULL
       AND active AND credits_5s IN (26, 19);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one seedance-2.0-fast row on Crun, updated %', affected;
    END IF;
END $$;

COMMIT;
