-- 0547: every paid editor action costs a flat 10 credits (owner decision 2026-11-16).
-- Timeline editing stays free. The three paid actions move from 3 to 10:
--   editor-ai-edit-gemini-3.8-flash  (typed AI edit, ADR-0332)
--   elevenlabs-scribe-v2             (Speech Cut / Best Cut speech analysis)
--   editor-server-render             (phone/server export, flat_credits, ADR-0261 amendment 2)
-- The price lives only in model_catalog. Web and mobile read it from the catalog and quote it
-- before any debit (PRICE_CHANGED consent), so no app code changes. Rollback: set the three
-- values back to 3.
-- 10 credits clears the 50% margin floor ($0.01796/credit, ADR-0014) for a worst-case
-- export of about $0.12 (7 credits) with room to spare.
BEGIN;

DO $$ DECLARE affected BIGINT; BEGIN
 UPDATE public.model_catalog SET credits_5s=10,updated_at=now()
  WHERE id='editor-ai-edit-gemini-3.8-flash' AND provider='openrouter-chat';
 GET DIAGNOSTICS affected = ROW_COUNT;
 IF affected <> 1 THEN RAISE EXCEPTION 'Expected one editor AI edit row, updated %',affected; END IF;

 UPDATE public.model_catalog SET credits_5s=10,updated_at=now()
  WHERE id='elevenlabs-scribe-v2' AND provider='fal';
 GET DIAGNOSTICS affected = ROW_COUNT;
 IF affected <> 1 THEN RAISE EXCEPTION 'Expected one Speech Cut row, updated %',affected; END IF;

 UPDATE public.model_catalog
    SET editor_render_rates=coalesce(editor_render_rates,'{}'::jsonb)||'{"flat_credits":10}'::jsonb,updated_at=now()
  WHERE id='editor-server-render' AND provider='concat-render';
 GET DIAGNOSTICS affected = ROW_COUNT;
 IF affected <> 1 THEN RAISE EXCEPTION 'Expected one editor-server-render row, updated %',affected; END IF;
END $$;

COMMIT;
