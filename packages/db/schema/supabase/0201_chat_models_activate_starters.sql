-- Activate the three starter chat models (ADR-0067): Llama 4 Maverick, Ministral 14B and Mistral Small, at 1 Credit
-- per reply. The owner chose them as the launch set on 2026-10-05; each streamed a real reply through the
-- repository's own adapter that day. Web search +2 and Images +1 are priced on them by 0197 and 0198; none reasons,
-- so none offers Thinking.
-- This replaces the earlier proposal numbered 0195, which sat below migrations already applied to production
-- (apply-migrations stops on a pending file numbered below an applied one).
-- Apply only through the owner-approved workflow. CHAT_ENABLED stays "false" in production vars until the owner
-- flips it. The predicate pins slug, price and gating, so an edited row fails loudly.
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET active = true, updated_at = now()
     WHERE provider = 'openrouter-chat' AND modality = 'text' AND cost_unit = 'per_generation'
       AND gated_flag = false AND credits_5s = 1
       AND (id, provider_endpoint, provider_cost_per_unit) IN (
            ('chat-llama-4-maverick', 'meta-llama/llama-4-maverick', 0.0024),
            ('chat-ministral-14b',    'mistralai/ministral-14b-2512', 0.0021),
            ('chat-mistral-small',    'mistralai/mistral-small-2603', 0.0020));
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 3 THEN
        RAISE EXCEPTION 'Expected three verified starter chat rows, updated %', affected;
    END IF;
END $$;
