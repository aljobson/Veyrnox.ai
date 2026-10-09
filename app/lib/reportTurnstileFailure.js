// Tells our own server that Turnstile's check failed in this browser, so the
// owner can count failures (ADR-0026 amendment 2). The body is the error code
// and nothing else. The request carries no session, and names our site as
// where it came from, not the page.

import { TURNSTILE_FAILURE_PATH, turnstileErrorCode } from './turnstileFailure.js';

// Turnstile retries by itself and a reopened dialog fails the same way, so a
// code is reported once per page load. The cap bounds what one page can send
// whatever the widget does.
export const MAX_REPORTS_PER_PAGE_LOAD = 5;
const reported = new Set();

/**
 * Fire and forget. Returns nothing and never throws: a report that cannot be
 * sent, is refused or is rate limited is dropped, and is not tried again.
 * @param {unknown} raw Turnstile's error code
 * @returns {void}
 */
export function reportTurnstileFailure(raw) {
    try {
        const code = turnstileErrorCode(raw);
        if (reported.has(code) || reported.size >= MAX_REPORTS_PER_PAGE_LOAD) return;
        reported.add(code);
        fetch(TURNSTILE_FAILURE_PATH, {
            method: 'POST',
            body: code,
            keepalive: true,
            credentials: 'omit',
            cache: 'no-store',
            // Not 'no-referrer': a browser too old to send Sec-Fetch-Site is
            // recognised by its Origin, and that policy can blank Origin too.
            referrerPolicy: 'origin',
        }).catch(() => {});
    } catch {
        // Dropped. The sign-in dialog must not depend on this.
    }
}
