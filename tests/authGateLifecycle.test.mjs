import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Both components are JSX, so these read the source, like authCaptcha.test.mjs.
const turnstile = readFileSync(new URL('../components/Turnstile.jsx', import.meta.url), 'utf8');
const authGate = readFileSync(new URL('../components/AuthGate.jsx', import.meta.url), 'utf8');

test('destroying the widget clears the token it issued', () => {
    // AuthGate keeps its token state while the modal is closed, but the widget
    // unmounts with it. A token that outlives its widget was sent on the next
    // submit and failed as captcha_failed (production, 2026-09-21 10:20 UTC).
    // The mount effect's cleanup is the one place that runs on every unmount.
    const cleanup = turnstile.slice(turnstile.indexOf('return () => {'), turnstile.indexOf('};', turnstile.indexOf('return () => {')));
    assert.ok(cleanup.length > 0, 'mount effect cleanup not found');
    assert.match(cleanup, /\.remove\(/, 'cleanup should still remove the widget');
    assert.match(cleanup, /onToken\(null\)/, 'cleanup must clear the token it issued');
});

// AuthGate is mounted once in the root layout and never unmounts, so anything
// left in its state is still there the next time it opens.
const code = authGate.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const body = (start) => {
    const from = code.indexOf(start);
    assert.ok(from >= 0, `${start} not found`);
    return code.slice(from, code.indexOf('\n    }', from));
};

test('one helper empties the email, the password and the Show toggle', () => {
    const forget = body('const forgetCredentials = useCallback(');
    assert.match(forget, /setEmail\(""\)/);
    assert.match(forget, /setPassword\(""\)/);
    assert.match(forget, /setShowPassword\(false\)/);
    // Nothing else may put a value back: only the input's own onChange.
    assert.deepEqual([...new Set(code.match(/setPassword\([^)]*\)/g))], ['setPassword("")', 'setPassword(e.target.value)']);
    assert.deepEqual([...new Set(code.match(/setEmail\([^)]*\)/g))], ['setEmail("")', 'setEmail(e.target.value)']);
});

test('every way the dialog closes goes through it', () => {
    assert.match(body('const close = useCallback('), /setOpen\(false\);\s*forgetCredentials\(\);/);
    // Dismiss (the × button and Escape) and each successful sign-in.
    assert.match(code, /const dismiss = close;/);
    assert.equal((code.match(/setOpen\(false\)/g) || []).length, 1, 'no path closes the dialog and keeps what was typed');
    assert.match(body('async function startPasskey('), /if \(session\) close\(\);/);
    const submit = body('async function handleSubmit(');
    assert.match(submit, /await signInWithPassword\(email, password, captcha\);\s*close\(\);/);
    assert.match(submit, /else if \(session\) \{\s*close\(\);/);
});

test('a session that starts or ends anywhere empties the fields', () => {
    const effect = body('return onSessionChange(');
    assert.match(effect, /if \(signedIn\) close\(\);/);
    // Only on a change: a repeated "signed out" notice (a second 401 while the
    // dialog is open) must not wipe what the user is typing.
    assert.match(effect, /else if \(wasSignedIn\.current\) forgetCredentials\(\);/);
    assert.match(effect, /wasSignedIn\.current = signedIn;/);
});

test('a sent form does not keep the password while it waits on an email', () => {
    const submit = body('async function handleSubmit(');
    assert.match(submit, /if \(needsConfirmation\) \{\s*setPassword\(""\);/);
    assert.match(submit, /await sendMagicLink\(email, captcha\);\s*setPassword\(""\);/);
});

test('neither value is logged', () => {
    for (const line of code.split('\n').filter((l) => /console\./.test(l))) {
        assert.doesNotMatch(line, /\b(email|password)\b/, line.trim());
    }
});

test('sign-up warns about breached passwords before the first attempt', () => {
    assert.match(authGate, /mode === "sign_up"\s*\?\s*"At least 8 characters\. Passwords found in data breaches are rejected/);
    assert.match(authGate, /aria-describedby="vx-password-hint"/);
    assert.match(authGate, /id="vx-password-hint"/);
});
