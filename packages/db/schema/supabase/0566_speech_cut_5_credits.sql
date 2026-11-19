-- 0566: Speech Cut (and the speech analysis behind Best Cut) costs 5 credits, down from 10.
-- Owner request 2026-11-19: 10 looked like too much for one analysis.
--
-- 0547 set every paid editor action to a flat 10. This changes ONLY the speech analysis row;
-- the typed AI edit (editor-ai-edit-gemini-3.8-flash) and the server export
-- (editor-server-render, flat_credits) stay at 10.
-- elevenlabs-scribe-v2 is shared by Speech Cut and Best Cut, so both quote the new price.
--
-- Margin check (ADR-0014, $0.01796 per credit): 5 credits = $0.0898 against a worst-case
-- provider cost of $0.008 for a 60 s clip, so the 50% floor clears with a wide margin
-- (the floor itself is 1 credit). Completed analyses are still reused free for 30 days.
--
-- The price lives only in model_catalog. Web and phone read it from the catalog and quote it
-- before any debit (PRICE_CHANGED consent), so no app code changes. A quote already on screen
-- at the old price gets the usual price_changed consent. Rollback: set credits_5s back to 10.
BEGIN;

DO $$ DECLARE affected BIGINT; BEGIN
 UPDATE public.model_catalog SET credits_5s=5,updated_at=now()
  WHERE id='elevenlabs-scribe-v2' AND provider='fal';
 GET DIAGNOSTICS affected = ROW_COUNT;
 IF affected <> 1 THEN RAISE EXCEPTION 'Expected one Speech Cut row, updated %',affected; END IF;
END $$;

COMMIT;
