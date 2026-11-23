-- 0579 — Kling O1 template swaps on Crun, through a private catalog row (ADR-0351 amendment 21, ADR-0256).
--
-- Why: fal refused swaps on 2026-11-22 with HTTP 403 "User is locked. Reason: Exhausted balance". Crun serves the same
-- model as `kling/o1-r2v` (docs.crun.ai/models/kling/o1-reference-to-video.json, read 2026-11-22).
--
-- What this adds: one server-only catalog row, `kling-o1-swap-crun`, and its one active Crun route. The public offer
-- for Kling O1 reference is not touched: it stays on fal at 47 credits with no route rows, for every non-swap request.
-- Clients keep sending that public id; swap admission resolves it to this row while the row is active.
--
-- Price: 47 credits per 5 s, unchanged. Cost: Crun's page lists 20 Crun credits a second for Kling O1 with a reference
-- video at 720p, so 100 / 206 Crun credits per $1 = $0.4854 per 5 s unit. Whether input seconds are billed in addition
-- is NOT established; read the charge of the first job. The 0366 floor is 47 x 0.01796 = $0.8441: $0.4854 is inside it,
-- but input and output seconds billed at the same rate would be $0.9709, above it, and the route should then be rolled back.
--
-- OWNER EXCEPTION, 2026-11-22: this route goes active with NO prior direct supplier probe. The owner decided that the
-- first proof is a live website test as a customer. The parity record below says so and carries no probe evidence.
--
-- Idempotent. Rollback is a forward migration that sets active = false on this row only; its text is in ADR-0351
-- amendment 21. The rows are kept, so jobs already at Crun still poll, complete or refund.

BEGIN;

INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
    ('kling-o1-swap-crun', 'Kling O1 · Reference', 'crun', 'crun:kling/o1-r2v', 'video-to-video', 47, 0.4854, 'per_second', 5, false, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.model_routes
    (model_id, supplier, endpoint, cost_per_unit, cost_unit, billing_seconds, priority, state, provenance, parity_record)
SELECT 'kling-o1-swap-crun', 'crun', 'crun:kling/o1-r2v', 0.4854, 'per_second', 5, 1, 'active', 'licensed_reseller',
       'OWNER EXCEPTION 2026-11-22: no prior direct probe; the first proof is a live website test as a customer. Contract read from docs.crun.ai/models/kling/o1-reference-to-video.json on 2026-11-22; cost from the Crun price page (20 credits/s at 720p, 206 credits per $1); actual charge unconfirmed until the first job.'
 WHERE NOT EXISTS (SELECT 1 FROM public.model_routes r WHERE r.model_id = 'kling-o1-swap-crun');

DO $$
DECLARE n BIGINT;
BEGIN
    SELECT count(*) INTO n FROM public.model_catalog
     WHERE id = 'kling-o1-swap-crun' AND provider = 'crun' AND provider_endpoint = 'crun:kling/o1-r2v'
       AND modality = 'video-to-video' AND credits_5s = 47 AND provider_cost_per_unit = 0.4854
       AND cost_unit = 'per_second' AND billing_seconds = 5 AND gated_flag = false;
    IF n <> 1 THEN
        RAISE EXCEPTION 'Expected one private Kling O1 swap row at 47 credits on Crun, found %', n;
    END IF;

    SELECT count(*) INTO n FROM public.model_routes
     WHERE model_id = 'kling-o1-swap-crun' AND supplier = 'crun' AND endpoint = 'crun:kling/o1-r2v'
       AND priority = 1 AND state = 'active' AND provenance = 'licensed_reseller' AND cost_per_unit = 0.4854
       AND parity_record LIKE 'OWNER EXCEPTION 2026-11-22:%';
    IF n <> 1 OR (SELECT count(*) FROM public.model_routes WHERE model_id = 'kling-o1-swap-crun') <> 1 THEN
        RAISE EXCEPTION 'Expected exactly one active Crun route with the owner-exception record on the private row';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.model_catalog
                    WHERE provider = 'fal' AND credits_5s = 47
                      AND provider_endpoint = 'fal-ai/kling-video/o1/video-to-video/reference') THEN
        RAISE EXCEPTION 'The public Kling O1 offer must stay on fal at 47 credits';
    END IF;
END $$;

COMMIT;
