import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c)}`));

Object.assign(process.env, {
  SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test', ACCOUNT_READ_RATE_LIMIT_ENABLED: 'true',
  PUBLISH_QUEUES_ENABLED: 'true', PUBLISH_RUNTIME_FLAGS: '{"teams":"true","smartlinks":"true","plans":"true","inbox":"true"}',
});

const activityRoute = await import('../app/api/v1/social/activity/route.js');
const queueRoute = await import('../app/api/v1/social/queues/route.js');
const smartlinkRoute = await import('../app/api/v1/social/smartlink/route.js');
const auth = '11111111-1111-4111-8111-111111111111';
const brand = '22222222-2222-4222-8222-222222222222';
const ownerAuth = '33333333-3333-4333-8333-333333333333';
const account = '44444444-4444-4444-8444-444444444444';
let calls = [];

function request(path, method = 'GET', body, selected = brand) {
  return new Request(`https://veyrnox.test/api/v1${path}`, { method, headers: {
    'x-veyrnox-auth-id': auth, 'x-publish-brand-id': selected, ...(body ? { 'content-type': 'application/json' } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
function stub(role = 'editor', overrides = {}) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const name = new URL(url).pathname.split('/').pop(); const args = JSON.parse(init.body); calls.push({ name, args });
    const defaults = {
      consume_account_read_request: { ok: true }, consume_social_post_write_request: { ok: true },
      get_social_brand_access: { ok: true, brand_id: brand, label: 'Studio', role, owner_auth_id: ownerAuth, paid: true },
      list_social_publish_activity: { ok: true, actor_role: role, events: [{ id: account, source: 'publish', action: 'save_smartlink', actor_email: 'manager@test.veyrnox.ai', detail: {}, created_at: '2026-10-14T12:00:00Z' }] },
      save_social_publish_queue: { ok: true, queue_id: account }, save_social_smartlink: { ok: true, smartlink_id: account },
    };
    return Response.json(overrides[name] ?? defaults[name]);
  };
}

test('manager can read the selected brand activity without receiving owner identity', async () => {
  stub('manager');
  const response = await activityRoute.GET(request('/social/activity?limit=50'));
  assert.equal(response.status, 200); const body = await response.json();
  assert.equal(body.events[0].actor_email, 'manager@test.veyrnox.ai');
  assert.equal(JSON.stringify(body).includes(ownerAuth), false);
  assert.deepEqual(calls.map((call) => call.name), ['consume_account_read_request', 'get_social_brand_access', 'list_social_publish_activity']);
  assert.equal(calls.at(-1).args.p_auth_id, auth);
});

test('editor saves queue and SmartLink as the acting teammate', async () => {
  stub('editor');
  const queue = await queueRoute.PUT(request('/social/queues', 'PUT', { name: 'Editorial', timezone: 'UTC', accountIds: [account], enabled: true, slots: [{ weekday: 2, minute: 600 }] }));
  assert.equal(queue.status, 200);
  assert.equal(calls.find((call) => call.name === 'save_social_publish_queue').args.p_auth_id, auth);
  stub('editor');
  const smartlink = await smartlinkRoute.PUT(request('/social/smartlink', 'PUT', { slug: 'studio-links', title: 'Studio', bio: '', avatarUrl: '', theme: 'midnight', published: false, items: [] }));
  assert.equal(smartlink.status, 200);
  assert.equal(calls.find((call) => call.name === 'save_social_smartlink').args.p_auth_id, auth);
});

test('read-only team roles are rejected before delegated mutation RPCs', async () => {
  stub('analyst');
  const response = await queueRoute.PUT(request('/social/queues', 'PUT', { name: 'Editorial', timezone: 'UTC', accountIds: [account], enabled: true, slots: [{ weekday: 2, minute: 600 }] }));
  assert.equal(response.status, 403);
  assert.equal(calls.some((call) => call.name === 'save_social_publish_queue'), false);
});
