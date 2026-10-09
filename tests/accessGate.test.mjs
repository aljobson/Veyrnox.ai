import test from 'node:test';
import assert from 'node:assert/strict';

import { verifyAccessJwt, requireAccess, requireDashboardAccess, _resetCertsCache, CERTS_MISS_REFRESH_MS } from '../lib/accessJwt.js';

const TEAM = 'fancy-lake-7c60.cloudflareaccess.com';
const AUD = 'a'.repeat(64);
const ENV = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

async function keypair(kid = 'kid-1') {
    const pair = await crypto.subtle.generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
        true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    return { pair, jwk: { kty: 'RSA', n: jwk.n, e: jwk.e, kid, alg: 'RS256' } };
}

async function mint({ pair, jwk }, over = {}) {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', kid: jwk.kid, typ: 'JWT' };
    const payload = { iss: `https://${TEAM}`, aud: [AUD], exp: now + 300, iat: now, common_name: 'veyrnox-cron', ...over };
    const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
    const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, pair.privateKey, new TextEncoder().encode(body));
    return `${body}.${b64url(new Uint8Array(sig))}`;
}

function stubCerts(jwks) {
    globalThis.fetch = async (url) => {
        assert.ok(String(url).endsWith('/cdn-cgi/access/certs'), String(url));
        return Response.json({ keys: jwks });
    };
}

/** A key set that can change between fetches, and a count of the fetches. */
function servedCerts(first) {
    const state = { keys: first, calls: 0, down: false };
    globalThis.fetch = async () => {
        state.calls++;
        if (state.down) throw new Error('ECONNRESET');
        return Response.json({ keys: state.keys.map((k) => k.jwk) });
    };
    return state;
}

const external = (headers) => new Request('https://veyrnox.ai/api/admin/reap-assets', {
    method: 'POST', headers: { 'cf-ray': '8f0a1b2c3d4e5f60-LHR', ...headers },
});

test.beforeEach(() => _resetCertsCache());

test('a valid Access assertion verifies; a forged or foreign one does not', async () => {
    const k = await keypair();
    stubCerts([k.jwk]);
    const payload = await verifyAccessJwt(await mint(k), { teamDomain: TEAM, aud: AUD });
    assert.equal(payload.common_name, 'veyrnox-cron');

    // Signed by a key Access does not publish.
    const other = await keypair('kid-1');
    stubCerts([k.jwk]);
    await assert.rejects(verifyAccessJwt(await mint(other), { teamDomain: TEAM, aud: AUD }), { reason: 'signature' });
});

test('refuses the wrong audience, the wrong issuer, an expired token and alg=none', async () => {
    const k = await keypair();
    stubCerts([k.jwk]);
    const cases = [
        [{ aud: ['b'.repeat(64)] }, 'audience'],
        [{ iss: 'https://evil.cloudflareaccess.com' }, 'issuer'],
        [{ exp: Math.floor(Date.now() / 1000) - 60 }, 'expired'],
    ];
    for (const [over, reason] of cases) {
        await assert.rejects(verifyAccessJwt(await mint(k, over), { teamDomain: TEAM, aud: AUD }), { reason }, reason);
    }
    // An unsigned token, the classic downgrade.
    const now = Math.floor(Date.now() / 1000);
    const none = `${b64url(JSON.stringify({ alg: 'none', kid: 'kid-1' }))}.${b64url(JSON.stringify({ iss: `https://${TEAM}`, aud: [AUD], exp: now + 300 }))}.`;
    await assert.rejects(verifyAccessJwt(none, { teamDomain: TEAM, aud: AUD }), { reason: 'alg' });
});

test('an external request without a valid assertion is refused once Access is configured', async () => {
    const k = await keypair();
    stubCerts([k.jwk]);
    assert.deepEqual(await requireAccess(external({}), ENV), { ok: false }, 'no assertion');
    assert.deepEqual(await requireAccess(external({ 'cf-access-jwt-assertion': 'not.a.jwt' }), ENV), { ok: false });

    const good = await requireAccess(external({ 'cf-access-jwt-assertion': await mint(k) }), ENV);
    assert.equal(good.ok, true);
    assert.equal(good.via, 'access');
    assert.equal(good.subject, 'veyrnox-cron');
});

// The dashboard gate turns a service token away (ADR-0078). This one is what
// the service token is for, and it does not care which kind it is shown.
test('the machine endpoints take a service token\'s assertion and a person\'s alike', async () => {
    const k = await keypair();
    stubCerts([k.jwk]);
    const service = await requireAccess(external({ 'cf-access-jwt-assertion': await mint(k, { common_name: 'e367826f93b8d71185e03fe518aff3b4.access', sub: '' }) }), ENV);
    assert.deepEqual(service, { ok: true, via: 'access', subject: 'e367826f93b8d71185e03fe518aff3b4.access' });
    const person = await requireAccess(external({ 'cf-access-jwt-assertion': await mint(k, { common_name: undefined, email: 'owner@example.test', sub: 'access-user' }) }), ENV);
    assert.deepEqual(person, { ok: true, via: 'access', subject: 'access-user' });
});

