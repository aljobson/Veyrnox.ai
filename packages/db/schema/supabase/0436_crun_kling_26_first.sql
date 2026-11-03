-- 0436 — Kling 2.6 Pro: Crun becomes the first route; the price does not change (ADR-0256, ADR-0037).
--
-- Evidence (the owner's paid probe, 2026-11-03, scripts/probe-crun.mjs kling-2-6, model kling/v2-6, pro, audio off,
-- 5 s text to video): task 3d31954f-b9de-4181-b33a-c32a8ec17a36 succeeded after 87 s. The output was fetched from
-- static.mediaoss.bar (already on the R2 allowlist) and measured with ffprobe: 5.04 s, 1920x1080, h264, no audio stream
-- (as asked), 7,493,312 bytes. Two frames read by Claude Code: a red paper boat on calm water at dusk, sharp and
-- coherent, no watermark or overlay.
-- Charge: 55 Crun credits, read and confirmed by the owner in crun.ai/logs on 2026-11-03, as expected.
-- NOT established: which model made the clip (a clip cannot prove that; it rests on Crun's model id and its written
-- answers).
--
-- Cost: 55 Crun credits at the owner's top-up rate of 206 per $1 = $0.2670 per 5 s unit (0435). kie is $0.3150.
-- The offer stays at 18 credits (0433), so kie, now second, is 0.3150 <= 18 x 0.01796 = $0.3233: a failover hop onto
-- it needs no margin waiver. The saving is margin, not a price cut. This offer is text-only, so a hop is possible
-- (an image request is never hopped, which is why Kling 3.0 is not in this migration).
--
-- What this does, in order, so every database reaches one state:
--   1. records the parity evidence on the Crun route and sets it active (licensed_reseller since 0375);
--   2. puts Crun first through the guarded model_route_reorder, where it is not already first (it re-checks parity,
--      breakers and the offer's margin floor);
--   3. asserts the offer is now served by Crun at the unchanged 18 credits.
--
-- Each UPDATE names the row's exact identity and asserts one row. Idempotent. Existing jobs keep their debit.
-- Rollback: a forward migration with model_route_reorder (kie first) and the catalog row left at 18 credits.

BEGIN;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_routes
       SET parity_record = 'probe 2026-11-03 (owner): kling/v2-6 pro audio off, task 3d31954f-b9de-4181-b33a-c32a8ec17a36 success after 87 s; clip fetched and viewed by Claude (5.04 s 1920x1080 h264, no audio stream, no watermark or overlay; two frames: red paper boat on calm water at dusk, sharp and coherent); output host static.mediaoss.bar; charge 55 credits confirmed by the owner in the Crun log; model identity rests on Crun id and its written answers (a clip cannot prove it)',
           cost_per_unit = 0.2670, state = 'active', updated_at = now()
     WHERE supplier = 'crun' AND endpoint = 'crun:kling/v2-6' AND model_id = 'kling-2.6-pro-kie'
       AND provenance = 'licensed_reseller' AND cost_unit = 'per_second' AND billing_seconds = 5
       AND cost_per_unit = 0.2670 AND state IN ('standby', 'active')
       AND (parity_record IS NULL OR parity_record LIKE 'probe 2026-11-03 (owner): kling/v2-6%');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one Crun Kling 2.6 route to prove and activate, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE res jsonb;
BEGIN
    IF EXISTS (SELECT 1 FROM public.model_catalog WHERE id = 'kling-2.6-pro-kie' AND provider <> 'crun') THEN
        SELECT public.model_route_reorder(
            'kling-2.6-pro-kie',
            (SELECT array_agg(id ORDER BY CASE supplier WHEN 'crun' THEN 0 ELSE 1 END, priority)
               FROM public.model_routes WHERE model_id = 'kling-2.6-pro-kie' AND state = 'active'),
            'Crun first for Kling 2.6 Pro, parity 2026-11-03 (0436)'
        ) INTO res;
        IF NOT COALESCE((res->>'ok')::boolean, false) THEN
            RAISE EXCEPTION 'Could not put Crun first for kling-2.6-pro-kie: %', res;
        END IF;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    SELECT count(*) INTO affected FROM public.model_catalog
     WHERE id = 'kling-2.6-pro-kie' AND provider = 'crun' AND provider_endpoint = 'crun:kling/v2-6'
       AND provider_cost_per_unit = 0.2670 AND cost_unit = 'per_second' AND billing_seconds = 5 AND credits_5s = 18;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected kling-2.6-pro-kie served by Crun at 18 credits, found % matching rows', affected;
    END IF;
END $$;

COMMIT;
