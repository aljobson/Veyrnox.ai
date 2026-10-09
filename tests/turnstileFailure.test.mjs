import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    CAPTCHA_BLOCKED_COPY,
    CAPTCHA_REQUIRED_COPY,
    captchaNotice,
    noticeAfterCaptchaFailure,
    noticeAfterCaptchaToken,
    turnstileErrorCode,
    turnstileFailureCopy,
} from '../app/lib/turnstileFailure.js';

// A Turnstile check that fails in the browser never reaches Supabase, so it is
// in no auth log. What the dialog says and one console line are the whole
// record (seen 2026-10-09: an embedded browser, and a dialog that only said
// "Complete the security check first" after submit).

const DID_NOT_PASS = turnstileFailureCopy('600010');
const CLOCK = turnstileFailureCopy('200100');
const GENERIC = turnstileFailureCopy('110200');
const EVERY_COPY = [DID_NOT_PASS, CLOCK, CAPTCHA_BLOCKED_COPY, GENERIC, CAPTCHA_REQUIRED_COPY];

test('the code is digits or "unknown", whatever the widget hands over', () => {
    assert.equal(turnstileErrorCode('600010'), '600010');
    assert.equal(turnstileErrorCode(600010), '600010');
    assert.equal(turnstileErrorCode(' 300030 '), '300030');
    for (const odd of [undefined, null, '', 'crashed', {}, [], NaN, -1, 1.5, '600010; DROP', '6'.repeat(40)]) {
        assert.equal(turnstileErrorCode(odd), 'unknown', String(odd));
    }
    // This is what gets logged, so free text must never pass through it.
    assert.equal(turnstileErrorCode('0.AbCdEf-token-shaped_string.123456'), 'unknown');
    assert.equal(turnstileErrorCode('someone@example.com'), 'unknown');
});

