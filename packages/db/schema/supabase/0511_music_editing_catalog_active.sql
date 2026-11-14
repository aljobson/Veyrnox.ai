-- 0511: switch on the seven Music editing features (owner, 2026-11-14).
--
-- Each catalog row was staged inactive by its migration (0479-0489) until a billed
-- staging run proved the provider endpoint, the payload, the output handling, the
-- debit and the refund path. All seven passed on staging on 2026-11-13/14 after the
-- fixes in 0501 (source URL regex), 0502 (Cover bitrate), 0503 (stem job state) and
-- the Stems archive type: Extend, Add section, Replace section, Cover, Target stems,
-- Stems and Track add. Prices are unchanged from the staging rows that were run.
--
-- The Worker flags in MUSIC_RUNTIME_FLAGS are switched on in the same change. A
-- feature needs both: with the flag on and its row inactive, the quote answers
-- MODEL_UNAVAILABLE and nothing is charged.
--
-- Rollback: a forward migration setting active = false on the same rows, and the
-- flags back to false. Replay-safe: the UPDATE assigns an absolute value and
-- matches the eight rows whatever their current state.

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET active = true, updated_at = now()
     WHERE id IN ('ace-step-extend', 'ace-step-add-section', 'ace-step-replace-section',
                  'stable-audio-3-cover', 'sam-audio-target-stem', 'mureka-stems-v3',
                  'mureka-audio-upload', 'mureka-track-add-v8');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 8 THEN
        RAISE EXCEPTION 'Expected eight Music editing catalog rows, updated %', affected;
    END IF;
END $$;
