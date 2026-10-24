-- 0377 — Parity record for the Crun route of Veo 3.1 Lite (ADR-0256 decision 2).
--
-- Evidence, from two paid probes the owner ran on 2026-10-24 with scripts/probe-crun.mjs veo-lite
-- (model google/veo3-1-lite-t2v, prompt "a red paper boat drifting on calm water at dawn, soft light"):
--   task 415943ad-66b2-4de7-88ef-61df9e8fc7bd: success after 55 s, 2,084,795 bytes video/mp4
--   task 8744e6dc-db4d-4a72-b945-34a43e8b7f37: success after 60 s, 2,134,714 bytes video/mp4
--   second clip measured with ffprobe: 8.0 s, 1280x720, h264, with an audio stream; three frames read
--   by Claude Code: a coherent shot that follows the prompt, no watermark or overlay visible.
-- The capability pins (lib/additionalModelCapabilities.js) match the kie route it would back up: text in,
-- 720p, one 8 s unit, no media in. Output host tempfile.mediaoss.bar is on the R2 copy allowlist.
--
-- Charge: the owner read crun.ai/logs and confirmed 15 credits per clip, as expected (2026-10-24), about
-- $0.067 each at the top tier.
-- NOT established: that the model behind Crun's id is the one named. A clip cannot prove its model; that
-- rests on Crun's model id and its written answers. This migration records the evidence only. It does not
-- set the route active: state stays `standby`, so chooseRoute still never picks it.
--
-- Idempotent: a route with no record, or this record, is updated to this record. Asserts exactly one row.
-- Rollback: a forward migration setting parity_record back to NULL.

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_routes
       SET parity_record = 'probe 2026-10-24 (owner): google/veo3-1-lite-t2v, 8 s 720p h264 with audio, no watermark seen, tasks 415943ad-66b2-4de7-88ef-61df9e8fc7bd and 8744e6dc-db4d-4a72-b945-34a43e8b7f37; charge 15 credits per clip confirmed by the owner; model identity rests on Crun id and its written answers',
           updated_at = now()
     WHERE supplier = 'crun' AND endpoint = 'crun:google/veo3-1-lite-t2v' AND state = 'standby'
       AND (parity_record IS NULL OR parity_record LIKE 'probe 2026-10-24 (owner): google/veo3-1-lite-t2v%');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one Crun Veo Lite route without a parity record, updated %', affected;
    END IF;
END $$;
