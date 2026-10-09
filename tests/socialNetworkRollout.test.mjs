import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { networkReleased, networkEnabled, SOCIAL_NETWORKS } from '../lib/social/networks.js';
import { networkReadiness } from '../lib/social/networkReadiness.js';
import { postCapabilityError } from '../lib/social/postCapabilities.js';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
const auth = '11111111-1111-4111-8111-111111111111';
const env = {
    PUBLIC_HOST: 'https://veyrnox.test', SOCIAL_OAUTH_STATE_SECRET: 'test-state',
    SOCIAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    PUBLISH_RELEASED_NETWORKS: 'youtube', PUBLISH_EXTENDED_NETWORKS_ENABLED: 'true',
    YOUTUBE_CLIENT_ID: '123456-test.apps.googleusercontent.com', YOUTUBE_CLIENT_SECRET: 'test-secret',
    TIKTOK_CLIENT_KEY: 'testclientkey', TIKTOK_CLIENT_SECRET: 'test-secret',
};
test('YouTube-only release overrides configured TikTok and extended platforms', () => {
    const ready = networkReadiness(env);
    assert.equal(networkReadiness({ ...env, PUBLISH_RELEASED_NETWORKS: '*' }).find(n => n.key === 'tiktok').available, true);
    assert.equal(ready.find(n => n.key === 'youtube').available, true);
    for (const n of ready.filter(n => n.key !== 'youtube')) {
        assert.equal(n.available, false, n.key);
        assert.equal(n.status, 'not_released', n.key);
    }
    assert.equal(postCapabilityError([{ network: 'tiktok' }], [{ media_type: 'image' }], 'test', env), 'network_unavailable');
    assert.equal(postCapabilityError([{ network: 'youtube' }], [{ media_type: 'video' }], 'test', env), null);
});
test('unset preserves existing releases; explicit empty or unknown lists fail closed', () => {
    for (const n of SOCIAL_NETWORKS) assert.equal(networkReleased(n.key, {}), true);
    for (const value of ['', 'unknown', 'YouTube']) assert.equal(networkReleased('youtube', { PUBLISH_RELEASED_NETWORKS: value }), false);
    assert.equal(networkReleased('unknown', { PUBLISH_RELEASED_NETWORKS: '*' }), false);
    assert.equal(networkReleased('youtube', { PUBLISH_RELEASED_NETWORKS: ' instagram, youtube ' }), true);
    assert.equal(networkReleased('tiktok', { PUBLISH_RELEASED_NETWORKS: ' instagram, youtube ' }), false);
    assert.equal(networkEnabled('bluesky', { PUBLISH_RELEASED_NETWORKS: '*' }), false);
    assert.equal(networkEnabled('bluesky', { PUBLISH_RELEASED_NETWORKS: '*', PUBLISH_EXTENDED_NETWORKS_ENABLED: 'true' }), true);
});
test('direct connect and callback requests cannot bypass the release list or contact providers', async () => {
    const saved = process.env.PUBLISH_RELEASED_NETWORKS;
    const fetcher = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('must not contact provider or database'); };
    process.env.PUBLISH_RELEASED_NETWORKS = '';
    try {
        for (const n of SOCIAL_NETWORKS) {
            for (const action of n.key === 'bluesky' ? ['connect'] : ['connect', 'callback']) {
                const { POST } = await import(`../app/api/v1/social/accounts/${n.key}/${action}/route.js`);
                const res = await POST(new Request(`https://veyrnox.test/api/v1/social/accounts/${n.key}/${action}`, {
                    method: 'POST', headers: { 'x-veyrnox-auth-id': auth, 'content-type': 'application/json' }, body: '{}',
                }));
                assert.equal(res.status, 404, `${n.key}/${action}`);
                assert.equal((await res.json()).error, 'network_unavailable');
            }
        }
        assert.equal(calls, 0);
    } finally {
        globalThis.fetch = fetcher;
        if (saved === undefined) delete process.env.PUBLISH_RELEASED_NETWORKS; else process.env.PUBLISH_RELEASED_NETWORKS = saved;
    }
});