test('the Worker cron is internal: no cf-ray, so it passes the door and still needs its token', async () => {
    const internal = new Request('https://veyrnox.ai/api/admin/top-up-backfill', { method: 'POST' });
    assert.deepEqual(await requireAccess(internal, ENV), { ok: true, via: 'internal' });
});

test('with Access unconfigured the endpoint still answers, and says so in the log', async () => {
    const said = [];
    const realError = console.error;
    console.error = (...a) => said.push(a.join(' '));
    try {
        const r = await requireAccess(external({}), { });
        assert.deepEqual(r, { ok: true, via: 'unconfigured' });
    } finally { console.error = realError; }
    assert.match(said.join('\n'), /reachable from the internet behind its shared secret alone/);
});

// Access rotates its signing key on its own schedule. A warm isolate holds
// the old key set for up to an hour, so a miss asks once more before refusing.
test('a key Access rotated in is picked up by one more fetch of the key set', async () => {
    const k1 = await keypair('kid-1');
    const k2 = await keypair('kid-2');
    const served = servedCerts([k1]);
    await verifyAccessJwt(await mint(k1), { teamDomain: TEAM, aud: AUD });
    assert.equal(served.calls, 1);

    served.keys = [k1, k2];
    const payload = await verifyAccessJwt(await mint(k2), { teamDomain: TEAM, aud: AUD });
    assert.equal(payload.common_name, 'veyrnox-cron');
    assert.equal(served.calls, 2, 'the first load and one refetch');
    // The refreshed set is the cached one: no fetch per request afterwards.
    await verifyAccessJwt(await mint(k2), { teamDomain: TEAM, aud: AUD });
    await verifyAccessJwt(await mint(k1), { teamDomain: TEAM, aud: AUD });
    assert.equal(served.calls, 2);
});

test('both gates accept an assertion signed by the rotated key', async () => {
    const k1 = await keypair('kid-1');
    const k2 = await keypair('kid-2');
    for (const gate of [requireAccess, requireDashboardAccess]) {
        _resetCertsCache();
        const served = servedCerts([k1]);
        assert.equal((await gate(external({ 'cf-access-jwt-assertion': await mint(k1, { email: 'owner@example.test', sub: 'access-user', common_name: undefined }) }), ENV)).ok, true);
        served.keys = [k2];
        const res = await gate(external({ 'cf-access-jwt-assertion': await mint(k2, { email: 'owner@example.test', sub: 'access-user', common_name: undefined }) }), ENV);
        assert.equal(res.ok, true, gate.name);
        assert.equal(served.calls, 2, gate.name);
    }
});

test('a key the fresh set still does not hold is refused, and a stream of them fetches once a minute at most', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const k1 = await keypair('kid-1');
    const stranger = await keypair('kid-9');
    const served = servedCerts([k1]);
    await verifyAccessJwt(await mint(k1), { teamDomain: TEAM, aud: AUD });

    const forged = await mint(stranger);
    for (let i = 0; i < 5; i++) {
        await assert.rejects(verifyAccessJwt(forged, { teamDomain: TEAM, aud: AUD }), { reason: 'kid' });
    }
    assert.equal(served.calls, 2, 'the first load and one refetch for five misses');
    // Still refused at the gate, and the published key still verifies.
    assert.deepEqual(await requireAccess(external({ 'cf-access-jwt-assertion': forged }), ENV), { ok: false });
    await verifyAccessJwt(await mint(k1), { teamDomain: TEAM, aud: AUD });
    assert.equal(served.calls, 2);

    // The window reopens: one more fetch, and the answer is the same.
    t.mock.timers.tick(CERTS_MISS_REFRESH_MS - 1);
    await assert.rejects(verifyAccessJwt(forged, { teamDomain: TEAM, aud: AUD }), { reason: 'kid' });
    assert.equal(served.calls, 2);
    t.mock.timers.tick(1);
    await assert.rejects(verifyAccessJwt(forged, { teamDomain: TEAM, aud: AUD }), { reason: 'kid' });
    await assert.rejects(verifyAccessJwt(forged, { teamDomain: TEAM, aud: AUD }), { reason: 'kid' });
    assert.equal(served.calls, 3);
});

test('a refetch that fails keeps the key set already held', async () => {
    const k1 = await keypair('kid-1');
    const k2 = await keypair('kid-2');
    const served = servedCerts([k1]);
    await verifyAccessJwt(await mint(k1), { teamDomain: TEAM, aud: AUD });

    served.down = true;
    await assert.rejects(verifyAccessJwt(await mint(k2), { teamDomain: TEAM, aud: AUD }), { reason: 'kid' });
    assert.equal(served.calls, 2);
    const payload = await verifyAccessJwt(await mint(k1), { teamDomain: TEAM, aud: AUD });
    assert.equal(payload.common_name, 'veyrnox-cron');
});
