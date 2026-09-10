-- Reference specification. The runnable path is Ledger.debit in
-- packages/db/ledger.ts.
--
-- §25.3 Debit transaction:
--   1. Idempotency guard — same (user_id, idempotency_key) returns the
--      existing job unchanged, never double-debiting.
--   2. Row-lock the user's credit_balances row (SELECT ... FOR UPDATE)
--      to serialise concurrent debit requests for the same user.
--   3. Insufficient balance → RAISE, transaction ROLLBACK, no debit.
--   4. Append a -delta ledger entry.
--   5. Decrement the materialised balance in the same transaction — the
--      invariant `balance = SUM(delta)` is enforced by co-committing.
--   6. Update jobs.state PRICED → DEBITED.
--
-- Called inside a transaction opened by the TS caller with SERIALIZABLE
-- isolation.
--
-- Queue emission (`job.submit` event to Inngest) is the caller's job,
-- done after the transaction commits — see packages/queue/ (Slice 6).

CREATE OR REPLACE FUNCTION ledger_debit(
    p_user_id UUID,
    p_idempotency_key TEXT,
    p_job_id UUID,
    p_credits INTEGER,
    p_reason TEXT
) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
    v_existing_job_id UUID;
    v_current_balance INTEGER;
BEGIN
    IF p_credits <= 0 THEN
        RAISE EXCEPTION 'debit credits must be positive (got %)', p_credits;
    END IF;

    -- Idempotency guard
    SELECT id INTO v_existing_job_id FROM jobs
    WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key
    LIMIT 1;

    IF v_existing_job_id IS NOT NULL THEN
        RETURN v_existing_job_id;
    END IF;

    -- Lock the balance row (serialisable + FOR UPDATE, belt and braces)
    SELECT balance INTO v_current_balance FROM credit_balances
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF v_current_balance IS NULL THEN
        RAISE EXCEPTION 'no credit_balances row for user %', p_user_id;
    END IF;

    IF v_current_balance < p_credits THEN
        RAISE EXCEPTION 'insufficient balance: have %, need %',
            v_current_balance, p_credits USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO ledger_entries (user_id, delta, reason, job_id)
    VALUES (p_user_id, -p_credits, p_reason, p_job_id);

    UPDATE credit_balances
    SET balance = balance - p_credits, updated_at = now()
    WHERE user_id = p_user_id;

    UPDATE jobs
    SET state = 'DEBITED', updated_at = now()
    WHERE id = p_job_id;

    RETURN p_job_id;
END $$;
