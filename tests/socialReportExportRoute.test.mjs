import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c)}`));
const { GET } = await import('../app/api/v1/social/reports/[id]/export/route.js');
const auth = '11111111-1111-4111-8111-111111111111', brand = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333', account = '44444444-4444-4444-8444-444444444444';
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test', PUBLISH_REPORTS_ENABLED: 'true', PUBLISH_REPORT_EXPORTS_ENABLED: 'true', ACCOUNT_READ_RATE_LIMIT_ENABLED: 'true' });

function stub() { globalThis.fetch = async (url, init) => { const name = new URL(url).pathname.split('/').pop(), args = JSON.parse(init.body);
  if (name === 'consume_account_read_request') return Response.json({ ok: true });
  if (name === 'get_or_create_default_social_brand') return Response.json({ ok: true, brand_id: brand });
  if (name === 'list_social_report_templates') return Response.json({ ok: true, templates: [{ id, name: 'Monthly', account_id: account, range_days: 30, compare_previous: false, include_content: true }] });
  if (name === 'list_social_accounts') return Response.json({ ok: true, accounts: [{ id: account, network: 'instagram', status: 'active' }] });
  if (name === 'get_social_analytics') return Response.json({ ok: true, account: { id: account, network: 'instagram', display_name: 'Veyrnox' }, sync: {}, evolution: [], posts: [{ id: 'p1', metrics: { likes: 1 } }] });
  assert.fail(`unexpected RPC ${name} ${JSON.stringify(args)}`);
}; }

test('exports a private no-store PDF and PowerPoint for an accessible template', async () => {
  for (const format of ['pdf', 'pptx']) { stub(); const response = await GET(new Request(`https://veyrnox.test/api/v1/social/reports/${id}/export?format=${format}`, { headers: { 'x-veyrnox-auth-id': auth } }), { params: Promise.resolve({ id }) });
    assert.equal(response.status, 200); assert.match(response.headers.get('content-disposition'), new RegExp(`Monthly\\.${format}`)); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const bytes = new Uint8Array(await response.arrayBuffer()); assert.deepEqual([...bytes.slice(0, 2)], format === 'pdf' ? [0x25, 0x50] : [0x50, 0x4b]); }
});

test('export is fail-closed and validates the requested format', async () => {
  stub(); const bad = await GET(new Request(`https://veyrnox.test/api/v1/social/reports/${id}/export?format=html`, { headers: { 'x-veyrnox-auth-id': auth } }), { params: Promise.resolve({ id }) }); assert.equal(bad.status, 400);
  process.env.PUBLISH_REPORT_EXPORTS_ENABLED = 'false'; try { const closed = await GET(new Request(`https://veyrnox.test/api/v1/social/reports/${id}/export`, { headers: { 'x-veyrnox-auth-id': auth } }), { params: Promise.resolve({ id }) }); assert.equal(closed.status, 404); } finally { process.env.PUBLISH_REPORT_EXPORTS_ENABLED = 'true'; }
});
