-- 0410_chat_stops_before_text_counts_refunded.sql
--
-- Security fix F-12 (ADR-0306). chat_stops_before_text (0258) is the daily cap
-- on "stopped before first text" chat turns: each such turn is refunded in full
-- while the provider still bills the thinking, so the balance never moves and
-- the only real bound is this per-day count (STOPS_BEFORE_TEXT_PER_DAY in
-- lib/chatTurn.js). chatTurn marks the job FAILED with error_code 'user_canceled'
-- (lib/chatTurn.js job_failed) and then refunds it; ledger_refund (0206) sets
-- jobs.state = 'REFUNDED' and does NOT touch error_code. The counter only
-- matched state = 'FAILED', so every successfully-refunded cancellation dropped
-- out of the count and the cap never bound — a user could stop-before-text far
-- more than the daily allowance, each one billing the shared provider key.
--
-- Fix: count the durable cancellation outcome in either settled state. A
-- cancelled-before-text job is the only openrouter-chat job that carries
-- error_code = 'user_canceled'; a completed turn is SUCCEEDED/STORED (excluded)
-- and a provider failure has a different error_code, so widening to
-- ('FAILED','REFUNDED') counts exactly the cancellations, refunded or not.
--
-- Idempotent: CREATE OR REPLACE, same signature, ACL preserved (restated below).

CREATE OR REPLACE FUNCTION public.chat_stops_before_text(p_user_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT count(*)::integer
    FROM public.jobs j
    WHERE j.user_id = p_user_id
      AND j.provider = 'openrouter-chat'
      AND j.state IN ('FAILED', 'REFUNDED')
      AND j.error_code = 'user_canceled'
      AND j.created_at > now() - interval '1 day';
$$;

REVOKE ALL ON FUNCTION public.chat_stops_before_text(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_stops_before_text(UUID) TO service_role;
