-- Reconciles migration: 0222_free_allowance_starting_values
-- Forward repair for 0222's old-zero predicates. Its intended values were
-- already present in staging without a receipt, so replaying 0222 refuses them.
-- Retain the provider, price, cost, modality and active checks and exact positive
-- row counts. Absolute assignments permit zero, already-correct and replay state.
-- This records its own receipt; it never fabricates or edits an older one.
-- Production uses the owner-reviewed main workflow. No flag is changed.
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET free_allowance_per_day = 3, free_allowance_daily_budget = 100, updated_at = now()
     WHERE id = 'chat-mistral-small' AND provider = 'openrouter-chat' AND modality = 'text' AND cost_unit = 'per_generation'
       AND active = true AND credits_5s = 1 AND provider_cost_per_unit = 0.0020;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one chat-mistral-small row, updated %', affected;
    END IF;

    UPDATE public.model_catalog
       SET free_allowance_per_day = 3, free_allowance_daily_budget = 40, updated_at = now()
     WHERE id = 'nano-banana-kie' AND provider = 'kie' AND modality = 'text-to-image' AND cost_unit = 'per_generation'
       AND active = true AND credits_5s = 2 AND provider_cost_per_unit = 0.0200;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one nano-banana-kie row, updated %', affected;
    END IF;
END $$;
