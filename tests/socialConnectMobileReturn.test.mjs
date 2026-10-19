import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/social/connect/mobile/[network]/route.js';
import { connectCallbackPath, requestedClient, APP_CONNECT_CALLBACK } from '../lib/social/connectReturn.js';
import { SOCIAL_NETWORKS } from '../lib/social/networks.js';

const STATE = `${'a'.repeat(40)}.${'b'.repeat(43)}`;
const call = (network, query) => GET(new Request(`https://veyrnox.test/social/connect/mobile/${network}${query}`), { params: Promise.resolve({ network }) });

test('the bridge forwards a code and signed state to the fixed app address, nothing else', async () => {
    const res = await call('twitter', `?code=abc_DEF-123&state=${STATE}&next=https://evil.test&redirect_uri=x`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), `${APP_CONNECT_CALLBACK}?network=twitter&code=abc_DEF-123&state=${STATE}`);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
});

test('provider codes with punctuation survive, encoded', async () => {
    const res = await call('tiktok', `?code=${encodeURIComponent('ab*c!d#_e')}&state=${STATE}`);
    assert.equal(new URL(res.headers.get('location')).searchParams.get('code'), 'ab*c!d#_e');
});

test('every OAuth network is accepted; Bluesky (no OAuth) and unknown names are not', async () => {
    for (const n of SOCIAL_NETWORKS.filter((x) => !x.credentials)) {
        assert.match((await call(n.key, `?code=x&state=${STATE}`)).headers.get('location'), /code=x/, n.key);
    }
    for (const n of ['bluesky', 'evil', '..%2Fx', '']) {
        assert.equal((await call(n, `?code=x&state=${STATE}`)).headers.get('location'), `${APP_CONNECT_CALLBACK}?error=unknown_network`, n);
    }
});

test('odd or missing input gives a fixed error word, and a provider error word is kept', async () => {
    for (const q of ['', '?code=x', `?state=${STATE}`, `?code=x&state=forged`, `?code=${'a'.repeat(2049)}&state=${STATE}`, `?code=a%0d%0ab&state=${STATE}`, '?error=<script>']) {
        assert.equal((await call('twitter', q)).headers.get('location'), `${APP_CONNECT_CALLBACK}?network=twitter&error=invalid_request`, q);
    }
    assert.equal((await call('twitter', '?error=access_denied')).headers.get('location'), `${APP_CONNECT_CALLBACK}?network=twitter&error=access_denied`);
});

test('the redirect path is a constant per client, and the client is a closed enum', () => {
    assert.equal(connectCallbackPath('gmb', 'web'), '/social/connect/callback/gmb');
    assert.equal(connectCallbackPath('gmb', 'mobile'), '/social/connect/mobile/gmb');
    assert.equal(requestedClient({}), 'web');
    assert.equal(requestedClient(null), 'web');
    assert.equal(requestedClient({ client: 'mobile' }), 'mobile');
    for (const bad of ['', 'ios', null, 0, {}, 'MOBILE']) assert.equal(requestedClient({ client: bad }), null, String(bad));
});
