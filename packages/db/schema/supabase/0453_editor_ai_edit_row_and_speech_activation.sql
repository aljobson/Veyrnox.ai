-- ADR-0332. Two catalog changes, both asserted to the row.
--
-- 1. A dedicated row for the phone editor's typed AI edit: the same model as chat-gemini-3.8-flash
--    (google/gemini-3.8-flash), its own id, priced at 3 Credits per request. The shared chat row is
--    NOT repriced, so ordinary chat stays at 1 Credit. The id starts "editor-", which Chat refuses
--    (lib/chat.js editorOnlyModel; /api/v1/chat/models, thread create and the turn).
--    Cost: the same worst case as the Gemini row (9,000 in x $0.75/M + 4,096 out x $3.75/M = $0.0222).
--    The ADR-0014 floor is ceil(0.0222 / 0.01796) = 2, so 3 clears it.
-- 2. Speech Cut: activate elevenlabs-scribe-v2 at 3 Credits per clip up to 60 s (the owner's price,
--    replacing the 2-Credit proposal in 0451). Cost $0.008 -> floor 1.
-- The switches ride EDITOR_RUNTIME_FLAGS (aiEdit, aiEditModel, speechCut) and are set in a later,
-- separate change; this migration alone turns nothing on for users.
INSERT INTO public.model_catalog
    (id, name, provider, provider_endpoint, modality, credits_5s,
     provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active,
     chat_max_reply_tokens, chat_reasoning_effort)
VALUES
    ('editor-ai-edit-gemini-3.8-flash', 'Editor AI edit', 'openrouter-chat', 'google/gemini-3.8-flash',
     'text', 3, 0.0222, 'per_generation', NULL, false, true, 4096, 'low')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE n integer;
BEGIN
    IF (SELECT count(*) FROM public.model_catalog
         WHERE id = 'editor-ai-edit-gemini-3.8-flash' AND provider = 'openrouter-chat'
           AND provider_endpoint = 'google/gemini-3.8-flash' AND modality = 'text'
           AND credits_5s = 3 AND active = true AND gated_flag = false) <> 1 THEN
        RAISE EXCEPTION 'the editor AI edit row must exist exactly once, active, at 3 credits';
    END IF;

    UPDATE public.model_catalog
       SET active = true, credits_5s = 3, updated_at = now()
     WHERE id = 'elevenlabs-scribe-v2' AND provider = 'fal'
       AND provider_endpoint = 'fal-ai/elevenlabs/speech-to-text/scribe-v2';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN
        RAISE EXCEPTION 'speech cut activation must update exactly one row, got %', n;
    END IF;
END $$;
