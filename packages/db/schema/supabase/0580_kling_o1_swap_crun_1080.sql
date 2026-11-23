-- 0580 — Kling O1 template swaps at 1080p on Crun, through a second private catalog row (ADR-0351 amendment 22, ADR-0256).
--
-- What this adds: one server-only catalog row, `kling-o1-swap-crun-1080`, and its one Crun route. Applying it changes nothing
-- for customers: the row is dispatched only while the `templateSwapCrun1080` key in APP_RUNTIME_FLAGS is exactly true.
--
-- Price: 47 credits per 5 s, unchanged. Cost: Crun recorded 135 credits for 1080p task 5c03181d-5aa3-49f2-b42a-2c2b23829e14
-- (2026-11-22), and 206 Crun credits = $1, so 135 / 206 = $0.6553 per 5 s unit. The 0366 floor is 47 x 0.01796 = $0.8441.
--
-- Idempotent. Rollback: remove the runtime key. The rows are kept, so jobs already at Crun still poll, complete or refund.

BEGIN;

INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('kling-o1-swap-crun-1080', 'Kling O1 · Reference', 'crun', 'crun:kling/o1-r2v-1080', 'video-to-video', 47, 0.6553, 'per_second', 5, false, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.model_routes
    (model_id, supplier, endpoint, cost_per_unit, cost_unit, billing_seconds, priority, state, provenance, parity_record)
SELECT 'kling-o1-swap-crun-1080', 'crun', 'crun:kling/o1-r2v-1080', 0.6553, 'per_second', 5, 1, 'active', 'licensed_reseller',
       'Direct paid probe 2026-11-22: Crun task 5c03181d-5aa3-49f2-b42a-2c2b23829e14, kling/o1-r2v at 1080p, one person, three reference images, 1080x1920 output, 135 credits recorded by TaskInfo.'
 WHERE NOT EXISTS (SELECT 1 FROM public.model_routes r WHERE r.model_id = 'kling-o1-swap-crun-1080');

DO $$
DECLARE n BIGINT;
BEGIN
    SELECT count(*) INTO n FROM public.model_catalog
     WHERE id = 'kling-o1-swap-crun-1080' AND provider = 'crun' AND provider_endpoint = 'crun:kling/o1-r2v-1080'
       AND modality = 'video-to-video' AND credits_5s = 47 AND provider_cost_per_unit = 0.6553
       AND cost_unit = 'per_second' AND billing_seconds = 5 AND gated_flag = false;
    IF n <> 1 THEN
        RAISE EXCEPTION 'Expected one private 1080p Kling O1 swap row at 47 credits on Crun, found %', n;
    END IF;

    SELECT count(*) INTO n FROM public.model_routes
     WHERE model_id = 'kling-o1-swap-crun-1080' AND supplier = 'crun' AND endpoint = 'crun:kling/o1-r2v-1080'
       AND priority = 1 AND state = 'active' AND provenance = 'licensed_reseller' AND cost_per_unit = 0.6553;
    IF n <> 1 OR (SELECT count(*) FROM public.model_routes WHERE model_id = 'kling-o1-swap-crun-1080') <> 1 THEN
        RAISE EXCEPTION 'Expected exactly one active Crun route on the private 1080p row';
    END IF;
END $$;

COMMIT;
