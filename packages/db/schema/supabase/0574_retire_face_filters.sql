-- Retire the face filter models (owner decision 2026-11-20: face touch-up is out of
-- product focus). The Face filters screens on web and phone are removed in the same
-- change; this stops the gateway accepting the models from Create, the API or chat.
--
-- 0357 activated four of them (retouch, enhance, makeup, age). Relight (0356) and
-- costume (0445) were staged and never activated; they are set inactive here too so
-- every face filter row ends in the same state. Rows are kept: past jobs and ledger
-- entries still reference them, and nothing is deleted.
--
-- Absolute assignment, so a replay matches the same six rows. Apply only through the
-- owner-approved workflow.
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET active = false, updated_at = now()
     WHERE provider = 'fal'
       AND id IN ('face-retouch', 'face-enhance', 'face-relight', 'face-makeup', 'face-age', 'face-costume');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 6 THEN
        RAISE EXCEPTION 'Expected six face filter rows, updated %', affected;
    END IF;
END $$;
