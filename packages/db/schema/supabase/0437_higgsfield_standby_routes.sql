-- 0437 — Higgsfield third Kling routes (ADR-0256 amendment 2026-11-03).
-- Host fix round 1 reserves 0436 for PR #1878 (0436_crun_kling_26_first.sql),
-- not yet present in this checkout. Renumbered from 0436 to provisional 0437;
-- the host must confirm the final number against main/open PRs before merge.
--
-- Sound off, single shot, per_second over a 5 s unit; 10 s costs twice.
-- Promo rates ending 2026-11-10: 5 x $0.056 = 0.2800, 5 x $0.035 = 0.1750.
-- List rates are 0.5600 and 0.3500. Each exceeds its offer's margin floor:
-- a failover hop at list requires a recorded margin waiver and daily spend cap
-- on the owner's sign-off (ADR-0256 decision 3). Resilience is not priced on a discount.
-- ToS s11.5 written permission and paid parity evidence are outstanding.
-- Ships standby, unverified, admission closed. No activation, reorder or offer price change.
-- HIGGSFIELD_ENABLED is absent: absent means off. Set the Worker var to "true" only
-- when the owner turns it on, keeping production within the 66-var budget.
-- Idempotent: existing rows are preserved, exact assertions reject conflicting seeds.

BEGIN;
SET LOCAL search_path = '';

ALTER TABLE public.model_routes DROP CONSTRAINT IF EXISTS model_routes_supplier_check;
ALTER TABLE public.model_routes ADD CONSTRAINT model_routes_supplier_check
    CHECK (supplier IN ('fal', 'kie', 'grsai', 'byteplus', 'openrouter', 'crun', 'higgsfield'));

INSERT INTO public.model_routes
    (model_id, supplier, endpoint, cost_per_unit, cost_unit, billing_seconds, priority, state, provenance)
SELECT v.model_id, 'higgsfield', v.endpoint, v.cost, 'per_second', 5, 3, 'standby', 'unverified'
  FROM (VALUES
        ('kling-3.0-i2v-kie', 'higgsfield:kling-video/v3.0/pro/image-to-video', 0.2800::numeric),
        ('kling-2.6-pro-kie', 'higgsfield:kling-video/v2.6/pro/text-to-video', 0.1750::numeric)
       ) AS v(model_id, endpoint, cost)
  JOIN public.model_catalog c ON c.id = v.model_id
 -- Skip an offer that already has this route or a priority-3 route. model_routes_max_three (0374) is a BEFORE
 -- INSERT trigger and raises before ON CONFLICT can act once an offer has three routes, so a replay must not
 -- attempt the insert. A priority-3 slot taken by another supplier is left alone and the assertion below rejects it.
 WHERE NOT EXISTS (SELECT 1 FROM public.model_routes r
                    WHERE r.model_id = v.model_id
                      AND (r.priority = 3 OR (r.supplier = 'higgsfield' AND r.endpoint = v.endpoint)))
ON CONFLICT (model_id, priority) DO NOTHING;

-- Same column set and ON CONFLICT guard as 0434, deliberately closed.
INSERT INTO public.provider_spend_provider_policy (provider, admission_open, hour_microusd, day_microusd)
VALUES ('higgsfield', false, 10000000, 25000000)
ON CONFLICT (provider) DO NOTHING;

DO $$
DECLARE n BIGINT;
BEGIN
    SELECT count(*) INTO n FROM public.model_routes
     WHERE supplier = 'higgsfield' AND priority = 3 AND state = 'standby' AND provenance = 'unverified'
       AND cost_unit = 'per_second' AND billing_seconds = 5 AND parity_record IS NULL
       AND ((model_id = 'kling-3.0-i2v-kie' AND endpoint = 'higgsfield:kling-video/v3.0/pro/image-to-video' AND cost_per_unit = 0.2800)
         OR (model_id = 'kling-2.6-pro-kie' AND endpoint = 'higgsfield:kling-video/v2.6/pro/text-to-video' AND cost_per_unit = 0.1750));
    IF n <> 2 THEN
        RAISE EXCEPTION 'Expected two Higgsfield Kling standby routes, found %', n;
    END IF;
    SELECT count(*) INTO n FROM public.provider_spend_provider_policy
     WHERE provider = 'higgsfield' AND admission_open = false AND hour_microusd = 10000000 AND day_microusd = 25000000;
    IF n <> 1 THEN
        RAISE EXCEPTION 'Expected one closed Higgsfield spend policy, found %', n;
    END IF;
END $$;

-- No new function or table: existing RLS and service-role grants remain in force.
COMMIT;
