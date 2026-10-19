import { translator } from '../../lib/i18n/translate.mjs';
const defaultT = translator('en');
// What the sign-in dialog says when Cloudflare Turnstile's check fails in the
// browser (ADR-0026). Turnstile hands its error-callback a code whose first
// three digits are the family:
// https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/
// A failed check never reaches Supabase, so it is in no auth log: the notice,
// one console line (components/Turnstile.jsx) and one report of the code to
// our own server (reportTurnstileFailure.js) are all there is.

export const CAPTCHA_REQUIRED_COPY = 'Complete the security check first.';

// Where the browser reports a failed check (ADR-0026 amendment 2). Outside
// /api/v1: whoever is stopped at the check is not signed in.
export const TURNSTILE_FAILURE_PATH = '/api/turnstile-failure';

// Turnstile's code for an iframe that could not load. A script that never
// loads cannot report a code at all, so the dialog files it under this one.
export const CAPTCHA_BLOCKED_CODE = '200500';

// 300* and 600*: Cloudflare's "generic challenge failure". Common in in-app
// and embedded browsers. Turnstile retries these by itself and a reload loses
// what was typed, so reloading comes second. OAuth is not challenged, so
// Google is a way through.



// Not one of Turnstile's codes. In Managed mode the widget can show its
// checkbox and wait for a click, and after a failure its own retry can stop
// there. Turnstile says so through before-interactive-callback, not
// error-callback (ADR-0026 amendment 3). The dialog keeps this word where it
// keeps the code. It is not a failure: nothing logs or reports it.
export const CAPTCHA_WAITING = 'waiting';
// The widget's label is not quoted: it follows the browser's language.

// Not one of Turnstile's codes either. Turnstile refuses a browser that is
// out of date or unsupported through unsupported-callback and reports no
// error (ADR-0026 amendment 4). Reloading gives the same answer and nothing
// retries, so the wording says neither. It is counted under this word
// (amendment 5), and it writes no console line.
export const CAPTCHA_UNSUPPORTED = 'unsupported';

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
 * What a report to our own server may hold (ADR-0026 amendment 5): what
 * turnstileErrorCode returns, or the one word of our own that is counted.
 * The browser sends only this and the route accepts nothing else. The widget
 * cannot make the word: its error codes go through turnstileErrorCode first.
 * @param {unknown} raw
 * @returns {string}
 */
export function turnstileReportCode(raw) {
    return raw === CAPTCHA_UNSUPPORTED ? CAPTCHA_UNSUPPORTED : turnstileErrorCode(raw);
}

/**
 * @param {unknown} code Turnstile's error code
 * @returns {string} plain wording, never the code itself
 */
export function turnstileFailureCopy(code, t = defaultT) {
    const known = turnstileErrorCode(code);
    if (known === '200100') return t('authGate.captcha.clock');
    if (known === CAPTCHA_BLOCKED_CODE) return t('authGate.captcha.blocked');
    if (/^(300|600)\d{3}$/.test(known)) return t('authGate.captcha.retry');
    return t('authGate.captcha.generic');
}

/**
 * A notice about the check. `captcha` marks it so a token can clear it
 * without touching the answer to something the person did.
 * @param {unknown} [code] the widget's last error code if it has failed,
 *   CAPTCHA_WAITING while it waits for a click, or CAPTCHA_UNSUPPORTED
 * @returns {{ kind: 'error', captcha: true, text: string }}
 */
export function captchaNotice(code, t = defaultT) {
    if (code === CAPTCHA_WAITING) return { kind: 'error', captcha: true, text: t('authGate.captcha.waiting') };
    if (code === CAPTCHA_UNSUPPORTED) return { kind: 'error', captcha: true, text: t('authGate.captcha.unsupported') };
    return { kind: 'error', captcha: true, text: code ? turnstileFailureCopy(code, t) : t('authGate.captcha.required') };
}

/**
 * The notice after the widget reports a failure. Whatever answers the
 * person's own action stays: the widget resets after every submit, and a
 * failure then must not replace "check your email". Turnstile retries by
 * itself and reports each attempt, so the same wording keeps the same object.
 */
export function noticeAfterCaptchaFailure(current, code, t = defaultT) {
    if (current && !current.captcha) return current;
    const next = captchaNotice(code || 'unknown', t);
    return current && current.text === next.text ? current : next;
}

/**
 * The notice once the widget shows its checkbox and waits for a click. What
 * is being said about the check must stop saying it will retry by itself. A
 * dialog that is saying nothing, or is answering the person's own action,
 * stays as it is: the widget is on screen and asks for the click itself. An
 * unticked box times out and comes back, so the same wording keeps the same
 * object.
 */
export function noticeWhileCaptchaWaits(current, t = defaultT) {
    if (!current || !current.captcha) return current;
    return current.text === t('authGate.captcha.waiting') ? current : captchaNotice(CAPTCHA_WAITING, t);
}

/**
 * The notice after a token arrives, or after the dialog and its widget have
 * gone: anything said about the check is over.
 */
export function noticeAfterCaptchaToken(current) {
    return current && current.captcha ? null : current;
}
