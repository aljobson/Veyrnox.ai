-- 0375 — Crun reclassified from `unverified` to `licensed_reseller` (ADR-0256 decision 1).
--
-- The owner confirmed on 2026-10-24 that Crun's written answers on resale, upstream supply,
-- credit expiry and refunds are in hand. This session did not read them; the owner's
-- confirmation is the record. The four Crun routes (0369) stay `standby`: they become `active`
-- only after a paid parity probe passes, a parity record is written and the owner approves.
-- Reclassifying only lets such a route sit anywhere in an order instead of last.
--
-- Idempotent: the UPDATE accepts the old or the new value. Asserts exactly four rows.
-- Rollback: a forward migration setting `unverified` again.

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_routes SET provenance = 'licensed_reseller', updated_at = now()
     WHERE supplier = 'crun' AND state = 'standby' AND provenance IN ('unverified', 'licensed_reseller');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 4 THEN
        RAISE EXCEPTION 'Expected four Crun standby routes, updated %', affected;
    END IF;
END $$;
