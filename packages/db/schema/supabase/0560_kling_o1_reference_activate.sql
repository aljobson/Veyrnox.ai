-- 0560 — Kling O1 · Reference goes live in the catalog (ADR-0301, ADR-0351).
--
-- DRAFT: do not apply until the owner has the ADR-0301 staging proof (billing per output second read from the fal
-- invoice, `source_too_short` before any debit, and one debit -> failed job -> refund on a forced provider failure).
-- 0405 inserted the row inactive and said activation is a later migration. This is it. Price is not changed: 47 credits
-- per 5 s stays as set by 0405 (fal $0.84 per 5 s unit, floor ceil(0.84 / 0.01796) = 47).
--
-- Safe before the swap switch: with the `templateSwap` runtime key absent the swap gate refuses every request, so
-- activating the row exposes nothing by itself. It does make the model addressable by id for the existing
-- multi-reference path, which is why it waits for the staging proof.
-- Idempotent. Rollback: a forward migration setting active = false for the same id.

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET active = true
     WHERE id = 'kling-o1-reference' AND provider = 'fal';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one kling-o1-reference/fal row, updated %', affected;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.model_catalog
                    WHERE id = 'kling-o1-reference' AND provider = 'fal' AND active = true
                      AND credits_5s = 47 AND provider_endpoint = 'fal-ai/kling-video/o1/video-to-video/reference') THEN
        RAISE EXCEPTION 'kling-o1-reference is not active at 47 credits on the O1 reference endpoint';
    END IF;
END $$;
