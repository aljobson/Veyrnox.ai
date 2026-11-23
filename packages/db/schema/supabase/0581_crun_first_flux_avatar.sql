-- 0581 — FLUX.2 Pro and Kling Avatar v2: Crun first, fal second; prices do not change (ADR-0256 amendment 2026-11-22).
--
-- Evidence (the owner's paid proofs, 2026-11-22, one sample each, run-crun-proofs.mjs, results.json):
--   flux-2-pro: task 60502ccf-d8a8-4000-925b-383d5e054994, success in 18 s, 5 Crun credits, 1:1 PNG 1008x1008.
--   kling/avatar std: task aae0a92d-2364-49d4-8beb-441ac51da5ba, success in 144 s, 32.5 credits for 5.000 s of audio.
--   Crun's estimate for that task was 65; the task record says 32.5, which is Crun's public 720p rate of 6.5 a second x 5 s.
--
-- Cost at the owner's top-up rate of 206 Crun credits per $1, against the floor of credits x $0.01796:
--   flux-2-pro       5 / 206 = $0.0243 <= 2 x 0.01796 = $0.0359
--   kling-avatar-v2  worst case at the 10 s audio cap, 65 / 206 = $0.3155 <= 32 x 0.01796 = $0.5747
-- Avatar's recorded per-generation cost is that 10 s worst case.
--
-- NOT established: Crun fetching our signed R2 links (the proofs used Crun's upload host), any Flux shape but 1:1, a 10 s
-- Avatar charge, and which model made an output (that rests on Crun's model id).
-- A job with uploaded media never hops (lib/supplierRoutesFailover.js), so fal is an automatic fallback for Flux only.
--
-- Deploy the Worker that has crun:flux-2-pro and crun:kling/avatar BEFORE applying this: a first route the Worker cannot
-- dispatch answers 501. Idempotent. Rollback: a forward migration with model_route_reorder (fal first).

BEGIN;

INSERT INTO public.model_routes
    (model_id, supplier, endpoint, cost_per_unit, cost_unit, billing_seconds, priority, state, provenance)
SELECT r.model_id, 'crun', r.endpoint, r.cost, 'per_generation', NULL,
       (SELECT COALESCE(max(x.priority), 0) + 1 FROM public.model_routes x WHERE x.model_id = r.model_id),
       'standby', 'licensed_reseller'
  FROM (VALUES ('flux-2-pro', 'crun:flux-2-pro', 0.0243::numeric),
               ('kling-avatar-v2', 'crun:kling/avatar', 0.3155::numeric)) AS r(model_id, endpoint, cost)
ON CONFLICT (model_id, supplier, endpoint) DO NOTHING;

DO $$
DECLARE affected BIGINT; r record; res jsonb;
BEGIN
    FOR r IN SELECT * FROM (VALUES
        ('flux-2-pro', 'crun:flux-2-pro', 'fal-ai/flux-2-pro', 0.0243::numeric, 2,
         'proof 2026-11-22 (owner): flux-2-pro, 1K, 1:1, PNG, task 60502ccf-d8a8-4000-925b-383d5e054994 success in 18 s, 5 credits, 1008x1008; other shapes not run; model identity rests on Crun id; one sample'),
        ('kling-avatar-v2', 'crun:kling/avatar', 'fal-ai/kling-video/ai-avatar/v2/standard', 0.3155::numeric, 32,
         'proof 2026-11-22 (owner): kling/avatar std, 5.000 s audio, task aae0a92d-2364-49d4-8beb-441ac51da5ba success in 144 s, 32.5 credits (estimate said 65), 960x960; cost recorded at the 10 s cap (65 credits, public rate 6.5 a second); a 10 s run and signed R2 sources not proved; one sample')
    ) AS v(model_id, crun_endpoint, fal_endpoint, cost, credits, parity)
    LOOP
        UPDATE public.model_routes
           SET parity_record = r.parity, state = 'active', updated_at = now()
         WHERE model_id = r.model_id AND supplier = 'crun' AND endpoint = r.crun_endpoint
           AND provenance = 'licensed_reseller' AND cost_unit = 'per_generation' AND billing_seconds IS NULL
           AND cost_per_unit = r.cost AND state IN ('standby', 'active');
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 1 THEN
            RAISE EXCEPTION 'Expected one Crun route to prove on %, updated %', r.model_id, affected;
        END IF;

        IF EXISTS (SELECT 1 FROM public.model_catalog WHERE id = r.model_id AND provider <> 'crun') THEN
            SELECT public.model_route_reorder(
                r.model_id,
                (SELECT array_agg(id ORDER BY CASE supplier WHEN 'crun' THEN 0 ELSE 1 END, priority)
                   FROM public.model_routes WHERE model_id = r.model_id AND state = 'active'),
                'Crun first, fal second, proofs 2026-11-22 (0581)'
            ) INTO res;
            IF NOT COALESCE((res->>'ok')::boolean, false) THEN
                RAISE EXCEPTION 'Could not put Crun first for %: %', r.model_id, res;
            END IF;
        END IF;

        SELECT count(*) INTO affected FROM public.model_catalog
         WHERE id = r.model_id AND provider = 'crun' AND provider_endpoint = r.crun_endpoint
           AND provider_cost_per_unit = r.cost AND cost_unit = 'per_generation' AND billing_seconds IS NULL
           AND credits_5s = r.credits AND round(r.cost * 100000) <= r.credits * 1796;
        IF affected <> 1 THEN
            RAISE EXCEPTION 'Expected % served by Crun at % credits inside the floor, found % rows', r.model_id, r.credits, affected;
        END IF;

        SELECT count(*) INTO affected FROM public.model_routes
         WHERE model_id = r.model_id AND state = 'active'
           AND ((priority = 1 AND supplier = 'crun' AND endpoint = r.crun_endpoint)
             OR (priority = 2 AND supplier = 'fal' AND endpoint = r.fal_endpoint
                 AND round(cost_per_unit * 100000) <= r.credits * 1796));
        IF affected <> 2 THEN
            RAISE EXCEPTION 'Expected Crun first and fal second on %, found % matching routes', r.model_id, affected;
        END IF;
    END LOOP;
END $$;

COMMIT;
