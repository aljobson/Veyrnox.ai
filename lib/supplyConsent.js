/**
 * Supply Consent (ADR-0018 decision 6): the acknowledgement a buyer ticks
 * before a Top-up. Shared by the buy dialog and POST /api/v1/checkout so the
 * server only accepts the wording the page actually showed.
 *
 * Changing the text means a new version: purchases record the version, and
 * git history is the record of what each version said. The `-draft` suffix
 * stays until Finance/Legal approve the wording (ADR-0018 preconditions).
 */

export const SUPPLY_CONSENT_VERSION = 'supply-consent-2026-09-13-draft';

export const SUPPLY_CONSENT_TEXT =
    'I want my credits now. I understand they are added to my balance as soon as payment completes, ' +
    'and that I lose my right to cancel this purchase once I use any of my credits to generate.';
