-- 0611 — Unlist the two ACE music offers that failed the owner's paid production customer QA.
--
-- Evidence (veyrnox.ai, 2026-11-24/25 Europe/London):
--   * ace-step-1.5 job e15e93f1-8f83-4796-9120-793131cd01c1 used the MIDNIGHT SOUL
--     template. Admission succeeded after the request-contract fix, but the job was still
--     running without an asset after more than 30 minutes against a 3–4 minute UI estimate.
--   * ace-step job 8a5bcd3c-aeea-4947-84b7-e468c01dc932 used the same template inputs after
--     the customer swapped models. Admission succeeded, but it also remained running without
--     an asset after more than 30 minutes.
--
-- This migration only prevents new quotes and submissions. It deliberately leaves provider
-- routes, jobs, attempts, assets, holds and ledger rows untouched so both in-flight jobs can
-- finish or be refunded by the existing settlement path. Suno Sound Effects and Qwen3 TTS
-- passed the same live customer QA and remain listed unchanged.

BEGIN;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET active = false, updated_at = now()
     WHERE (id = 'ace-step' AND provider = 'fal'
            AND provider_endpoint = 'fal-ai/ace-step' AND modality = 'text-to-audio')
        OR (id = 'ace-step-1.5' AND provider = 'fal'
            AND provider_endpoint = 'fal-ai/ace-step-1.5' AND modality = 'text-to-audio');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 2 THEN
        RAISE EXCEPTION 'Expected two stalled ACE audio offers to retire, updated %', affected;
    END IF;

    SELECT count(*) INTO affected
      FROM public.model_catalog
     WHERE id IN ('ace-step', 'ace-step-1.5') AND NOT active;
    IF affected <> 2 THEN
        RAISE EXCEPTION 'Expected exactly two inactive ACE audio offers, found %', affected;
    END IF;
END $$;

COMMIT;
