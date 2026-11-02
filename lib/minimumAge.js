// Changing this policy requires coordinated terms/privacy/mobile/ADR-0110 approval.
export const MINIMUM_AGE = 18;
export const AGE_CONFIRMATION_VERSION = 'age-18-v1';
export const AGE_VERSION_RE = /^[a-z0-9-]{3,40}$/;
export const ageConfirmationEnabled = (env = process.env) => env.AGE_CONFIRMATION_ENABLED === 'true';
