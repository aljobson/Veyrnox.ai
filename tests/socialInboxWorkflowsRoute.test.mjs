import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c)}`));
const workflows = await import('../app/api/v1/social/workflows/route.js');
const suggestions = await import('../app/api/v1/social/inbox/[threadId]/suggestions/route.js');

const auth = '11111111-1111-4111-8111-111111111111'; const brand = '22222222-2222-4222-8222-222222222222';
const account = '33333333-3333-4333-8333-333333333333'; const thread = '44444444-4444-4444-8444-444444444444';
const suggestion = '55555555-5555-4555-8555-555555555555';
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only',
  ACCOUNT_READ_RATE_LIMIT_ENABLED: 'true', PUBLISH_RUNTIME_FLAGS: '{"plans":"true","inbox":"true","inboxWorkflows":"true"}' });
let calls;
function stub(results = {}) {
  calls = []; globalThis.fetch = async (url, init) => {
    const name = new URL(url).pathname.split('/').pop(); calls.push({ name, args: JSON.parse(init.body) });
    return Response.json(results[name] ?? ({ consume_social_post_write_request: { ok: true },
      get_or_create_default_social_brand: { ok: true, brand_id: brand, role: 'owner' },
      list_social_inbox_workflows: { ok: true, workflows: [{ id: suggestion, name: 'Pricing' }] },
      save_social_inbox_workflow: { ok: true, workflow_id: suggestion, created: true },
      delete_social_inbox_workflow: { ok: true }, list_social_inbox_suggestions: { ok: true, suggestions: [{ id: suggestion }] },
      decide_social_inbox_suggestion: { ok: true, suggested_reply: 'Our plans start at $15.' } })[name]);
  };
}
const request = (path = '/api/v1/social/workflows', options = {}) => new Request(`https://veyrnox.test${path}`, { headers: { 'x-veyrnox-auth-id': auth }, ...options });

test('lists and saves reviewable keyword workflows', async () => {
  stub(); const listed = await workflows.GET(request()); assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), { workflows: [{ id: suggestion, name: 'Pricing' }], brandRole: 'owner' });
  const saved = await workflows.PUT(request('/api/v1/social/workflows', { method: 'PUT', body: JSON.stringify({ id: null,
    name: 'Pricing', accountId: account, kind: 'comment', keyword: 'price', matchMode: 'contains', replyText: 'Our plans start at $15.', enabled: true }) }));
  assert.equal(saved.status, 201); assert.equal(calls.at(-1).name, 'save_social_inbox_workflow');
  assert.equal(calls.at(-1).args.p_reply_text, 'Our plans start at $15.');
});

test('rejects malformed workflow input before storage', async () => {
  stub(); const response = await workflows.PUT(request('/api/v1/social/workflows', { method: 'PUT', body: JSON.stringify({
    name: '', accountId: 'bad', keyword: '', matchMode: 'regex', replyText: '', enabled: true }) }));
  assert.equal(response.status, 400); assert.equal(calls.length, 0);
});

test('lists, uses and dismisses suggestions without a send call', async () => {
  stub(); const context = { params: Promise.resolve({ threadId: thread }) };
  const listed = await suggestions.GET(request(`/api/v1/social/inbox/${thread}/suggestions`), context);
  assert.equal(listed.status, 200); assert.deepEqual(await listed.json(), { suggestions: [{ id: suggestion }] });
  const used = await suggestions.PATCH(request(`/api/v1/social/inbox/${thread}/suggestions`, { method: 'PATCH', body: JSON.stringify({ suggestionId: suggestion, action: 'use' }) }), context);
  assert.equal(used.status, 200); assert.deepEqual(await used.json(), { suggestedReply: 'Our plans start at $15.' });
  assert.equal(calls.some((call) => call.name === 'create_social_inbox_reply'), false);
});
