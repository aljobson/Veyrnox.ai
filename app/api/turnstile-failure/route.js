/**
 * POST /api/turnstile-failure (ADR-0026 amendment 2): the sign-in dialog reports that Turnstile's check failed in this browser.
 *
 * Unauthenticated by design: whoever is stopped at the check is not signed in, so this lives outside /api/v1 and reads no identity
 * header. worker.js rate limits it per connecting IP before it gets here. The handler takes a POST from a page of ours whose body
 * is one Turnstile error code (3 to 9 digits, or "unknown"), or the word "unsupported" for a browser Turnstile refuses (amendment 5),
 * and writes it to the Worker's log. Nothing else is read or kept.
 *
 * Response: 204 with no body. Refusals are typed: 403 cross_site_request, 413 body_too_large, 400 invalid_code or invalid_body.
 */
import { acceptTurnstileFailure } from '../../../lib/turnstileFailureReport.js';

export async function POST(request) {
    return acceptTurnstileFailure(request);
}
