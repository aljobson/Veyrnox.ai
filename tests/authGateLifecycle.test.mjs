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

test('sign-up warns about breached passwords before the first attempt', () => {
    assert.match(authGate, /mode === "sign_up"\s*\?\s*"At least 8 characters\. Passwords found in data breaches are rejected/);
    assert.match(authGate, /aria-describedby="vx-password-hint"/);
    assert.match(authGate, /id="vx-password-hint"/);
});
