-- Video agent, STAGING ONLY (project yrqzwqywxfesmbvhzjgj, "veyrnox.ai staging"). Never run this on production.
-- 1. Activates the inactive `video-agent` catalog row (exactly one row, or it aborts).
-- 2. Grants the test account 330 credits (two runs at 165: one that succeeds, one forced to fail and be refunded),
--    through ledger_grant with a reason naming the human who decided (CLAUDE.md "Money & billing", ADR-0022 style).
-- The whole block is one transaction: any problem leaves staging exactly as it was.
-- Change the email below if you sign in to staging with a different account.
DO $$
DECLARE
    n   integer;
    uid uuid;
    r   jsonb;
BEGIN
    UPDATE public.model_catalog SET active = true WHERE id = 'video-agent' AND active = false;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN
        RAISE EXCEPTION 'expected to activate exactly 1 video-agent row, got % (already active, or missing)', n;
    END IF;

    SELECT id INTO uid FROM public.users WHERE email = 'support@veyrnox.com';
    IF uid IS NULL THEN
        RAISE EXCEPTION 'test account not found on this database';
    END IF;

    r := public.ledger_grant(uid, 330, 'grant:manual Al Jobson video agent staging test (ADR-0074)');
    IF (r ->> 'ok') IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'ledger_grant refused: %', r;
    END IF;
END
$$;
