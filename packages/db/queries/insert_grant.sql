-- Reference specification. The runnable path is Ledger.grant in
-- packages/db/ledger.ts.
--
-- Grants (subscription top-up, one-off credit purchase, free-tier signup)
-- are +delta ledger entries with reason like 'grant:signup',
-- 'grant:subscription:lemonsqueezy', 'grant:topup'. Idempotency is
-- enforced by the caller against webhook_events(source, external_id)
-- to prevent replayed Stripe/LMS webhooks from double-granting.
--
-- Parameters:
--   p_user_id: UUID of the user
--   p_credits: integer > 0 (amount to add)
--   p_reason: text
--   p_source_event_id: text — external event id (webhook_events.external_id)
--                       already dedup'd; passed for audit link.

CREATE OR REPLACE FUNCTION ledger_grant(
    p_user_id UUID,
    p_credits INTEGER,
    p_reason TEXT,
    p_source_event_id TEXT
) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
    v_entry_id UUID;
BEGIN
    IF p_credits <= 0 THEN
        RAISE EXCEPTION 'grant credits must be positive (got %)', p_credits;
    END IF;

    -- Ensure a balance row exists (first grant for a new user)
    INSERT INTO credit_balances (user_id, balance)
    VALUES (p_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO ledger_entries (user_id, delta, reason, job_id)
    VALUES (p_user_id, p_credits, p_reason, NULL)
    RETURNING id INTO v_entry_id;

    UPDATE credit_balances
    SET balance = balance + p_credits, updated_at = now()
    WHERE user_id = p_user_id;

    RETURN v_entry_id;
END $$;
