// Free trial on the generation plans (ADR-0316). One place decides whether a trial is offered, so the plans
// endpoint, the checkout request and the three-step paywall can never disagree about it.

export const SUBSCRIPTION_TRIAL_DAYS = 7;
// Stripe sends customer.subscription.trial_will_end this long before a trial ends; the reminder email follows it.
export const TRIAL_REMINDER_DAYS = 3;
export const SUBSCRIPTION_CONSENT_VERSION_TRIAL = 'credit-sub-trial-2026-11-01';

/** Days of free trial offered right now: 7 only while SUBSCRIPTION_TRIAL_ENABLED is exactly "true", else 0. */
export const subscriptionTrialDays = (env = process.env) => (env.SUBSCRIPTION_TRIAL_ENABLED === 'true' ? SUBSCRIPTION_TRIAL_DAYS : 0);
