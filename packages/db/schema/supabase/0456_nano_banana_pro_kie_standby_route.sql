-- 0456 — Nano Banana Pro: kie becomes the active second route behind GrsAI (ADR-0256 decisions 3 and 5).
--
--   offer                   route 1 (own dispatch)         route 2 (this migration)
--   nano-banana-pro-grsai   grsai, $0.0271, 2 credits      kie market:nano-banana-pro, $0.0900
--
-- Why: the GrsAI account ran out of credits (probe 2026-11-10: HTTP 200, code -1, "insufficient credits"), and the
-- offer had no second route, so every job was refused and refunded. With this row, and the adapter rule that now
-- reports that refusal as provider_payment_required, a job GrsAI refuses on balance hops to kie once (0373).
--
-- Evidence (scripts/probe-image-models.mjs nano-banana-pro-kie, the owner's kie key, 2026-11-10):
--   task 26cba7722184e514a7373068284b82fa: success after 38 s, PNG 2048x2048, 8238810 bytes, from
--   tempfile.aiquickdraw.com (the `.aiquickdraw.com` suffix is already on the kie copy allowlist), image read by
--   Claude Code: a red paper boat on a misty lake, follows the prompt, no watermark or overlay.
-- NOT established: the charge in the kie dashboard (the owner reads it; $0.09 expected, the 0105 row cost).
--
-- Margin: at 2 credits the cap is 2 x $0.01796 = $0.0359 (ADR-0037); kie costs $0.09, so this route breaches the
-- floor and carries a margin waiver. The owner chose this on 2026-11-10 (chat: "kie only, capped"). The exposure is
-- bounded by daily_spend_cap_cents = 500 ($5 of kie spend a day, about 55 hops). fal ($0.15) is left out on purpose.
--
-- Priority 2, provenance licensed_reseller. Nothing else changes: no price, no catalog row, route 1 untouched.
-- Idempotent: ON CONFLICT DO NOTHING. Rollback: UPDATE state = 'disabled' on the row, or DELETE it.

BEGIN;

DO $$
DECLARE n BIGINT;
BEGIN
    -- Route 1 must exist and be the GrsAI one, or there is nothing for a hop to start from.
    SELECT count(*) INTO n FROM public.model_routes r
      JOIN public.model_catalog c ON c.id = r.model_id AND c.active
     WHERE r.model_id = 'nano-banana-pro-grsai' AND r.supplier = 'grsai' AND r.priority = 1 AND r.state = 'active';
    IF n <> 1 THEN
        RAISE EXCEPTION 'Expected one active GrsAI route 1 for nano-banana-pro-grsai, found %', n;
    END IF;
END $$;

INSERT INTO public.model_routes
    (model_id, supplier, endpoint, cost_per_unit, cost_unit, priority, state, provenance,
     parity_record, margin_waiver_note, daily_spend_cap_cents)
VALUES
    ('nano-banana-pro-grsai', 'kie', 'market:nano-banana-pro', 0.0900, 'per_generation', 2, 'active', 'licensed_reseller',
     'probe 2026-11-10 (owner key): market:nano-banana-pro, task 26cba7722184e514a7373068284b82fa success after 38 s, PNG 2048x2048 8238810 bytes from tempfile.aiquickdraw.com, image read by Claude Code: coherent, follows the prompt, no watermark or overlay; kie dashboard charge not yet read',
     'owner decision 2026-11-10 (chat, "kie only, capped"): GrsAI outage standby at 2 credits; cost $0.0900 exceeds the $0.0359 cap (ADR-0037); bounded by the daily spend cap',
     500)
ON CONFLICT (model_id, priority) DO NOTHING;

DO $$
DECLARE n BIGINT;
BEGIN
    SELECT count(*) INTO n FROM public.model_routes
     WHERE model_id = 'nano-banana-pro-grsai' AND supplier = 'kie' AND endpoint = 'market:nano-banana-pro'
       AND priority = 2 AND state = 'active' AND parity_record IS NOT NULL AND margin_waiver_note IS NOT NULL
       AND daily_spend_cap_cents = 500;
    IF n <> 1 THEN
        RAISE EXCEPTION 'Expected the kie standby route for nano-banana-pro-grsai, found %', n;
    END IF;
END $$;

COMMIT;
