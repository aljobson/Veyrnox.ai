-- A reported dispute Freezes the account (ADR-0019 decision 1, ADR-0020).
--
-- Stripe's charge.dispute.created is the Merchant of Record reporting a card
-- dispute against a Top-up. purchase_dispute_opened finds our purchase by the
-- dispute's payment_intent — never by a user named in the payload — and
-- Freezes that purchase's owner, whether or not credits were spent. The
-- refund-after-spend inference from 0038 stays as the backstop (decision 3).
--
-- account_freezes gains reason 'dispute' and external_ref, the Stripe dispute
-- id that names it. The same dispute never Freezes twice: once any freeze for
-- that dispute exists, active or already lifted by an Operator, a redelivered
-- event is a no-op and cannot re-freeze. Freezing an already Frozen account
-- changes nothing (decision 4); the account-action log that decision also
-- asks for is not built yet, so a dispute that lands on an account already
-- Frozen for another reason leaves no row naming it.
-- ponytail: that dispute could re-freeze if its event is redelivered after an
-- Operator unfreeze; the account-action log closes this.
--
-- Lock order matches purchase_reverse: the purchase row, then the owner's
-- credit_balances row that ledger_debit and purchase_create take before their
-- freeze check, so a generation or purchase cannot slip past a Freeze.
--
-- Idempotent: DROP/ADD CONSTRAINT, IF NOT EXISTS, OR REPLACE; REVOKE/GRANT
-- re-run.

ALTER TABLE public.account_freezes DROP CONSTRAINT IF EXISTS account_freezes_reason_check;
ALTER TABLE public.account_freezes
    ADD CONSTRAINT account_freezes_reason_check CHECK (reason IN ('chargeback', 'dispute'));

ALTER TABLE public.account_freezes
    ADD COLUMN IF NOT EXISTS external_ref TEXT NULL
        CONSTRAINT account_freezes_external_ref_shape CHECK (external_ref ~ '^[A-Za-z0-9_]{1,255}$');
CREATE INDEX IF NOT EXISTS account_freezes_external_ref_idx
    ON public.account_freezes (external_ref) WHERE external_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION public.purchase_dispute_opened(
    p_payment_intent TEXT,
    p_dispute_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_p public.purchases%ROWTYPE;
    v_inserted UUID;
BEGIN
    IF p_dispute_id IS NULL OR p_dispute_id !~ '^[A-Za-z0-9_]{1,255}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_DISPUTE');
    END IF;

    SELECT * INTO v_p FROM public.purchases
    WHERE stripe_payment_intent = p_payment_intent FOR UPDATE;
    IF v_p.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PURCHASE_NOT_FOUND');
    END IF;

    PERFORM 1 FROM public.credit_balances WHERE user_id = v_p.user_id FOR UPDATE;

    IF EXISTS (SELECT 1 FROM public.account_freezes WHERE external_ref = p_dispute_id) THEN
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'user_id', v_p.user_id, 'frozen', false);
    END IF;

    INSERT INTO public.account_freezes (user_id, reason, purchase_id, external_ref)
    VALUES (v_p.user_id, 'dispute', v_p.id, p_dispute_id)
    ON CONFLICT (user_id) WHERE unfrozen_at IS NULL DO NOTHING
    RETURNING id INTO v_inserted;

    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'user_id', v_p.user_id,
        'frozen', true, 'already_frozen', v_inserted IS NULL);
END $$;

REVOKE ALL ON FUNCTION public.purchase_dispute_opened(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purchase_dispute_opened(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.purchase_dispute_opened(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_dispute_opened(TEXT, TEXT) TO service_role;
