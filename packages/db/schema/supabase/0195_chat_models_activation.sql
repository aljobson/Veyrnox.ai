-- Activate the three chat text models staged by 0194 (ADR-0067).
-- Apply only after: the owner has walked /app/chat signed in on staging, the three
-- OpenRouter slugs answered a live streamed request (2026-10-05), and the owner-approved
-- production workflow runs it. CHAT_ENABLED stays "false" in production vars until the
-- owner flips it, so activating the rows alone exposes nothing.
-- The predicate pins price and endpoint: a repriced or edited row fails loudly.
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET active = true, updated_at = now()
     WHERE provider = 'openrouter' AND modality = 'text' AND cost_unit = 'per_generation'
       AND gated_flag = false AND credits_5s = 1
       AND (id, provider_endpoint, provider_cost_per_unit) IN (
            ('chat-llama-4-maverick', 'meta-llama/llama-4-maverick', 0.0024),
            ('chat-ministral-14b',    'mistralai/ministral-14b-2512', 0.0021),
            ('chat-mistral-small',    'mistralai/mistral-small-2603', 0.0020));
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 3 THEN
        RAISE EXCEPTION 'Expected three verified openrouter chat rows, updated %', affected;
    END IF;
END $$;
