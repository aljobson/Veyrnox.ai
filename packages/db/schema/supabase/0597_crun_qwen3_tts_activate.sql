-- 0597 — Activate Qwen3 TTS (Crun speech), the second speech model beside MiniMax (stacked on 0596; ADR-0012).
--
-- Evidence (2026-11-23, staging project only, owner's CRUN key, 4 credits):
--   job f15d230b-ebd7-4170-9034-68ed7dff119c: Cherry, English, 85 chars, STORED, one -2 debit, 288,044-byte audio/wav in R2.
--   job eacc8d53-828d-4653-849a-32f6955b556e: Cherry, auto, 599 Russian chars, STORED, one -2 debit, 1,993,004-byte WAV (~41 s).
--   The owner listened to both clips and judged the quality good.
-- Cost: $0.0089 a request against 2 credits (0596 row; 2 credits at the pack rate is well above the cost floor).
--
-- NOT established: voices other than Cherry through Crun (34 pinned ids come from Alibaba's qwen3-tts-flash list), a refund
-- after a failed Qwen task on a live gateway (unit-tested through the shared sweep path only), a phone run.
--
-- Order: merge the Worker with 0596 and deploy it, apply 0596, then apply this one through the apply-migrations workflow.
-- Idempotent: re-running changes nothing once both rows are active. Rollback: a forward migration setting active = false and
-- state = 'standby' (the route keeps its parity_record, which the CHECK requires only while active).
BEGIN;

DO $$
DECLARE affected BIGINT;
BEGIN
    -- The route first: an active route needs a parity_record (model_routes_check).
    UPDATE public.model_routes
       SET state = 'active',
           parity_record = 'proofs 2026-11-23 (owner, staging): crun:qwen3-tts/speech-synthesis, Cherry. 85-char English: job f15d230b-ebd7-4170-9034-68ed7dff119c, 288044 B WAV, -2 credits. 599-char Russian with auto language: job eacc8d53-828d-4653-849a-32f6955b556e, 1993004 B WAV, -2 credits. Owner listened: good. Covers voice Cherry only; other voices, live refund and phone not proved',
           updated_at = now()
     WHERE model_id = 'qwen3-tts' AND supplier = 'crun' AND endpoint = 'crun:qwen3-tts/speech-synthesis'
       AND provenance = 'licensed_reseller' AND cost_unit = 'per_generation' AND cost_per_unit = 0.0089
       AND state IN ('standby', 'active');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one Crun route to activate on qwen3-tts, updated %', affected;
    END IF;

    UPDATE public.model_catalog
       SET active = true
     WHERE id = 'qwen3-tts' AND provider = 'crun' AND provider_endpoint = 'crun:qwen3-tts/speech-synthesis'
       AND modality = 'text-to-speech' AND credits_5s = 2 AND provider_cost_per_unit = 0.0089
       AND cost_unit = 'per_generation' AND gated_flag = false;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one qwen3-tts catalog row to activate, updated %', affected;
    END IF;

    SELECT count(*) INTO affected FROM public.model_catalog c
      JOIN public.model_routes r ON r.model_id = c.id
     WHERE c.id = 'qwen3-tts' AND c.active = true AND r.state = 'active' AND r.supplier = 'crun' AND r.priority = 1
       AND r.parity_record IS NOT NULL;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected qwen3-tts active on Crun route 1, found % matching rows', affected;
    END IF;
END $$;

COMMIT;
