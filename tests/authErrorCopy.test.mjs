import english from '../lib/i18n/messages/en.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// AuthGate maps GoTrue's developer-facing messages to plain English, first
// match wins, and anything unmatched becomes "That didn't work. Try again."
// The component is JSX, so read its source and rebuild the same table rather
// than importing it — the pattern tests/authCaptcha.test.mjs already uses.
const src = readFileSync(new URL('../components/AuthGate.jsx', import.meta.url), 'utf8');
const table = src.slice(src.indexOf('const AUTH_ERROR_COPY ='), src.indexOf('function humanAuthError'));
const entries = [...table.matchAll(/\[\/(.+?)\/([a-z]*),\s*t\("([^"]+)"\)\]/g)].map(([, body, flags, copy]) => [new RegExp(body, flags), english[copy]]);

function human(message) {
    const hit = entries.find(([re]) => re.test(message));
    return hit ? hit[1] : null;
}

test('the map parsed', () => {
    assert.ok(entries.length >= 8, `expected the full table, parsed ${entries.length}`);
});

test('a breached password says so instead of the generic fallback', () => {
    // Verbatim from the production auth log, 2026-09-21: a real sign-up that
    // showed "That didn't work. Try again." and gave no clue why.
    const gotrue = 'Password is known to be weak and easy to guess, please choose a different one.';
    const copy = human(gotrue);
    assert.ok(copy, 'the weak-password message fell through to the generic fallback');
    assert.match(copy, /data breach/);
});

test('the existing mappings still win for their own messages', () => {
    assert.match(human('Invalid login credentials'), /don't match/);
    assert.match(human('Password should be at least 8 characters.'), /at least 8/);
    assert.match(human('captcha protection: request disallowed (invalid-input-response)'), /security check/);
});

test('a sign-up refused by the disposable-email trigger says what to do', () => {
    // GoTrue's wording when a trigger on auth.users raises (migration 0343).
    const copy = human('Database error saving new user');
    assert.ok(copy, 'the trigger refusal fell through to the generic fallback');
    assert.match(copy, /permanent/);
});
