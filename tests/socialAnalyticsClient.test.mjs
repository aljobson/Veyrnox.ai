import test from 'node:test';
import assert from 'node:assert/strict';

const localStore = new Map([['veyrnox_supabase_session', JSON.stringify({
    access_token: 'live-token', refresh_token: null,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'user-1' },
})]]);
globalThis.localStorage = {
    getItem: (key) => localStore.get(key) || null,
    setItem: (key, value) => localStore.set(key, String(value)),
    removeItem: (key) => localStore.delete(key),
};
globalThis.window = { dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
globalThis.CustomEvent = class CustomEvent { constructor(type) { this.type = type; } };

const { getSocialAnalytics } = await import('../app/lib/socialAnalyticsClient.js');

test('identical analytics reads in flight share one gateway request', async () => {
    const calls = [];
    let release;
    globalThis.fetch = (url, init) => {
        calls.push({ url: String(url), init });
        return new Promise((resolve) => { release = () => resolve(new Response(JSON.stringify({ account: { id: 'account-1' }, evolution: [], posts: [] }), {
            status: 200, headers: { 'content-type': 'application/json' },
        })); });
    };
    const args = { accountId: 'account-1', from: '2026-10-01', to: '2026-10-14' };
    const first = getSocialAnalytics(args);
    const second = getSocialAnalytics(args);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls.length, 1);
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.deepEqual(a, b);
    assert.equal(calls[0].url, '/api/v1/social/analytics?accountId=account-1&from=2026-10-01&to=2026-10-14');
});
