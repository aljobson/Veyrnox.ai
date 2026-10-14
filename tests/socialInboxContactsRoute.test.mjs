import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c)}`));
const { GET, PATCH, POST } = await import('../app/api/v1/social/contacts/route.js');

const auth = '11111111-1111-4111-8111-111111111111';
const brand = '22222222-2222-4222-8222-222222222222';
const account = '33333333-3333-4333-8333-333333333333';
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only',
  ACCOUNT_READ_RATE_LIMIT_ENABLED: 'true', PUBLISH_RUNTIME_FLAGS: '{"plans":"true","inbox":"true"}' });
let calls;
function stub(results = {}) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const name = new URL(url).pathname.split('/').pop();
    calls.push({ name, args: JSON.parse(init.body) });
    return Response.json(results[name] ?? ({
      consume_account_read_request: { ok: true }, consume_social_post_write_request: { ok: true },
      get_or_create_default_social_brand: { ok: true, brand_id: brand, role: 'owner' },
      list_social_inbox_contacts: { ok: true, contacts: [{ external_id: 'person-1', tags: [] }] },
      update_social_inbox_contact: { ok: true, tags: ['vip'], subscription_status: 'subscribed' },
      import_social_inbox_contacts: { ok: true, imported: 2 },
    })[name]);
  };
}
const request = (query = '', identity = auth) => new Request(`https://veyrnox.test/api/v1/social/contacts${query}`, { headers: { 'x-veyrnox-auth-id': identity } });

test('lists filtered contacts for a paid inbox brand', async () => {
  stub();
  const response = await GET(request(`?accountId=${account}&network=instagram&subscriptionStatus=subscribed&search=alex&tag=vip`));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { contacts: [{ external_id: 'person-1', tags: [] }], brandRole: 'owner' });
  assert.deepEqual(calls.at(-1), { name: 'list_social_inbox_contacts', args: { p_auth_id: auth, p_brand_id: brand,
    p_account_id: account, p_network: 'instagram', p_subscription_status: 'subscribed', p_search: 'alex', p_tag: 'vip' } });
});

test('rejects malformed contact filters before storage is read', async () => {
  for (const [query, identity] of [['', 'bad'], ['?accountId=bad', auth], ['?network=myspace', auth],
    ['?subscriptionStatus=maybe', auth], [`?search=${'x'.repeat(101)}`, auth], ['?tag=%3Cscript%3E', auth]]) {
    stub(); const response = await GET(request(query, identity));
    assert.equal(response.status, identity === 'bad' ? 401 : 400); assert.equal(calls.length, 0);
  }
});

test('normalizes and saves a contact profile', async () => {
  stub();
  const response = await PATCH(new Request('https://veyrnox.test/api/v1/social/contacts', { method: 'PATCH',
    headers: { 'x-veyrnox-auth-id': auth }, body: JSON.stringify({ accountId: account, externalId: ' person-1 ',
      tags: [' VIP ', 'customer', 'vip'], subscriptionStatus: 'subscribed', notes: ' Met at launch. ' }) }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, tags: ['vip'], subscriptionStatus: 'subscribed' });
  assert.deepEqual(calls.at(-1), { name: 'update_social_inbox_contact', args: { p_auth_id: auth, p_brand_id: brand,
    p_account_id: account, p_external_id: 'person-1', p_tags: ['vip', 'customer'], p_subscription_status: 'subscribed', p_notes: 'Met at launch.' } });
});

test('rejects malformed contact updates before write limiting or storage', async () => {
  for (const body of [{ accountId: 'bad', externalId: 'p', tags: [], subscriptionStatus: 'unknown', notes: '' },
    { accountId: account, externalId: '', tags: [], subscriptionStatus: 'unknown', notes: '' },
    { accountId: account, externalId: 'p', tags: ['<bad>'], subscriptionStatus: 'unknown', notes: '' },
    { accountId: account, externalId: 'p', tags: [], subscriptionStatus: 'maybe', notes: '' }]) {
    stub(); const response = await PATCH(new Request('https://veyrnox.test/api/v1/social/contacts', { method: 'PATCH',
      headers: { 'x-veyrnox-auth-id': auth }, body: JSON.stringify(body) }));
    assert.equal(response.status, 400); assert.equal(calls.length, 0);
  }
});

test('maps database access boundaries without exposing internal errors', async () => {
  for (const [code, status] of [['PLAN_REQUIRED', 402], ['FORBIDDEN', 403], ['CONTACT_NOT_FOUND', 404], ['BROKEN', 502]]) {
    stub({ list_social_inbox_contacts: { ok: false, code } });
    const response = await GET(request()); assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: status === 502 ? 'internal' : code.toLowerCase() });
  }
});

test('imports normalized contacts into one selected account', async () => {
  stub();
  const response = await POST(new Request('https://veyrnox.test/api/v1/social/contacts', { method: 'POST',
    headers: { 'x-veyrnox-auth-id': auth, 'content-type': 'application/json' }, body: JSON.stringify({ accountId: account, source: 'csv', contacts: [
      { externalId: ' alex ', name: ' Alex ', tags: [' VIP ', 'customer'], subscriptionStatus: 'subscribed', notes: ' Hello ' },
      { externalId: 'sam', name: 'Sam', tags: [], subscriptionStatus: 'unknown', notes: '' },
    ] }) }));
  assert.equal(response.status, 201); assert.deepEqual(await response.json(), { imported: 2 });
  assert.deepEqual(calls.at(-1), { name: 'import_social_inbox_contacts', args: { p_auth_id: auth, p_brand_id: brand,
    p_account_id: account, p_source: 'csv', p_contacts: [
      { external_id: 'alex', name: 'Alex', tags: ['vip', 'customer'], subscription_status: 'subscribed', notes: 'Hello' },
      { external_id: 'sam', name: 'Sam', tags: [], subscription_status: 'unknown', notes: '' },
    ] } });
});

test('rejects duplicate, oversized and malformed imports before consuming write quota', async () => {
  const valid = { externalId: 'alex', name: 'Alex', tags: [], subscriptionStatus: 'unknown', notes: '' };
  for (const body of [
    { accountId: 'bad', source: 'csv', contacts: [valid] },
    { accountId: account, source: 'api', contacts: [valid] },
    { accountId: account, source: 'csv', contacts: [] },
    { accountId: account, source: 'csv', contacts: [valid, valid] },
    { accountId: account, source: 'csv', contacts: [{ ...valid, tags: ['<bad>'] }] },
  ]) {
    stub(); const response = await POST(new Request('https://veyrnox.test/api/v1/social/contacts', { method: 'POST',
      headers: { 'x-veyrnox-auth-id': auth, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    assert.equal(response.status, 400); assert.equal(calls.length, 0);
  }
});
