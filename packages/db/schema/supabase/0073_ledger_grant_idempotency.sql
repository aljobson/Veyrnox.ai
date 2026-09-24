-- Give ledger_grant an idempotency key, like every other state-changing RPC.
--
-- CLAUDE.md: "every state-changing RPC takes an idempotency key ... Replay
-- must be a no-op." ledger_grant was the exception. It is service_role-only
-- and an operator runs it by hand (ADR-0022), which is exactly the setting
-- where a command gets run twice: a lost connection, an ambiguous result, a
-- second paste. Today that mints the credits again with nothing to stop it.
--
-- The key is optional so the documented three-argument call in ADR-0022 still
-- works unchanged; passing one makes the grant replay-safe. Uniqueness is
-- carried by a partial unique index on ledger_entries rather than a new
-- column, so the append-only table keeps its shape.
--
-- Idempotent: CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE, and the DROP of
-- the old three-argument function is guarded.

-- grant:<something>#<key> is the reason format when a key is supplied. The
-- index only covers keyed grants, so unkeyed ones behave exactly as before.
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_grant_idempotency
    ON public.ledger_entries (user_id, reason)
    WHERE reason LIKE 'grant:%#%';

CREATE OR REPLACE FUNCTION public.ledger_grant(
    p_user_id UUID,
    p_credits INTEGER,
    p_reason TEXT,
    p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_entry_id UUID;
    v_new_balance INTEGER;
    v_reason TEXT;
BEGIN
    IF p_credits IS NULL OR p_credits <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CREDITS',
                                   'message', format('grant credits must be a positive integer (got %s)', p_credits));
    END IF;
    -- Free Credits come only from signup_grant; expiry only from the sweep.
    IF p_reason IN ('grant:signup', 'expire:free') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'RESERVED_REASON');
    END IF;

    IF p_idempotency_key IS NOT NULL THEN
        IF p_idempotency_key !~ '^[A-Za-z0-9._-]{8,128}$' THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_INVALID');
        END IF;
        -- '#' cannot appear in a key, so the reason stays unambiguous.
        v_reason := p_reason || '#' || p_idempotency_key;
    ELSE
        v_reason := p_reason;
    END IF;

    INSERT INTO public.credit_balances (user_id, balance)
    VALUES (p_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;

    -- Lock the balance row: two replays must not both pass the probe below.
    PERFORM 1 FROM public.credit_balances WHERE user_id = p_user_id FOR UPDATE;

    IF p_idempotency_key IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.ledger_entries
        WHERE user_id = p_user_id AND reason = v_reason
    ) THEN
        SELECT balance INTO v_new_balance FROM public.credit_balances WHERE user_id = p_user_id;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'balance_after', v_new_balance);
    END IF;

    INSERT INTO public.ledger_entries (user_id, delta, free_delta, reason, job_id)
    VALUES (p_user_id, p_credits, 0, v_reason, NULL)
    RETURNING id INTO v_entry_id;

    UPDATE public.credit_balances
    SET balance = balance + p_credits, updated_at = now()
    WHERE user_id = p_user_id
    RETURNING balance INTO v_new_balance;

    RETURN jsonb_build_object('ok', true, 'idempotent', false,
                              'entry_id', v_entry_id, 'balance_after', v_new_balance);
END $$;

-- ADR-0022's documented three-argument call keeps its own function rather
-- than resolving through a DEFAULT. A default on the fourth parameter makes
-- `ledger_grant(uuid, integer, text)` ambiguous the moment anything recreates
-- the three-argument overload — which 0037 does, so applying these files in a
-- different order produced "function ... is not unique". Two explicit
-- signatures cannot collide whatever order they are applied in.
CREATE OR REPLACE FUNCTION public.ledger_grant(
    p_user_id UUID,
    p_credits INTEGER,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT public.ledger_grant(p_user_id, p_credits, p_reason, NULL::TEXT);
$$;

REVOKE ALL ON FUNCTION public.ledger_grant(UUID, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ledger_grant(UUID, INTEGER, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.ledger_grant(UUID, INTEGER, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ledger_grant(UUID, INTEGER, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.ledger_grant(UUID, INTEGER, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ledger_grant(UUID, INTEGER, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.ledger_grant(UUID, INTEGER, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ledger_grant(UUID, INTEGER, TEXT, TEXT) TO service_role;
