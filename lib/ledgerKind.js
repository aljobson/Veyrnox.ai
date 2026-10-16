/**
 * The stable, public category of a ledger row. The operator's `reason` is never
 * sent to a browser or to Vey; this mapping is the only thing that leaves it.
 * Shared by /api/v1/ledger and Vey's account answers (ADR-0103) so they cannot drift.
 */
export function ledgerKind(reason, delta) {
    const text = String(reason || '');
    if (text === 'grant:signup') return 'signup_grant';
    if (text === 'expire:free') return 'free_credit_expiry';
    if (text.startsWith('refund:')) return 'generation_refund';
    if (text.startsWith('debit:')) return 'generation';
    if (text === 'grant:topup') return 'top_up';
    // ADR-0071: a referral reward is a grant keyed by the friend (grant:referral#referral-<id>); its clawback is reverse:referral.
    if (text === 'grant:referral' || text.startsWith('grant:referral#')) return 'referral_reward';
    if (text === 'reverse:referral') return 'referral_reward_reversed';
    if (text.startsWith('reverse:')) return 'payment_adjustment';
    return 'adjustment';
}
