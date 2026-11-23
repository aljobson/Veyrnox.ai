-- 0582 — Kling 3.0 Pro image-to-video (the fal offer): Crun first, fal second; the price does not change (ADR-0256).
--
-- Evidence: the route is the one 0559 proved, crun:kling/v3 = kling/v3, mode pro (1080p), audio off, single shot, one start
-- frame: the owner's paid probe of 2026-11-17, 10 s, Success, 180 credits, 161 s (18 credits a second, one sample).
-- Cost: 90 Crun credits per 5 s unit at 206 per $1 = $0.4369 <= 32 x 0.01796 = $0.5747. fal, second, is $0.5600.
--
-- Crun has no negative prompt field, and an end frame on this route is unproved. Both are refused before the debit by the
-- Worker release this depends on. An image-source job never hops, so a job Crun refuses is refunded.
-- Seedance 2.0 Reference is NOT moved here: its audio-on request has no paid proof.
--
-- Deploy the Worker with this PR BEFORE applying this. Idempotent. Rollback: a forward migration with model_route_reorder.

BEGIN;

INSERT INTO public.model_routes
    (model_id, supplier, endpoint, cost_per_unit, cost_unit, billing_seconds, priority, state, provenance)
SELECT 'kling-3.0-i2v', 'crun', 'crun:kling/v3', 0.4369, 'per_second', 5,
       (SELECT COALESCE(max(x.priority), 0) + 1 FROM public.model_routes x WHERE x.model_id = 'kling-3.0-i2v'),
       'standby', 'licensed_reseller'
ON CONFLICT (model_id, supplier, endpoint) DO NOTHING;

DO $$
DECLARE affected BIGINT; res jsonb;
BEGIN
    UPDATE public.model_routes
       SET parity_record = 'proof 2026-11-17 (owner, recorded in 0559): crun:kling/v3 = kling/v3 mode pro (1080p), 10 s, audio off, one start frame, Success, 161 s, 180 credits; negative prompt and end frame are refused before debit on this offer; output not inspected; model identity rests on Crun id; one sample',
           state = 'active', updated_at = now()
     WHERE model_id = 'kling-3.0-i2v' AND supplier = 'crun' AND endpoint = 'crun:kling/v3'
       AND provenance = 'licensed_reseller' AND cost_unit = 'per_second' AND billing_seconds = 5
       AND cost_per_unit = 0.4369 AND state IN ('standby', 'active');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one Crun route to prove on kling-3.0-i2v, updated %', affected;
    END IF;

    IF EXISTS (SELECT 1 FROM public.model_catalog WHERE id = 'kling-3.0-i2v' AND provider <> 'crun') THEN
        SELECT public.model_route_reorder(
            'kling-3.0-i2v',
            (SELECT array_agg(id ORDER BY CASE supplier WHEN 'crun' THEN 0 ELSE 1 END, priority)
               FROM public.model_routes WHERE model_id = 'kling-3.0-i2v' AND state = 'active'),
            'Crun first, fal second, Kling 3.0 Pro (0582)'
        ) INTO res;
        IF NOT COALESCE((res->>'ok')::boolean, false) THEN
            RAISE EXCEPTION 'Could not put Crun first for kling-3.0-i2v: %', res;
        END IF;
    END IF;

    SELECT count(*) INTO affected FROM public.model_catalog
     WHERE id = 'kling-3.0-i2v' AND provider = 'crun' AND provider_endpoint = 'crun:kling/v3'
       AND provider_cost_per_unit = 0.4369 AND cost_unit = 'per_second' AND billing_seconds = 5 AND credits_5s = 32;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected kling-3.0-i2v served by Crun at 32 credits, found % rows', affected;
    END IF;

    SELECT count(*) INTO affected FROM public.model_routes
     WHERE model_id = 'kling-3.0-i2v' AND state = 'active'
       AND ((priority = 1 AND supplier = 'crun' AND endpoint = 'crun:kling/v3')
         OR (priority = 2 AND supplier = 'fal' AND endpoint = 'fal-ai/kling-video/v3/pro/image-to-video'));
    IF affected <> 2 THEN
        RAISE EXCEPTION 'Expected Crun first and fal second on kling-3.0-i2v, found % matching routes', affected;
    END IF;
END $$;

COMMIT;
