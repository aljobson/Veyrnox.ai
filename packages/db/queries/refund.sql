-- Reference specification. The runnable path is Ledger.refund in
-- packages/db/ledger.ts.
--
-- §25.3 Refund transaction: idempotency guard → append compensating +delta
-- ledger entry → increment materialised balance. Same append-only invariant
-- as debit; every refund is a new ledger row, never an UPDATE.
--
-- Parameters (function form; the TS caller uses inline parameterised SQL):
--   p_job_id: UUID of the failed job (used both as idempotency key and FK)
--   p_user_id: UUID of the user to credit
--   p_credits: integer > 0 (amount to refund; must match the original debit)
--   p_reason: text, e.g. 'refund:job_failed', 'refund:moderation_reject'

CREATE OR REPLACE FUNCTION ledger_refund(
    p_job_id UUID,
    p_user_id UUID,
    p_credits INTEGER,
    p_reason TEXT
) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
    v_existing UUID;
    v_entry_id UUID;
BEGIN
    IF p_credits <= 0 THEN
        RAISE EXCEPTION 'refund credits must be positive (got %)', p_credits;
    END IF;

    -- Idempotency: one refund per job. If a refund already exists for this
    -- job, return its id.
    SELECT id INTO v_existing FROM ledger_entries
    WHERE job_id = p_job_id AND delta > 0 AND reason LIKE 'refund:%'
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
        RETURN v_existing;
    END IF;

    INSERT INTO ledger_entries (user_id, delta, reason, job_id)
    VALUES (p_user_id, p_credits, p_reason, p_job_id)
    RETURNING id INTO v_entry_id;

    UPDATE credit_balances
    SET balance = balance + p_credits, updated_at = now()
    WHERE user_id = p_user_id;

    RETURN v_entry_id;
END $$;