test('a check that did not pass in this browser says what to do next', () => {
    // Cloudflare's 300* and 600* families: the remaining digits vary.
    for (const code of ['300010', '300030', '600010', '600020', 600010]) {
        assert.equal(turnstileFailureCopy(code), DID_NOT_PASS, String(code));
    }
    assert.match(DID_NOT_PASS, /didn't pass in this browser/);
    assert.match(DID_NOT_PASS, /Reload the page/);
    assert.match(DID_NOT_PASS, /inside another app/);
    assert.match(DID_NOT_PASS, /Continue with Google doesn't need the check/);
});

test('a wrong device clock is named', () => {
    assert.match(CLOCK, /clock/);
    assert.match(CLOCK, /date and time/);
    assert.notEqual(CLOCK, DID_NOT_PASS);
    // 200100 only: its neighbours are not about the clock.
    assert.equal(turnstileFailureCopy('200010'), GENERIC);
});

test('a widget that could not load gets the same advice as a blocked script', () => {
    assert.equal(turnstileFailureCopy('200500'), CAPTCHA_BLOCKED_COPY);
    assert.match(CAPTCHA_BLOCKED_COPY, /couldn't load/);
    assert.match(CAPTCHA_BLOCKED_COPY, /content blockers/);
});

test('anything else is one generic sentence', () => {
    for (const code of ['110200', '110600', '110620', '400020', '100000', '3000', 'unknown', undefined, null, 'crashed']) {
        assert.equal(turnstileFailureCopy(code), GENERIC, String(code));
    }
    assert.equal(GENERIC.split('. ').length, 1, 'one sentence');
    assert.match(GENERIC, /Google/);
});

test('no copy shows a code, and all of it names the security check', () => {
    assert.equal(new Set(EVERY_COPY).size, EVERY_COPY.length);
    for (const copy of EVERY_COPY) {
        assert.doesNotMatch(copy, /\d/, copy);
        // e2e/signup.spec.mjs finds the notice by these words.
        assert.match(copy, /security check/, copy);
    }
});

test('a notice about the check is marked as one', () => {
    assert.deepEqual(captchaNotice(null), { kind: 'error', captcha: true, text: CAPTCHA_REQUIRED_COPY });
    assert.deepEqual(captchaNotice(undefined), { kind: 'error', captcha: true, text: CAPTCHA_REQUIRED_COPY });
    assert.deepEqual(captchaNotice('600010'), { kind: 'error', captcha: true, text: DID_NOT_PASS });
    assert.deepEqual(captchaNotice('unknown'), { kind: 'error', captcha: true, text: GENERIC });
});

test('a failure shows straight away unless the dialog is already saying something else', () => {
    assert.deepEqual(noticeAfterCaptchaFailure(null, '600010'), captchaNotice('600010'));
    // "Complete the security check first" gives way to the reason.
    assert.deepEqual(noticeAfterCaptchaFailure(captchaNotice(null), '200100'), captchaNotice('200100'));
    // The answer to what the person just did stays: the widget resets after
    // every submit, and a failure then must not replace "check your email".
    const sent = { kind: 'success', text: 'Check your email for a sign-in link.' };
    const wrong = { kind: 'error', text: "That email and password don't match. Check both and try again." };
    assert.equal(noticeAfterCaptchaFailure(sent, '600010'), sent);
    assert.equal(noticeAfterCaptchaFailure(wrong, '600010'), wrong);
});

test('a retry that fails the same way changes nothing', () => {
    // Turnstile retries by itself and reports each attempt.
    const shown = noticeAfterCaptchaFailure(null, '600010');
    assert.equal(noticeAfterCaptchaFailure(shown, '600020'), shown);
    assert.notEqual(noticeAfterCaptchaFailure(shown, '200100'), shown);
});

test('a token clears what was said about the check and nothing else', () => {
    assert.equal(noticeAfterCaptchaToken(captchaNotice('600010')), null);
    assert.equal(noticeAfterCaptchaToken(captchaNotice(null)), null);
    assert.equal(noticeAfterCaptchaToken(null), null);
    const sent = { kind: 'success', text: 'Check your email to confirm your account.' };
    assert.equal(noticeAfterCaptchaToken(sent), sent);
});

// The two components are JSX, so these read the source, like
// authCaptcha.test.mjs and authGateLifecycle.test.mjs.
const turnstile = readFileSync(new URL('../components/Turnstile.jsx', import.meta.url), 'utf8');
const authGate = readFileSync(new URL('../components/AuthGate.jsx', import.meta.url), 'utf8');

const between = (src, start, end) => {
    const from = src.indexOf(start);
    assert.ok(from >= 0, `${start} not found`);
    const to = src.indexOf(end, from);
    assert.ok(to > from, `${end} not found after ${start}`);
    return src.slice(from, to + end.length);
};

test('the widget passes its error code up and still drops the token', () => {
    const onError = between(turnstile, '"error-callback": (raw) => {', 'return true;');
    assert.match(onError, /onToken\(null\);/);
    assert.match(onError, /const code = turnstileErrorCode\(raw\);/);
    assert.match(onError, /onFailure\(code\);/);
    // Non-falsy tells Turnstile the error was handled; otherwise it adds its
    // own console warning on every retry (Cloudflare, client-side errors).
    assert.match(onError, /return true;$/);
    assert.match(turnstile, /export function Turnstile\(\{ onToken, onError, onFailure, resetKey \}\)/);
});

test('a script that cannot load still goes to onError alone', () => {
    assert.match(turnstile, /\.catch\(\(\) => \{\s*if \(!cancelled\) onError\(\);\s*\}\);/);
});

test('one console line per failure, carrying the code and nothing else', () => {
    const logs = turnstile.split('\n').filter((l) => /console\./.test(l));
    assert.deepEqual(logs.map((l) => l.trim()), ['console.error("[auth] turnstile check failed:", code);']);
    const onError = between(turnstile, '"error-callback": (raw) => {', 'return true;');
    // Not once per retry: only when the code differs from the last one logged.
    assert.match(onError, /if \(lastFailure\.current !== code\) \{\s*lastFailure\.current = code;\s*console\.error\(/);
    // A token, or a reset after a submit, starts a new attempt.
    assert.match(between(turnstile, 'callback: (token) => {', '},'), /lastFailure\.current = null;\s*onToken\(token\);/);
    assert.match(between(turnstile, 'if (!resetKey ||', '}, [resetKey]);'), /lastFailure\.current = null;/);
});

test('AuthGate shows the failure when it happens and clears it on a token', () => {
    const widget = between(authGate, '<Turnstile', '/>');
    assert.match(widget, /onFailure=\{\(code\) => \{ setCaptchaFailure\(code\); setNotice\(\(n\) => noticeAfterCaptchaFailure\(n, code\)\); \}\}/);
    assert.match(widget, /onToken=\{\(token\) => \{ setCaptcha\(token\); if \(token\) \{ setCaptchaFailure\(null\); setNotice\(noticeAfterCaptchaToken\); \} \}\}/);
    assert.match(widget, /onError=\{\(\) => setNotice\(\{ kind: "error", text: CAPTCHA_BLOCKED_COPY \}\)\}/);
    assert.match(authGate, /<div role="status" aria-live="polite"/);
});

test('a submit without a token gives the reason when there is one', () => {
    // Both the form and the passkey button stop here (ADR-0026).
    const guards = authGate.match(/if \(TURNSTILE_SITE_KEY && !captcha\) \{\s*setNotice\(captchaNotice\(captchaFailure\)\);\s*return;/g) || [];
    assert.equal(guards.length, 2);
    assert.doesNotMatch(authGate, /Complete the security check first/, 'the wording lives in app/lib/turnstileFailure.js');
});

test('AuthGate stays under the 500-line ceiling', () => {
    assert.ok(authGate.split('\n').length <= 500, 'CLAUDE.md: keep files under 500 lines');
});
