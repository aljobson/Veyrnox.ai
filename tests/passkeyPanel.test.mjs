import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PASSKEY_NAME_MAX, cleanPasskeyName, passkeyLabel, passkeyDates, usablePasskeys, passkeyErrorCopy,
} from '../app/veyrnox/_lib/passkeyList.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('a passkey name is trimmed, collapsed, stripped of control characters and capped', () => {
  assert.equal(cleanPasskeyName('  My\tMac  Book \n'), 'My Mac Book');
  assert.equal(cleanPasskeyName('a\u0000b\u007fc'), 'abc');
  assert.equal(cleanPasskeyName(null), '');
  assert.equal(cleanPasskeyName('x'.repeat(200)).length, PASSKEY_NAME_MAX);
});

test('a passkey without a name is still labelled', () => {
  assert.equal(passkeyLabel({ friendly_name: 'iCloud Keychain' }), 'iCloud Keychain');
  assert.equal(passkeyLabel({ friendly_name: '   ' }), 'Passkey');
  assert.equal(passkeyLabel({}), 'Passkey');
  assert.equal(passkeyLabel(null), 'Passkey');
});

test('dates read plainly and survive missing or bad values', () => {
  assert.equal(passkeyDates({ created_at: '2026-10-03T12:00:00Z', last_used_at: '2026-10-04T09:00:00Z' }), 'Added 3 Oct 2026 · last used 4 Oct 2026');
  assert.equal(passkeyDates({ created_at: '2026-10-03T12:00:00Z' }), 'Added 3 Oct 2026 · never used');
  assert.equal(passkeyDates({ created_at: 'nonsense' }), 'never used');
});

test('only rows with an id are listed, whatever shape arrives', () => {
  assert.deepEqual(usablePasskeys([{ id: 'a' }, { id: '' }, null, { friendly_name: 'x' }, { id: 7 }]), [{ id: 'a' }]);
  assert.deepEqual(usablePasskeys(undefined), []);
  assert.deepEqual(usablePasskeys({ passkeys: [] }), []);
});

test('errors become user wording and never echo the server message', () => {
  const secret = 'pq: relation "auth.webauthn_credentials" violates constraint';
  for (const err of [
    { status: 401, message: 'This endpoint requires a valid Bearer token' },
    { message: 'not signed in' },
    { status: 400, message: 'passkey_disabled' },
    { status: 429, message: 'rate limit exceeded' },
    { name: 'InvalidStateError', message: 'The authenticator was previously registered' },
    { name: 'SecurityError', message: 'The relying party ID is not a registrable domain suffix' },
    { status: 500, message: secret },
    undefined,
  ]) {
    const copy = passkeyErrorCopy(err);
    assert.ok(copy.length > 10, String(err?.message));
    assert.ok(!copy.includes(err?.message ?? '\u0000'), `echoed: ${err?.message}`);
  }
  assert.match(passkeyErrorCopy({ status: 401 }), /Sign in again/);
  assert.match(passkeyErrorCopy({ name: 'InvalidStateError' }), /already has a passkey/);
  assert.match(passkeyErrorCopy({ status: 500, message: secret }), /did not complete/);
});

test('MFA-protected passkey management explains how to unlock the session', () => {
  const expected = 'Unlock this session with your authenticator code under Two-factor authentication, then try again.';
  assert.equal(passkeyErrorCopy({ status: 403, code: 'insufficient_aal' }), expected);
  assert.equal(passkeyErrorCopy({ status: 403, message: 'AAL2 session is required to manage passkeys when MFA is enabled' }), expected);
  assert.match(passkeyErrorCopy({ status: 403, message: 'Other forbidden operation' }), /did not complete/);
});

test('the panel is on the Account page and follows the project setting', () => {
  const page = read('app/veyrnox/app/account/page.js');
  assert.match(page, /<MfaPanel \/>\n\s*<PasskeyPanel \/>/);
  const panel = read('app/veyrnox/_components/PasskeyPanel.js');
  // Hidden unless Supabase reports passkeys on, like the sign-in button.
  assert.match(panel, /const on = !!data\?\.passkeys_enabled;/);
  assert.match(panel, /if \(!enabled\) return null;/);
  // A dismissed browser prompt (null) is not reported as a failure.
  assert.match(panel, /if \(created\) \{/);
  // Removal is confirmed first, and listing still works where creation cannot.
  assert.match(panel, /<ConfirmDialog/);
  assert.match(panel, /canCreate \? \(/);
  // No raw server text reaches the page.
  assert.doesNotMatch(panel, /err\??\.message/);
  // The banned library stays off the import graph.
  assert.doesNotMatch(panel + read('app/veyrnox/_lib/passkeyList.js'), /supabase-js/);
});
