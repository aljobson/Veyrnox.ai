import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { createApprovalToken, verifyApprovalToken, approvalSigningSecret } from '../lib/social/approvalToken.js';
import { createTeamInviteToken, verifyTeamInviteToken, teamInviteSigningSecret } from '../lib/social/teamInviteToken.js';
import { createMediaProxyToken, verifyMediaProxyToken } from '../lib/social/mediaProxyToken.js';
import { createOAuthState, verifyOAuthState } from '../lib/social/oauthState.js';
import { mintPlanToken, verifyPlanToken } from '../lib/montagePlan.js';
import { signRunnerBody, verifyRunnerBody } from '../lib/montageSigning.js';

const secret = 'fixture-secret-with-more-than-32-characters';
const id = '550e8400-e29b-41d4-a716-446655440000';
const now = 1800000000;
const encode = value => Buffer.from(value).toString('base64url');
const mac = value => createHmac('sha256', secret).update(value).digest('base64url');
const token = payload => { const bytes = JSON.stringify(payload); return `${encode(bytes)}.${mac(bytes)}`; };
const cases = [
    ['approval', args => createApprovalToken({ reviewerId: id, ...args }, secret), t => verifyApprovalToken(t, secret), { r: id, e: now + 60 }, id],
    ['invite', args => createTeamInviteToken({ inviteId: id, ...args }, secret), t => verifyTeamInviteToken(t, secret), { i: id, e: now + 60 }, id],
    ['media', args => createMediaProxyToken({ r2Key: 'folder/ü +?.mp4', ...args }, secret), t => verifyMediaProxyToken(t, secret), { k: 'folder/ü +?.mp4', e: now + 60 }, 'folder/ü +?.mp4'],
];
for (const [name, create, verify, payload, result] of cases) {
    test(`${name}: exact legacy bytes, padding, malformed input and expiry`, async t => {
        t.mock.method(Date, 'now', () => now * 1000);
        const issued = token(payload);
        assert.equal(await create({ expiresInSeconds: 60 }), issued);
        assert.equal(await verify(issued), result);
        const padded = issued.split('.').map(s => s + '='.repeat((4 - s.length % 4) % 4)).join('.');
        assert.equal(await verify(padded), result);
        for (const bad of ['', '.', '!.!', issued + '.extra', issued + 'x', token({ ...payload, e: now - 1 })]) assert.equal(await verify(bad), null);
        assert.equal(await verify(token({ ...payload, e: now })), result);
    });
}
test('social domain keys, wrong keys and empty payload fields keep their distinct contracts', async t => {
    t.mock.method(Date, 'now', () => now * 1000);
    const env = { SOCIAL_OAUTH_STATE_SECRET: secret };
    const a = approvalSigningSecret(env), b = teamInviteSigningSecret(env);
    assert.equal(a, `${secret}:veyrnox:publish:approval:v1`);
    assert.equal(b, `${secret}:veyrnox:publish:team-invite:v1`);
    assert.equal(await verifyApprovalToken(await createApprovalToken({ reviewerId: id }, a), b), null);
    assert.equal(await verifyTeamInviteToken(await createTeamInviteToken({ inviteId: id }, b), a), null);
    assert.equal(await verifyMediaProxyToken(await createMediaProxyToken({ r2Key: 'a' }, secret), secret + 'x'), null);
    assert.equal(await verifyMediaProxyToken(token({ k: '', e: now + 1 }), secret), null);
    assert.equal(await verifyApprovalToken(token({ r: id, e: now + 0.5 }), secret), id);
    assert.equal(await verifyTeamInviteToken(token({ i: id, e: now + 0.5 }), secret), null);
});
test('OAuth preserves nonce, payload order, caller/network binding and malformed handling', async t => {
    t.mock.method(Date, 'now', () => now * 1000);
    t.mock.method(crypto, 'getRandomValues', bytes => bytes.fill(7));
    const args = { authId: id, network: 'youtube' };
    const payload = { a: id, n: 'youtube', e: now + 600, j: encode(Buffer.alloc(24, 7)) };
    const issued = token(payload);
    assert.equal(await createOAuthState(args, secret), issued);
    assert.equal(await verifyOAuthState(issued, args, secret), true);
    for (const bad of ['', '.', '!.!', issued + 'x', token({ ...payload, e: now - 1 }), token({ ...payload, j: '' })]) assert.equal(await verifyOAuthState(bad, args, secret), false);
    assert.equal(await verifyOAuthState(issued, { ...args, network: 'tiktok' }, secret), false);
    assert.equal(await verifyOAuthState(issued, { ...args, authId: 'other' }, secret), false);
    assert.equal(await verifyOAuthState(issued, args, secret + 'x'), false);
    assert.equal(await verifyOAuthState(issued.split('.').map(s => s + '='.repeat((4 - s.length % 4) % 4)).join('.'), args, secret), true);
});
test('montage signs the encoded payload, rejects padded signatures, and retains expiry and price checks', async t => {
    t.mock.method(crypto, 'getRandomValues', bytes => bytes.fill(7));
    const args = { secret, authId: id, brief: 'A sample brief', aspect: '9:16', credits: 20, now };
    const nonce = encode(Buffer.alloc(16, 7));
    const payload = encode(JSON.stringify({ v: 1, u: id, b: createHash('sha256').update(args.brief).digest('hex'), a: args.aspect, c: 20, n: nonce, e: now + 1800 }));
    const issued = `${payload}.${mac(payload)}`;
    assert.deepEqual(await mintPlanToken(args), { token: issued, nonce, expiresAt: now + 1800 });
    assert.deepEqual(await verifyPlanToken({ ...args, token: issued }), { ok: true, nonce });
    for (const bad of ['', '.', '!.!', issued + '=', issued + 'x']) assert.equal((await verifyPlanToken({ ...args, token: bad })).error, 'plan_invalid');
    assert.equal((await verifyPlanToken({ ...args, token: issued, secret: secret + 'x' })).error, 'plan_invalid');
    assert.equal((await verifyPlanToken({ ...args, token: issued, now: now + 1801 })).error, 'plan_expired');
    assert.equal((await verifyPlanToken({ ...args, token: issued, credits: 21 })).error, 'plan_price_changed');
});
test('runner retains exact hex and byte body, timestamp tolerance and case-sensitive verification', async () => {
    for (const body of ['', 'ü\u0000body', new Uint8Array([0, 255, 128])]) {
        const bytes = typeof body === 'string' ? Buffer.from(body) : body;
        const expected = createHmac('sha256', secret).update(`${now}.`).update(bytes).digest('hex');
        assert.equal(await signRunnerBody(secret, body, now), expected);
        assert.equal(await verifyRunnerBody(secret, body, String(now), expected, now + 300), true);
        assert.equal(await verifyRunnerBody(secret, body, String(now), expected, now + 301), false);
        assert.equal(await verifyRunnerBody(secret + 'x', body, String(now), expected, now), false);
        assert.equal(await verifyRunnerBody(secret, body, String(now), expected.toUpperCase(), now), false);
        assert.equal(await verifyRunnerBody(secret, body, '', expected, now), false);
    }
});
