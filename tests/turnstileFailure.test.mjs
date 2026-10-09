import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    CAPTCHA_BLOCKED_CODE,
    CAPTCHA_REQUIRED_COPY,
    CAPTCHA_UNSUPPORTED,
    CAPTCHA_WAITING,
    captchaNotice,
    noticeAfterCaptchaFailure,
    noticeAfterCaptchaToken,
    noticeWhileCaptchaWaits,
    turnstileErrorCode,
    turnstileFailureCopy,
    turnstileReportCode,
} from '../app/lib/turnstileFailure.js';

// A Turnstile check that fails in the browser never reaches Supabase, so it is
// in no auth log. What the dialog says and one console line were the whole
// record (seen 2026-10-09: an embedded browser, and a dialog that only said
// "Complete the security check first" after submit). The count of failures
// is in turnstileFailureReport.test.mjs.

const DID_NOT_PASS = turnstileFailureCopy('600010');
const CLOCK = turnstileFailureCopy('200100');
const BLOCKED = turnstileFailureCopy('200500');
const GENERIC = turnstileFailureCopy('110200');
const WAITING = captchaNotice(CAPTCHA_WAITING).text;
const UNSUPPORTED = captchaNotice(CAPTCHA_UNSUPPORTED).text;
const EVERY_COPY = [DID_NOT_PASS, CLOCK, BLOCKED, GENERIC, WAITING, UNSUPPORTED, CAPTCHA_REQUIRED_COPY];

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
    // Turnstile retries these by itself, and a reload loses what was typed,
    // so reloading is the second thing to try, not the first.
    assert.match(DID_NOT_PASS, /retry by itself\. If this message stays, reload the page/);
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
    // A script that never loads cannot report a code, so the dialog files it
    // under Turnstile's own code for an iframe that could not load.
    assert.equal(CAPTCHA_BLOCKED_CODE, '200500');
    assert.match(BLOCKED, /couldn't load/);
    assert.match(BLOCKED, /content blockers/);
    assert.match(BLOCKED, /Google/);
    assert.deepEqual(captchaNotice(CAPTCHA_BLOCKED_CODE), { kind: 'error', captcha: true, text: BLOCKED });
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

// ADR-0026 amendment 3. Seen 2026-10-09: the check failed with 600010, the
// dialog said "It will retry by itself", and the widget had already retried
// and was showing its checkbox, unticked. Each waited for the other.

test('a widget that waits for a click is told apart from one that retries', () => {
    assert.deepEqual(captchaNotice(CAPTCHA_WAITING), { kind: 'error', captcha: true, text: WAITING });
    assert.match(WAITING, /^The security check above is waiting for you to tick its box\./);
    // The one thing it must not say while the box is unticked.
    assert.doesNotMatch(WAITING, /retry by itself/);
    assert.match(WAITING, /reload the page/);
    assert.match(WAITING, /inside another app/);
    assert.match(WAITING, /Continue with Google doesn't need the check/);
    // The widget's label follows the browser's language and the dialog is in
    // English, so quoting it would be wrong everywhere else.
    assert.doesNotMatch(WAITING, /Verify you are human/i);
});

test('"waiting" is not a Turnstile code, so it cannot be logged or reported as itself', () => {
    assert.equal(turnstileErrorCode(CAPTCHA_WAITING), 'unknown');
    assert.doesNotMatch(CAPTCHA_WAITING, /^\d/);
    // Only captchaNotice knows the word. Asked as a code, it is no code.
    assert.equal(turnstileFailureCopy(CAPTCHA_WAITING), GENERIC);
});

test('the wait changes a notice about the check and raises none of its own', () => {
    const waiting = captchaNotice(CAPTCHA_WAITING);
    assert.deepEqual(noticeWhileCaptchaWaits(captchaNotice('600010')), waiting);
    assert.deepEqual(noticeWhileCaptchaWaits(captchaNotice('unknown')), waiting);
    assert.deepEqual(noticeWhileCaptchaWaits(captchaNotice(null)), waiting);
    // A first check that asks for a click has not failed: the widget is on
    // screen and says what it wants.
    assert.equal(noticeWhileCaptchaWaits(null), null);
    // The answer to what the person just did stays, as it does on a failure.
    const sent = { kind: 'success', text: 'Check your email for a sign-in link.' };
    const wrong = { kind: 'error', text: "That email and password don't match. Check both and try again." };
    assert.equal(noticeWhileCaptchaWaits(sent), sent);
    assert.equal(noticeWhileCaptchaWaits(wrong), wrong);
    // An unticked box times out and the widget refreshes to the same box.
    const shown = noticeWhileCaptchaWaits(captchaNotice('600010'));
    assert.equal(noticeWhileCaptchaWaits(shown), shown);
});

test('the wait ends in a token, or in a failure that says so', () => {
    const waiting = captchaNotice(CAPTCHA_WAITING);
    assert.equal(noticeAfterCaptchaToken(waiting), null);
    // The box was ticked and the check failed again: back to that wording,
    // until the widget's next retry stops on the box.
    assert.deepEqual(noticeAfterCaptchaFailure(waiting, '600010'), captchaNotice('600010'));
    assert.deepEqual(noticeWhileCaptchaWaits(captchaNotice('600010')), waiting);
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
    assert.match(turnstile, /export function Turnstile\(\{ onToken, onError, onFailure, onWaiting, onUnsupported, resetKey \}\)/);
});

// ADR-0026 amendment 4. Turnstile refuses a browser as out of date or
// unsupported through unsupported-callback and reports no error, so the
// dialog said nothing, and a submit asked for a check that browser cannot do.

test('a browser Turnstile refuses is told so, without advice that cannot help', () => {
    assert.deepEqual(captchaNotice(CAPTCHA_UNSUPPORTED), { kind: 'error', captcha: true, text: UNSUPPORTED });
    assert.match(UNSUPPORTED, /^The security check can't run in this browser: it is out of date or not supported\./);
    assert.match(UNSUPPORTED, /Update the browser, or open veyrnox\.ai in a different one\./);
    assert.match(UNSUPPORTED, /Continue with Google doesn't need the check/);
    // Neither is true here: the same browser fails again, and nothing retries.
    assert.doesNotMatch(UNSUPPORTED, /reload|retry|tick/i);
});

test('"unsupported" is not a Turnstile code: the widget cannot make the word', () => {
    // Whatever the widget hands to error-callback goes through this first.
    assert.equal(turnstileErrorCode(CAPTCHA_UNSUPPORTED), 'unknown');
    assert.notEqual(CAPTCHA_UNSUPPORTED, CAPTCHA_WAITING);
    assert.equal(turnstileFailureCopy(CAPTCHA_UNSUPPORTED), GENERIC);
});

test('a report may hold a code, "unknown" or "unsupported", and nothing else', () => {
    // ADR-0026 amendment 5: one rule for the browser and the route.
    assert.equal(turnstileReportCode(CAPTCHA_UNSUPPORTED), 'unsupported');
    for (const raw of ['600010', 600010, ' 300030 ', 'unknown', undefined, null, '', 'crashed', {}, [], '6'.repeat(40),
        'someone@example.com', '0.AbCdEf-token-shaped_string.123456', 'Unsupported', 'unsupported ', ' unsupported', 'unsupportedx']) {
        assert.equal(turnstileReportCode(raw), turnstileErrorCode(raw), String(raw));
    }
    // A wait is still not a failure and has no word of its own in the count.
    assert.equal(turnstileReportCode(CAPTCHA_WAITING), 'unknown');
});

test('an unsupported browser shows straight away, by the rule a failure follows', () => {
    const unsupported = captchaNotice(CAPTCHA_UNSUPPORTED);
    // Not the wait of amendment 3: this check cannot be passed, so the
    // dialog speaks without waiting for a submit.
    assert.deepEqual(noticeAfterCaptchaFailure(null, CAPTCHA_UNSUPPORTED), unsupported);
    assert.deepEqual(noticeAfterCaptchaFailure(captchaNotice(null), CAPTCHA_UNSUPPORTED), unsupported);
    const sent = { kind: 'success', text: 'Check your email for a sign-in link.' };
    assert.equal(noticeAfterCaptchaFailure(sent, CAPTCHA_UNSUPPORTED), sent);
    const shown = noticeAfterCaptchaFailure(null, CAPTCHA_UNSUPPORTED);
    assert.equal(noticeAfterCaptchaFailure(shown, CAPTCHA_UNSUPPORTED), shown);
    // Closing the dialog clears it like the rest.
    assert.equal(noticeAfterCaptchaToken(unsupported), null);
});

test('the widget says when Turnstile refuses the browser, and counts it', () => {
    // Counted since amendment 5. The dialog is told whatever happens to the report.
    assert.match(turnstile, /"unsupported-callback": \(\) => \{\s*reportTurnstileFailure\(CAPTCHA_UNSUPPORTED\);\s*onUnsupported\(\);\s*\},/);
    assert.doesNotMatch(turnstile, /onUnsupported\([^)]/, 'onUnsupported carries nothing');
    assert.match(turnstile, /export function Turnstile\(\{ onToken, onError, onFailure, onWaiting, onUnsupported, resetKey \}\)/);
});

test('the widget says when it shows its checkbox, and does nothing else then', () => {
    // Turnstile reports the wait here and not through error-callback.
    assert.match(turnstile, /"before-interactive-callback": \(\) => onWaiting\(\),/);
    // A wait is not a failure: no console line and no report (the tests
    // below and turnstileFailureReport.test.mjs count both).
    assert.doesNotMatch(turnstile, /onWaiting\([^)]/, 'onWaiting carries nothing');
});

test('the check itself runs as before: no option is set, and two callbacks are added', () => {
    const options = between(turnstile, 'ts.render(box.current, {', '\n                });');
    const keys = [...options.matchAll(/^ {20}"?([A-Za-z-]+)"?:/gm)].map((m) => m[1]);
    assert.deepEqual(keys, ['sitekey', 'callback', 'expired-callback', 'error-callback', 'before-interactive-callback', 'unsupported-callback']);
    assert.match(options, /sitekey: TURNSTILE_SITE_KEY,/);
    assert.doesNotMatch(options, /\.\.\./, 'no options spread in from elsewhere');
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
    assert.match(authGate, /<div role="status" aria-live="polite"/);
});

test('AuthGate remembers the wait and rewords what it is already saying', () => {
    const widget = between(authGate, '<Turnstile', '/>');
    // Remembered where the error code is, so a submit without a token says
    // the same thing, and a token or closing the dialog forgets it.
    assert.match(widget, /onWaiting=\{\(\) => \{ setCaptchaFailure\(CAPTCHA_WAITING\); setNotice\(noticeWhileCaptchaWaits\); \}\}/);
});

test('AuthGate remembers an unsupported browser and says so at once', () => {
    const widget = between(authGate, '<Turnstile', '/>');
    assert.match(widget, /onUnsupported=\{\(\) => \{ setCaptchaFailure\(CAPTCHA_UNSUPPORTED\); setNotice\(\(n\) => noticeAfterCaptchaFailure\(n, CAPTCHA_UNSUPPORTED\)\); \}\}/);
});

test('a blocked script is remembered like any other failure', () => {
    // Otherwise the next submit wiped the advice and asked the person to
    // complete a check that is not on the page.
    const widget = between(authGate, '<Turnstile', '/>');
    assert.match(widget, /onError=\{\(\) => \{ setCaptchaFailure\(CAPTCHA_BLOCKED_CODE\); setNotice\(captchaNotice\(CAPTCHA_BLOCKED_CODE\)\); \}\}/);
});

test('closing the dialog forgets what its widget reported', () => {
    // The widget unmounts with the dialog and a new one runs on reopen. The
    // old reason must not be repeated for a widget that has not failed.
    const close = between(authGate, 'const close = useCallback(', '}, [forgetCredentials]);');
    assert.match(close, /setCaptchaFailure\(null\);\s*setNotice\(noticeAfterCaptchaToken\);/);
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
