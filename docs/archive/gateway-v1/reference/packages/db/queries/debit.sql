-- §25.3 Debit Transaction (Veyrnox invariant #2)
-- 
-- Atomic debit: idempotency guard → lock balance → append entry → update balance → outbox row.
-- Must be called inside a transaction with SERIALIZABLE isolation.
-- 
-- Parameters:
--   p_user_id: user UUID
--   p_idempotency_key: string (unique per user per request)
--   p_job_id: uuid (foreign key to jobs.id, created before this transaction)
--   p_credits: integer (positive; amount to debit)
--   p_reason: text (e.g., 'debit:generation')
--
-- Returns: job_id on success, raises exception on conflict or insufficient balance.

DO $$ 
DECLARE
  v_job_id UUID;
  v_existing_job_id UUID;
  v_current_balance INTEGER;
BEGIN
  -- Idempotency: check if this (user_id, idempotency_key) already debited
  SELECT id INTO v_existing_job_id FROM jobs
  WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key
  LIMIT 1;
  
  IF v_existing_job_id IS NOT NULL THEN
    -- Already debited; return the existing job (no double charge)
    RETURN v_existing_job_id;
  END IF;

  -- Lock the balance for this user (serializable isolation ensures no race)
  SELECT balance INTO v_current_balance FROM credit_balances
  WHERE user_id = p_user_id
  FOR UPDATE;
  
  -- Sufficient balance?
  IF v_current_balance < p_credits THEN
    RAISE EXCEPTION 'Insufficient balance: have %, need %', v_current_balance, p_credits;
  END IF;

  -- Append ledger entry (never UPDATE, never DELETE)
  INSERT INTO ledger_entries (user_id, delta, reason, job_id)
  VALUES (p_user_id, -p_credits, p_reason, p_job_id);

  -- Update materialised balance (same transaction, same atomicity)
  UPDATE credit_balances
  SET balance = balance - p_credits, updated_at = now()
  WHERE user_id = p_user_id;

  -- Create outbox row (job.submit event for queue relay)
  INSERT INTO outbox (topic, payload)
  VALUES (
    'job.submit',
    jsonb_build_object(
      'job_id', p_job_id,
      'user_id', p_user_id,
      'credits', p_credits
    )
  );

  RETURN p_job_id;
END $$;
