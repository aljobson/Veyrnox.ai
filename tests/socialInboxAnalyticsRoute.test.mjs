import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c)}`));
const { GET } = await import('../app/api/v1/social/inbox/analytics/route.js');

const auth = '11111111-1111-4111-8111-111111111111';
const brand = '22222222-2222-4222-8222-222222222222';
const account = '33333333-3333-4333-8333-333333333333';
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only',
  ACCOUNT_READ_RATE_LIMIT_ENABLED: 'true', PUBLISH_RUNTIME_FLAGS: '{"plans":"true","inbox":"true"}' });

const request = (query = '', identity = auth) => new Request(`https://veyrnox.test/api/v1/social/inbox/analytics${query}`, { headers: { 'x-veyrnox-auth-id': identity } });
let calls;
function stub(results = {}) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const name = new URL(url).pathname.split('/').pop();
    calls.push({ name, args: JSON.parse(init.body) });
    return Response.json(results[name] ?? ({ consume_account_read_request: { ok: true },
      get_or_create_default_social_brand: { ok: true, brand_id: brand },
      get_social_inbox_analytics: { ok: true, range_days: 7, since: '2026-10-08T00:00:00Z',
        summary: { conversations: 2, received: 3, sent: 2, failed: 1, read_actions: 2, median_response_seconds: 90 },
        trend: [{ date: '2026-10-14', received: 3, sent: 2, failed: 1 }],
        platforms: [{ network: 'instagram', received: 3, sent: 2, failed: 1 }],
        heatmap: [{ weekday: 3, hour: 10, received: 3 }] } })[name]);
  };
}

test('returns paid inbox analytics for the selected account and period', async () => {
  stub();
  const response = await GET(request(`?accountId=${account}&days=7`));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { range_days: 7, since: '2026-10-08T00:00:00Z',
    summary: { conversations: 2, received: 3, sent: 2, failed: 1, read_actions: 2, median_response_seconds: 90 },
    trend: [{ date: '2026-10-14', received: 3, sent: 2, failed: 1 }],
    platforms: [{ network: 'instagram', received: 3, sent: 2, failed: 1 }],
    heatmap: [{ weekday: 3, hour: 10, received: 3 }] });
  assert.deepEqual(calls.at(-1), { name: 'get_social_inbox_analytics', args: {
    p_auth_id: auth, p_brand_id: brand, p_account_id: account, p_days: 7,
  } });
});

test('rejects malformed identities and filters before reading storage', async () => {
  for (const [query, identity] of [['', 'bad'], ['?days=14', auth], ['?accountId=bad', auth], ['?days=7.5', auth]]) {
    stub();
    const response = await GET(request(query, identity));
    assert.equal(response.status, identity === 'bad' ? 401 : 400);
    assert.equal(calls.length, 0);
  }
});

test('maps analytics plan and account boundaries to stable responses', async () => {
  stub({ get_social_inbox_analytics: { ok: false, code: 'PLAN_REQUIRED' } });
  assert.equal((await GET(request())).status, 402);
  stub({ get_social_inbox_analytics: { ok: false, code: 'ACCOUNT_NOT_FOUND' } });
  assert.equal((await GET(request())).status, 404);
});
