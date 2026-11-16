-- 0544 — Nano Banana Pro Edit (GrsAI, 2 credits): back on after the GrsAI top-up.
--
-- 0512 switched `nano-banana-pro-edit-grsai` off because the GrsAI account had no credit (every job was refused at
-- submit and refunded). The owner funded the account on 2026-11-16 and asked for it to be turned back on.
-- The name stays "Nano Banana Pro Edit Lite (GrsAI, no seed)" so it is told apart from the fal row.
--
-- This row serves 37 photo templates (RED LIGHT FILTER, CCD NIGHT SHOT FILTER, ...) and the creative features that
-- edit a photo. They reappear in the mobile app as soon as /api/catalog lists the row again.
-- NOT established: a paid staging edit after the top-up (0512 asked for one first); run one after this applies.
-- Idempotent: absolute value, exactly one row asserted on every replay. Rollback: set active = false (see 0512).
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET active = true, updated_at = now()
     WHERE id = 'nano-banana-pro-edit-grsai' AND provider = 'grsai'
       AND provider_endpoint = 'grsai:nano-banana-pro-edit'
       AND modality = 'image-to-image' AND credits_5s = 2;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one GrsAI Nano Banana Pro Edit row, updated %', affected;
    END IF;
END $$;
