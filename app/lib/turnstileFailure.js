// What the sign-in dialog says when Cloudflare Turnstile's check fails in the
// browser (ADR-0026). Turnstile hands its error-callback a code whose first
// three digits are the family:
// https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/
// A failed check never reaches Supabase, so it is in no auth log: the notice
// and one console line (components/Turnstile.jsx) are all there is.

export const CAPTCHA_REQUIRED_COPY = 'Complete the security check first.';

// Also shown when the script itself is blocked (Turnstile's onError).
export const CAPTCHA_BLOCKED_COPY = "The security check couldn't load. Disable content blockers for this site, or sign in with Google.";

// 300* and 600*: Cloudflare's "generic challenge failure". Common in in-app
// and embedded browsers. OAuth is not challenged, so Google is a way through.
const DID_NOT_PASS_COPY = "The security check didn't pass in this browser. Reload the page to try again. If you're inside another app, open veyrnox.ai in your usual browser instead. Continue with Google doesn't need the check.";

const CLOCK_COPY = "The security check failed because this device's clock looks wrong. Set the date and time to automatic, then reload the page.";

const GENERIC_COPY = "The security check didn't finish, so reload the page to try again, or use Continue with Google.";

/**
 * The code as digits, or "unknown". This is the value that gets logged, so
 * nothing else the widget might hand over passes through.
 * @param {unknown} raw
 * @returns {string}
 */
export function turnstileErrorCode(raw) {
    const text = typeof raw === 'number' || typeof raw === 'string' ? String(raw).trim() : '';
    return /^\d{3,9}$/.test(text) ? text : 'unknown';
}

/**
 * @param {unknown} code Turnstile's error code
 * @returns {string} plain wording, never the code itself
 */
export function turnstileFailureCopy(code) {
    const known = turnstileErrorCode(code);
    if (known === '200100') return CLOCK_COPY;
    if (known === '200500') return CAPTCHA_BLOCKED_COPY;
    if (/^(300|600)\d{3}$/.test(known)) return DID_NOT_PASS_COPY;
    return GENERIC_COPY;
}

/**
 * A notice about the check. `captcha` marks it so a token can clear it
 * without touching the answer to something the person did.
 * @param {unknown} [code] the widget's last error code, if it has failed
 * @returns {{ kind: 'error', captcha: true, text: string }}
 */
export function captchaNotice(code) {
    return { kind: 'error', captcha: true, text: code ? turnstileFailureCopy(code) : CAPTCHA_REQUIRED_COPY };
}

/**
 * The notice after the widget reports a failure. Whatever answers the
 * person's own action stays: the widget resets after every submit, and a
 * failure then must not replace "check your email". Turnstile retries by
 * itself and reports each attempt, so the same wording keeps the same object.
 */
export function noticeAfterCaptchaFailure(current, code) {
    if (current && !current.captcha) return current;
    const next = captchaNotice(code || 'unknown');
    return current && current.text === next.text ? current : next;
}

/** The notice after a token arrives: anything about the check is over. */
export function noticeAfterCaptchaToken(current) {
    return current && current.captcha ? null : current;
}
