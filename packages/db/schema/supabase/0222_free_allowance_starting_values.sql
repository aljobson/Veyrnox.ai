-- Free allowance starting values (ADR-0069, accepted 2026-10-05). 0205 added the allowance columns with every model at 0; this offers two.
-- Nothing is visible until FREE_ALLOWANCE_ENABLED is on in the Worker, which ships "false" in production.
--
--   chat-mistral-small  3 free a day per account, 100 a day across all accounts   (provider cost $0.0020 a job, so at most $0.20 a day)
--   nano-banana-kie     3 free a day per account,  40 a day across all accounts   (provider cost $0.0200 a job, so at most $0.80 a day)
--
-- Together at most $1.00 a day of provider spend, under the ADR's $5 daily ceiling. The same two rows ran on staging on 2026-10-06
-- (a free chat reply and a free image, both zero credits, no ledger row, balance unchanged, every reconcile check clean).
-- model_catalog_free_allowance_check (0205) enforces the bounds: per-generation models only, at most $0.05 a job, and
-- jobs-a-day times cost at most $1.00 a model. A row that does not match fails loudly rather than updating nothing.
--
-- Apply only through the owner-approved workflow.
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET free_allowance_per_day = 3, free_allowance_daily_budget = 100, updated_at = now()
     WHERE id = 'chat-mistral-small' AND provider = 'openrouter-chat' AND modality = 'text' AND cost_unit = 'per_generation'
       AND active = true AND credits_5s = 1 AND provider_cost_per_unit = 0.0020
       AND free_allowance_per_day = 0 AND free_allowance_daily_budget = 0;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one chat-mistral-small row, updated %', affected;
    END IF;

    UPDATE public.model_catalog
       SET free_allowance_per_day = 3, free_allowance_daily_budget = 40, updated_at = now()
     WHERE id = 'nano-banana-kie' AND provider = 'kie' AND modality = 'text-to-image' AND cost_unit = 'per_generation'
       AND active = true AND credits_5s = 2 AND provider_cost_per_unit = 0.0200
       AND free_allowance_per_day = 0 AND free_allowance_daily_budget = 0;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one nano-banana-kie row, updated %', affected;
    END IF;
END $$;
