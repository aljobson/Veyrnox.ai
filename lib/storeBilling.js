/**
 * Mobile store billing (ADR-0108). Everything here is off until
 * STORE_BILLING_ENABLED is "true"; a new flag ships "false".
 */

export function storeBillingEnabled(env = process.env) {
    return env.STORE_BILLING_ENABLED === 'true';
}

// Sandbox purchases are free test purchases. Production must never credit them:
// that would be a faucet. Staging turns this on to test with the store sandboxes.
export function storeSandboxAllowed(env = process.env) {
    return env.STORE_BILLING_ALLOW_SANDBOX === 'true';
}

// App Review buys in the store sandbox (ADR-0108 amendment 5). Production credits a
// sandbox event only for this one account, the login given to App Review; unset or
// malformed means no exception.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function storeReviewUserId(env = process.env) {
    const id = String(env.STORE_REVIEW_USER_ID || '').trim().toLowerCase();
    return UUID_RE.test(id) ? id : null;
}

// Recording stays on for renewals, refunds and in-flight purchases when sales close.
export function storeSalesOpen(env = process.env) {
    return env.STORE_SALES_ENABLED === 'true';
}
