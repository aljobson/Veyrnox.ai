-- 0250_chat_stops_before_text.sql
-- How many chat replies a user stopped before their first character in the
-- last rolling day (audit 2026-10-09, M-05; ADR-0067 amendment 15).
--
-- A reply stopped before any text is refunded in full (ADR-0067 point 4) while
-- the provider still bills the thinking it did. The balance never moves, so
-- the only bound on the cost was the OpenRouter key's spend cap, which takes
-- Chat down for everyone when it is reached. The Worker now asks this count
-- before each send and refuses the send once it reaches the day's allowance
-- (lib/chatTurn.js, STOPS_BEFORE_TEXT_PER_DAY). Such an ending leaves a job in
-- FAILED with error_code 'user_canceled' and the chat provider, so the count
-- is read from jobs over the existing (user_id, created_at) index; nothing is
-- written. A Worker running before this is applied gets an error from the
-- missing function and lets the send through, as it always did.

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
      AND j.state = 'FAILED'
      AND j.error_code = 'user_canceled'
      AND j.created_at > now() - interval '1 day';
$$;

REVOKE ALL ON FUNCTION public.chat_stops_before_text(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_stops_before_text(UUID) TO service_role;
