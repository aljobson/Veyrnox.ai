-- 0379 — The Crun route of Veo 3.1 Lite becomes `active`, as the offer's second route (ADR-0256).
--
-- The owner asked on 2026-10-24 to bring Crun live. This route is the only Crun route with a parity record
-- (0377: two paid probes, an 8 s 1280x720 h264 clip with audio, no watermark seen, charge 15 credits
-- confirmed by the owner). It is `licensed_reseller` (0375), its recorded cost ($0.0670) is within the offer's
-- floor (9 credits x 0.01796 = $0.1616), and CRUN_ENABLED is on in production (PR 1600) with the key set.
--
-- Effect, and what it is not: the offer `veo-3.1-lite-kie` keeps kie as its priority-1 route. Crun is its
-- priority-2 route, so job_route_failover may hop to it when kie provably refuses a job (401, 402, 403, 429),
-- and the offer gains a refund-free retry for those refusals. No job goes to Crun first: making Crun the
-- dispatch route is a separate owner step through model_route_reorder, and the customer's price does not change.
-- The other three Crun routes have no parity record and stay `standby`.
--
-- Idempotent: accepts `standby` or `active`; asserts exactly one row and refuses a route without a parity record.
-- Rollback: a forward migration setting `standby` again.

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_routes
       SET state = 'active', updated_at = now()
     WHERE supplier = 'crun' AND endpoint = 'crun:google/veo3-1-lite-t2v'
       AND model_id = 'veo-3.1-lite-kie' AND provenance = 'licensed_reseller'
       AND parity_record IS NOT NULL AND state IN ('standby', 'active');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one proven Crun Veo Lite route, updated %', affected;
    END IF;
END $$;
