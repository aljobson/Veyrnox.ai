-- 0558 — Kling 3.0 Standard (720p) goes live: Crun first, fal second (ADR-0256, ADR-0350).
--
-- Evidence
--   fal Standard, staging probe 2026-11-17, same 10 s image-to-video clip, audio off: 113 s and 136 s render, 1172x784.
--   fal bill read by the owner's browser session 2026-11-17 for the two requests 01a1e8f2-7f17-7f70-94a8-3debfa373c9c
--   and 01a1e8f0-4540-7ff3-a634-e0605e3c2bb2: $0.84 each (6.00 units at $0.14), as 0556 required before activation.
--   Crun Standard, the owner's paid probe 2026-11-17 (scripts/probe-crun.mjs kling-3-std-10s, crun:kling/v3-std = model
--   kling/v3, mode std, 10 s, audio off, one start frame): task 38a4f733-9235-4f62-8f05-932d89c161b2 succeeded after
--   125 s by the script's timer (116 s in crun.ai/logs). Output host static.mediaoss.bar, video/mp4, 8,047,717 bytes.
--   Charge: 140 Crun credits, read in crun.ai/logs on 2026-11-17, as expected (14 credits a second x 10).
--   NOT established: the clip's resolution and content (the probe did not download it), and which model made it (a
--   clip cannot prove that; it rests on Crun's model id). One sample.
--
-- Cost at the owner's top-up rate of 206 Crun credits per $1: 70 / 206 = $0.3398 per 5 s unit (0557). fal is $0.4200.
-- The offer stays at 24 credits (0556): the saving is margin, not a price cut. fal, now second, is 0.4200 <=
-- 24 x 0.01796 = $0.4310, so a failover hop onto it needs no margin waiver.
--
-- What this does, in order, so every database reaches one state:
--   1. records fal as this offer's priority-1 route, active, where it has none (0556 staged the catalog row only);
--   2. records the parity evidence on the Crun route and sets it active;
--   3. puts Crun first through the guarded model_route_reorder, where it is not already first (it re-checks parity and
--      breakers and copies the first route's supplier, endpoint and cost to the catalog row);
--   4. activates the offer (active = true), with an exact row-count assertion;
--   5. asserts the offer is served by Crun at 24 credits with fal second.
--
-- The offer's capability record for `crun:kling/v3-std` ships in the same release (lib/additionalModelCapabilities.js).
-- Existing jobs keep their debit. Idempotent. Rollback: a forward migration with model_route_reorder (fal first) and
-- active = false.

BEGIN;

INSERT INTO public.model_routes
    (model_id, supplier, endpoint, cost_per_unit, cost_unit, billing_seconds, priority, state, provenance, parity_record)
SELECT 'kling-3.0-standard-i2v', 'fal', 'fal-ai/kling-video/v3/standard/image-to-video', 0.4200, 'per_second', 5, 1, 'active', 'official',
       'staging probe 2026-11-17: Standard 10 s audio off, render 113 s and 136 s, 1172x784; fal bill read 2026-11-17 for requests 01a1e8f2-7f17-7f70-94a8-3debfa373c9c and 01a1e8f0-4540-7ff3-a634-e0605e3c2bb2, $0.84 each'
  FROM public.model_catalog c
 WHERE c.id = 'kling-3.0-standard-i2v'
   AND NOT EXISTS (SELECT 1 FROM public.model_routes r
                    WHERE r.model_id = 'kling-3.0-standard-i2v'
                      AND (r.priority = 1 OR (r.supplier = 'fal' AND r.endpoint = 'fal-ai/kling-video/v3/standard/image-to-video')));

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_routes
       SET parity_record = 'probe 2026-11-17 (owner): crun:kling/v3-std = kling/v3 mode std, 10 s, audio off, task 38a4f733-9235-4f62-8f05-932d89c161b2 success after 125 s (116 s in crun.ai/logs); output host static.mediaoss.bar, video/mp4, 8,047,717 bytes; charge 140 credits read in crun.ai/logs; resolution and content not inspected (clip not downloaded); model identity rests on Crun id (a clip cannot prove it); one sample',
           cost_per_unit = 0.3398, state = 'active', updated_at = now()
     WHERE supplier = 'crun' AND endpoint = 'crun:kling/v3-std' AND model_id = 'kling-3.0-standard-i2v'
       AND provenance = 'licensed_reseller' AND cost_unit = 'per_second' AND billing_seconds = 5
       AND cost_per_unit = 0.3398 AND state IN ('standby', 'active')
       AND (parity_record IS NULL OR parity_record LIKE 'probe 2026-11-17 (owner): crun:kling/v3-std%');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one Crun Kling Standard route to prove and activate, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE res jsonb;
BEGIN
    IF EXISTS (SELECT 1 FROM public.model_catalog WHERE id = 'kling-3.0-standard-i2v' AND provider <> 'crun') THEN
        SELECT public.model_route_reorder(
            'kling-3.0-standard-i2v',
            (SELECT array_agg(id ORDER BY CASE supplier WHEN 'crun' THEN 0 ELSE 1 END, priority)
               FROM public.model_routes WHERE model_id = 'kling-3.0-standard-i2v' AND state = 'active'),
            'Crun first for Kling 3.0 Standard, parity 2026-11-17 (0558)'
        ) INTO res;
        IF NOT COALESCE((res->>'ok')::boolean, false) THEN
            RAISE EXCEPTION 'Could not put Crun first for kling-3.0-standard-i2v: %', res;
        END IF;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET active = true, updated_at = now()
     WHERE id = 'kling-3.0-standard-i2v' AND provider = 'crun' AND provider_endpoint = 'crun:kling/v3-std'
       AND provider_cost_per_unit = 0.3398 AND cost_unit = 'per_second' AND billing_seconds = 5
       AND credits_5s = 24 AND modality = 'image-to-video';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected kling-3.0-standard-i2v served by Crun at 24 credits to activate, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE n BIGINT;
BEGIN
    SELECT count(*) INTO n FROM public.model_routes
     WHERE model_id = 'kling-3.0-standard-i2v' AND state = 'active'
       AND ((priority = 1 AND supplier = 'crun' AND endpoint = 'crun:kling/v3-std')
         OR (priority = 2 AND supplier = 'fal' AND endpoint = 'fal-ai/kling-video/v3/standard/image-to-video'));
    IF n <> 2 THEN
        RAISE EXCEPTION 'Expected Crun first and fal second on kling-3.0-standard-i2v, found % matching routes', n;
    END IF;
END $$;

COMMIT;
