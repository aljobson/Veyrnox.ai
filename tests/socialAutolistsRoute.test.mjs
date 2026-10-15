import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c)}`));
const route = await import('../app/api/v1/social/autolists/route.js');
const auth = '11111111-1111-4111-8111-111111111111', brand = '22222222-2222-4222-8222-222222222222', queue = '33333333-3333-4333-8333-333333333333', id = '44444444-4444-4444-8444-444444444444';
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test', PUBLISH_QUEUES_ENABLED: 'true', PUBLISH_RSS_AUTOLISTS_ENABLED: 'true', ACCOUNT_READ_RATE_LIMIT_ENABLED: 'true' });
let calls = [];
function stub() { calls = []; globalThis.fetch = async (url, init) => { const name = new URL(url).pathname.split('/').pop(), args = JSON.parse(init.body); calls.push({ name, args }); return Response.json(({ consume_account_read_request: { ok: true }, consume_social_post_write_request: { ok: true }, get_or_create_default_social_brand: { ok: true, brand_id: brand, role: 'owner' }, list_social_publish_autolists: { ok: true, autolists: [] }, save_social_publish_autolist: { ok: true, autolist_id: id }, delete_social_publish_autolist: { ok: true } })[name]); }; }
const request = (path, options = {}) => new Request(`https://veyrnox.test${path}`, { headers: { 'x-veyrnox-auth-id': auth }, ...options });

test('lists, saves and deletes RSS Autolists', async () => {
  stub(); let response = await route.GET(request('/api/v1/social/autolists')); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  response = await route.PUT(request('/api/v1/social/autolists', { method: 'PUT', body: JSON.stringify({ name: 'News', feedUrl: 'https://Example.com/feed.xml', queueId: queue, captionTemplate: '{{title}}\n{{link}}', refreshIntervalMinutes: 360, enabled: true, autoSchedule: false }) }));
  assert.equal(response.status, 200); assert.equal(calls.at(-1).name, 'save_social_publish_autolist'); assert.equal(calls.at(-1).args.p_feed_url, 'https://example.com/feed.xml');
  response = await route.DELETE(request(`/api/v1/social/autolists?id=${id}`, { method: 'DELETE' })); assert.equal(response.status, 200); assert.equal(calls.at(-1).name, 'delete_social_publish_autolist');
});

test('rejects unsafe URLs and unknown caption placeholders before storage', async () => {
  for (const body of [
    { name: 'News', feedUrl: 'https://localhost/feed', queueId: queue, captionTemplate: '{{title}}', refreshIntervalMinutes: 360, enabled: true, autoSchedule: false },
    { name: 'News', feedUrl: 'https://example.com/feed', queueId: queue, captionTemplate: '{{title}} {{secret}}', refreshIntervalMinutes: 360, enabled: true, autoSchedule: false },
  ]) { stub(); const response = await route.PUT(request('/api/v1/social/autolists', { method: 'PUT', body: JSON.stringify(body) })); assert.equal(response.status, 400); assert.equal(calls.length, 0); }
});
