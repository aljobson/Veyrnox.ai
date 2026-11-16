-- Price and switch on ace-step-loop, the beat editor's "Generate a part" model
-- (ADR-0347 amendment 1, D6). Owner decision 2026-11-16: 5 Credits a part, so one
-- Generate (two Alternates) costs 10. The STAGING probe (request
-- 01a1e610-b245-7621-9afc-86f6f974dcac, one 60 s loop) billed more than the $0.036
-- that 0549's copied price of 3 assumed. The editor surface stays off until
-- MUSIC_RUNTIME_FLAGS.beatAi is set.
DO $$
DECLARE affected INTEGER;
BEGIN
    UPDATE public.model_catalog
       SET credits_5s = 5, active = true, updated_at = now()
     WHERE id = 'ace-step-loop';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one ace-step-loop row, updated %', affected;
    END IF;
END $$;
