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
