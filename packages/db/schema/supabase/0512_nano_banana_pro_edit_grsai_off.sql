-- 0512 — Nano Banana Pro Edit (GrsAI, 2 credits): off until the GrsAI account is topped up, and a distinct name.
--
--   id                           provider  credits  before   after
--   nano-banana-pro-edit         fal       9        active   active (unchanged)
--   nano-banana-pro-edit-grsai   grsai     2        active   INACTIVE, renamed
--
-- Why it fails (QA F01, iOS build 50, production, 2026-11-14 ~10:35 UTC): the GrsAI account has no credit. The
-- 2026-11-10 paid probe got HTTP 200, code -1, "insufficient credits" (0456). Text-to-image survives that because
-- 0456 gave it a kie route and the adapter reports the refusal as provider_payment_required, so it hops. This edit
-- offer has no second route, and an edit with a source image never hops anyway (generationProviderSubmit.js:
-- canHop is false with source keys or assets), so every job is refused at submit and refunded: "The model would not
-- take this job". The fal row is the same model and stays on.
--
-- Name: the public catalog strips "(GrsAI, no seed)" (lib/publicCatalog.js WHOLESALE_NAME), so both rows showed as
-- "Nano Banana Pro Edit" on Create > Tools and in Film Studio. "Lite" is outside the parentheses and survives.
--
-- Blast radius: this row also serves 37 photo templates (imageTemplatesSyntx100.js and imageTemplates.js), the web
-- and mobile creative features (avatar, hairstyle, product image, ad clone, ...) and the Oddlings reference path.
-- All of them are refused at submit today for the same reason. With the row off they show as unavailable
-- (imageTemplateModelAvailable finds no catalog model) instead of taking credits and refunding them.
-- If GrsAI is topped up first, this migration is not needed for the fix: keep only the rename.
--
-- To switch it back on: top up GrsAI, run one paid staging edit, then a migration setting active = true.
-- Idempotent: absolute values, exactly one row asserted on every replay.

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET active = false,
           name = 'Nano Banana Pro Edit Lite (GrsAI, no seed)',
           updated_at = now()
     WHERE id = 'nano-banana-pro-edit-grsai' AND provider = 'grsai'
       AND provider_endpoint = 'grsai:nano-banana-pro-edit'
       AND modality = 'image-to-image' AND credits_5s = 2;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one GrsAI Nano Banana Pro Edit row, updated %', affected;
    END IF;
END $$;
