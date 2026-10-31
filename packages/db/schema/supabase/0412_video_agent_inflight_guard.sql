-- Atomic one-in-flight guard for the video agent (assessment F-04, ADR-0307).
--
-- ADR-0074's rule is "one video-agent run in the making per account". The
-- Worker enforced it with checkCapacity (lib/montageGate.js): an unlocked
-- SELECT of DEBITED/SUBMITTED jobs, run before ledger_debit in a separate
-- round-trip. Two concurrent Approve requests carrying distinct plan tickets
-- (each its own idempotency key) both read "none in flight" and both debit,
-- so one account holds 2-3 concurrent runs and 2-3x provider spend is in
-- flight. (AGENT_VIDEO_ENABLED is "true" in production.)
--
-- This RPC makes the capacity check and the debit atomic. It takes a
-- transaction-level advisory lock keyed on (user, model), so concurrent agent
-- debits for the same account serialize; under the lock it refuses when
-- another in-flight agent job already exists, then delegates the real debit to
-- the unchanged private.ledger_debit_for_admission. ledger_debit itself is not
-- touched, so its (user_id, idempotency_key) idempotency handler keeps working.
--
-- Why not a partial unique index: it would fail to CREATE on any pre-existing
-- in-flight duplicate, CREATE INDEX CONCURRENTLY cannot run inside the
-- migration runner's transaction, and a unique violation would be caught by
-- ledger_debit's handler as a false idempotency replay. The advisory lock has
-- none of those problems and needs no backfill: a user who already holds
-- duplicate in-flight jobs simply has the next run refused; the existing rows
-- drain normally.
--
-- Idempotent (CREATE OR REPLACE), no catalog UPDATE (no ROW_COUNT assertion),
-- and it can only ever refuse a debit, never withhold a refund or over-charge,
-- so it keeps the previous release working under the Worker-only rollback.

CREATE OR REPLACE FUNCTION public.ledger_debit_video_agent(
    p_user_id UUID,
    p_idempotency_key TEXT,
    p_credits INTEGER,
    p_reason TEXT,
    p_model_id TEXT,
    p_inputs JSONB,
    p_limit_per_window INTEGER DEFAULT 0,
    p_window_seconds INTEGER DEFAULT 60
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_conflict BOOLEAN;
BEGIN
    -- Serialize concurrent agent debits for this account+model. Released at
    -- transaction end, so the next request waits for this one to commit (or
    -- roll back) before it reads the in-flight set.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || COALESCE(p_model_id, ''), 0));

    -- Another run of the same agent model is already in the making for this
    -- account. A replay of THIS request's own key is not a conflict: it is let
    -- through so the inner debit answers it as the idempotent replay it is.
    SELECT EXISTS (
        SELECT 1 FROM public.jobs
         WHERE user_id = p_user_id
           AND model_id = p_model_id
           AND state IN ('DEBITED', 'SUBMITTED')
           AND idempotency_key IS DISTINCT FROM p_idempotency_key
    ) INTO v_conflict;
    IF v_conflict THEN
        RETURN jsonb_build_object('ok', false, 'code', 'VIDEO_AGENT_IN_PROGRESS');
    END IF;

    RETURN private.ledger_debit_for_admission(
        p_user_id, p_idempotency_key, p_credits, p_reason, p_model_id, p_inputs,
        p_limit_per_window, p_window_seconds, false);
END $$;

REVOKE ALL ON FUNCTION public.ledger_debit_video_agent(UUID,TEXT,INTEGER,TEXT,TEXT,JSONB,INTEGER,INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ledger_debit_video_agent(UUID,TEXT,INTEGER,TEXT,TEXT,JSONB,INTEGER,INTEGER) TO service_role;
