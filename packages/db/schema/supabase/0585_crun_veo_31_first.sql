-- 0585 — Veo 3.1 (8 s, 720p, audio; public id veo-3.1-a1, gated): Crun becomes the first route, kie second.
-- The price stays at 70 credits (ADR-0256, ADR-0037). Owner decision 2026-11-23: Crun first wherever Crun has the same
-- model and is not dearer.
--
-- Evidence (owner's paid probe, 2026-11-23, scripts/probe-crun.mjs veo, model google/veo3-1-t2v): task
-- 586f2742-113c-43de-875a-12e2c6fba2fc succeeded after 66 s (69 s in all). Output host tempfile.mediaoss.bar, video/mp4,
-- 2,084,757 bytes; ffprobe: 7.93 s, 1280x720, h264 with an AAC audio stream. Two frames read by Claude Code: a red paper
-- boat on calm water at sunrise, sharp and coherent, no watermark or overlay.
-- Cost: Crun's estimate-credits answered 225 credits with estimated=false (exact) the same day, so a clip costs
-- 225 / 206 = $1.0922 at the owner's top-up rate of 206 Crun credits per $1. That is above the $1.0045 recorded on the
-- standby route in 0369 (Crun's price rose about 8.7%), and below kie's $1.25.
-- NOT established: the charge in Crun's own log (not read), which model made the clip (that rests on Crun's model id and
-- its written answers), and any length or resolution other than 8 s at 720p.
--
-- Floor: 70 x 0.01796 = $1.2572. Crun $1.0922 and kie $1.2500 are both inside it, so a hop to kie needs no waiver.
--
-- What this does, in order, so every database reaches one state:
--   1. records the parity evidence on the Crun route, sets its cost to $1.0922 and activates it (licensed_reseller since
--      0375);
--   2. puts Crun first through the guarded model_route_reorder where it is not already first (it re-checks parity,
--      breakers and the offer's margin floor, and copies the first route's supplier, endpoint and cost to the catalog row);
--   3. records the new cost on the catalog row and asserts the end state. Price and gating are not touched.
--
-- Each UPDATE names the row's exact identity and asserts one row. Idempotent. Existing jobs keep their debit.
-- Rollback: a forward migration with model_route_reorder (kie first).

BEGIN;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_routes
       SET parity_record = 'probe 2026-11-23 (owner): google/veo3-1-t2v, task 586f2742-113c-43de-875a-12e2c6fba2fc success after 66 s; 225 credits per estimate-credits (exact); clip 7.93 s 1280x720 h264 + aac, two frames viewed by Claude Code, no watermark',
           cost_per_unit = 1.0922, state = 'active', updated_at = now()
     WHERE supplier = 'crun' AND endpoint = 'crun:google/veo3-1-t2v' AND model_id = 'veo-3.1-kie'
       AND provenance = 'licensed_reseller' AND cost_unit = 'per_generation'
       AND cost_per_unit IN (1.0045, 1.0922) AND state IN ('standby', 'active')
       AND (parity_record IS NULL OR parity_record LIKE 'probe 2026-11-23 (owner): google/veo3-1-t2v%');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one Crun Veo 3.1 route to prove and activate, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE res jsonb;
BEGIN
    IF EXISTS (SELECT 1 FROM public.model_catalog WHERE id = 'veo-3.1-kie' AND provider <> 'crun') THEN
        SELECT public.model_route_reorder(
            'veo-3.1-kie',
            (SELECT array_agg(id ORDER BY CASE supplier WHEN 'crun' THEN 0 ELSE 1 END, priority)
               FROM public.model_routes WHERE model_id = 'veo-3.1-kie' AND state = 'active'),
            'Crun first for Veo 3.1, parity 2026-11-23 (0585)'
        ) INTO res;
        IF NOT COALESCE((res->>'ok')::boolean, false) THEN
            RAISE EXCEPTION 'Could not put Crun first for veo-3.1-kie: %', res;
        END IF;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog SET provider_cost_per_unit = 1.0922, updated_at = now()
     WHERE id = 'veo-3.1-kie' AND provider = 'crun' AND provider_endpoint = 'crun:google/veo3-1-t2v'
       AND provider_cost_per_unit IN (1.0045, 1.0922) AND cost_unit = 'per_generation' AND billing_seconds IS NULL
       AND active AND credits_5s = 70;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one veo-3.1-kie row on Crun at 70 credits, updated %', affected;
    END IF;
    SELECT count(*) INTO affected FROM public.model_routes
     WHERE model_id = 'veo-3.1-kie' AND state = 'active'
       AND ((priority = 1 AND supplier = 'crun' AND endpoint = 'crun:google/veo3-1-t2v')
         OR (priority = 2 AND supplier = 'kie' AND endpoint = 'veo:veo3'));
    IF affected <> 2 THEN
        RAISE EXCEPTION 'Expected Crun first and kie second on veo-3.1-kie, found % matching routes', affected;
    END IF;
END $$;

COMMIT;
