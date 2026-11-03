-- 0438 — kie route costs for the two Kling offers follow the catalog (0433 follow-up, ADR-0256).
--
-- 0433 raised the catalog cost of `kling-2.6-pro-kie` ($0.2750 -> $0.3150) and `kling-3.0-i2v-kie` ($0.4500 -> $0.5050)
-- for KIE's 2026-11-04 increase, but the kie ROUTE rows in model_routes were copied from the catalog by 0367 and
-- still carry the old costs (read on production 2026-11-03). Failover cost checks and attempt cost snapshots read the
-- route, so a hop onto kie would record $0.2750 where $0.3150 is billed.
--
-- Updates only cost_per_unit on those two kie routes. No state, priority, provenance, catalog, price or credit change.
-- Margin floor at the unchanged credits: 0.3150 <= 18 x 0.01796 = $0.3233 and 0.5050 <= 29 x 0.01796 = $0.5208.
-- Each UPDATE names the row's exact identity, accepts the old or new value (replay-safe) and asserts one row.
-- Rollback: a forward migration setting the old values back.

BEGIN;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_routes
       SET cost_per_unit = 0.3150, updated_at = now()
     WHERE model_id = 'kling-2.6-pro-kie' AND supplier = 'kie' AND endpoint = 'market:kling-2.6/text-to-video'
       AND cost_unit = 'per_second' AND billing_seconds = 5 AND cost_per_unit IN (0.2750, 0.3150);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one kie Kling 2.6 route at $0.275 or $0.315, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_routes
       SET cost_per_unit = 0.5050, updated_at = now()
     WHERE model_id = 'kling-3.0-i2v-kie' AND supplier = 'kie' AND endpoint = 'market:kling-3.0/video'
       AND cost_unit = 'per_second' AND billing_seconds = 5 AND cost_per_unit IN (0.4500, 0.5050);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one kie Kling 3.0 route at $0.45 or $0.505, updated %', affected;
    END IF;
END $$;

COMMIT;
