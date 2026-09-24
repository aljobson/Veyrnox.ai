import test from 'node:test';
import assert from 'node:assert/strict';
import { accountLabel } from '../app/veyrnox/_lib/account.js';

const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

test('signed out shows nothing', () => {
    assert.equal(accountLabel(null), null);
});

test('Google sign-in shows the full name', () => {
    const a = accountLabel({ user: { email: 'al@x.co', user_metadata: { full_name: 'Al Jobson' } } });
    assert.deepEqual(a, { name: 'Al Jobson', email: 'al@x.co', initial: 'A' });
});

test('email sign-up falls back to the address before the @', () => {
    const a = accountLabel({ user: { email: 'jo.smith@x.co', user_metadata: {} } });
    assert.deepEqual(a, { name: 'jo.smith', email: 'jo.smith@x.co', initial: 'J' });
});

test('a session whose user is null still names the account from the token', () => {
    // normalise() stores user: null when the auth response omits it.
    const a = accountLabel({ user: null, access_token: jwt({ email: 'sam@x.co' }) });
    assert.deepEqual(a, { name: 'sam', email: 'sam@x.co', initial: 'S' });
});

test('an unreadable token degrades to a generic label, never throws', () => {
    const a = accountLabel({ user: null, access_token: 'not-a-jwt' });
    assert.deepEqual(a, { name: 'Account', email: '', initial: 'A' });
});
