-- 0380 — Price Veo 3.1 Lite at its Crun floor: 9 -> 4 credits (ADR-0037 amendment 2, ADR-0256).
--
-- The offer's first route is now Crun at $0.0670 a clip (reorder 2026-10-24, parity recorded in 0377,
-- Crun second-route activation in 0379). The catalog row carries that route's cost, so the whole-credit
-- floor moves with it: ceil(0.0670 / 0.01796) = 4 credits, i.e. $0.172 at the $129/3000 pack ($0.043)
-- and $0.25 at the entry pack. The standing per-row rule (0366) checks cost <= credits * 0.01796:
-- 0.0670 <= 0.0718.
--
-- The kie route ($0.15) stays the second route. At 4 credits it is above the floor, so the database
-- refuses a failover hop onto it unless a margin waiver is recorded (ADR-0256 decision 3). Without
-- that, a job Crun refuses outright refunds instead of hopping to kie.
--
-- The UPDATE names the row's exact identity (provider, endpoint, recorded cost, unit) and accepts the
-- old or the new price, so a replay is a no-op and a row that was reordered back to kie stops the
-- migration instead of repricing a different offer. Existing jobs keep the credits they were debited.
--
-- Idempotent: an absolute assignment guarded by the row identity.
-- Rollback: a forward migration setting credits_5s back to 9 (or to the kie floor if kie is first again).

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
    UPDATE public.model_catalog SET credits_5s = 4, updated_at = now()
     WHERE id = 'veo-3.1-lite-kie' AND provider = 'crun' AND provider_endpoint = 'crun:google/veo3-1-lite-t2v'
       AND provider_cost_per_unit = 0.0670 AND cost_unit = 'per_generation' AND billing_seconds IS NULL
       AND active AND credits_5s IN (9, 4);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one veo-3.1-lite-kie row on Crun at $0.067, updated %', affected;
    END IF;
END $$;

COMMIT;
