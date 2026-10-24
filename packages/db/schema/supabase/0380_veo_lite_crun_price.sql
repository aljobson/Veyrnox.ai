-- 0380 — Price Veo 3.1 Lite at its Crun floor: 9 -> 5 credits (ADR-0037 amendment 2, ADR-0256).
--
-- The offer's first route is now Crun (reorder 2026-10-24, parity recorded in 0377, Crun second-route
-- activation in 0379). A Veo Lite clip is 15 Crun credits, confirmed in Crun's log for three clips. The
-- owner's top-up was $50 for 10,300 credits (206 per $1), so a clip costs 15 / 206 = $0.0728 (the earlier
-- $0.0670 assumed the $1,250 prepay tier at 224 per $1, which the owner does not buy). The route and the
-- catalog row both carry $0.0728.
--
-- The whole-credit floor at that cost is ceil(0.0728 / 0.01796) = 5 credits: $0.215 at the $129/3000
-- pack ($0.043) and $0.31 at the entry pack. The standing per-row rule (0366) checks
-- cost <= credits * 0.01796: 0.0728 <= 0.0898. At 4 credits it would fail (0.0718).
--
-- The kie route ($0.15) stays second. At 5 credits it is above the floor, so the database refuses a
-- failover hop onto it unless a margin waiver is recorded (ADR-0256 decision 3); a job Crun refuses
-- outright refunds.
--
-- Each UPDATE names the row's exact identity and accepts the old or the new value, so a replay is a no-op
-- and a row that was reordered back to kie stops the migration instead of repricing a different offer.
-- Existing jobs keep the credits they were debited.
--
-- Idempotent: absolute assignments guarded by the row identity.
-- Rollback: a forward migration setting credits_5s back to 9 and the costs back (or to the kie floor if
-- kie is first again).

BEGIN;

-- Crun is first in production since the 2026-10-24 reorder; a database built from these files starts
-- with kie first. Put Crun first through the guarded function (parity, eligibility and margin checks
-- included) only where it is not, so every database reaches the same state and a replay changes nothing.
DO $$
DECLARE res jsonb;
BEGIN
    IF EXISTS (SELECT 1 FROM public.model_catalog WHERE id = 'veo-3.1-lite-kie' AND provider <> 'crun') THEN
        SELECT public.model_route_reorder(
            'veo-3.1-lite-kie',
            (SELECT array_agg(id ORDER BY CASE supplier WHEN 'crun' THEN 0 ELSE 1 END, priority)
               FROM public.model_routes WHERE model_id = 'veo-3.1-lite-kie' AND state = 'active'),
            'Crun first for Veo Lite, parity 2026-10-24 (0380)'
        ) INTO res;
        IF NOT COALESCE((res->>'ok')::boolean, false) THEN
            RAISE EXCEPTION 'Could not put Crun first for veo-3.1-lite-kie: %', res;
        END IF;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_routes SET cost_per_unit = 0.0728, updated_at = now()
     WHERE model_id = 'veo-3.1-lite-kie' AND supplier = 'crun' AND endpoint = 'crun:google/veo3-1-lite-t2v'
       AND cost_unit = 'per_generation' AND cost_per_unit IN (0.0670, 0.0728);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one Crun route of veo-3.1-lite-kie, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog SET credits_5s = 5, provider_cost_per_unit = 0.0728, updated_at = now()
     WHERE id = 'veo-3.1-lite-kie' AND provider = 'crun' AND provider_endpoint = 'crun:google/veo3-1-lite-t2v'
       AND provider_cost_per_unit IN (0.0670, 0.0728) AND cost_unit = 'per_generation' AND billing_seconds IS NULL
       AND active AND credits_5s IN (9, 5);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one veo-3.1-lite-kie row on Crun, updated %', affected;
    END IF;
END $$;

COMMIT;
