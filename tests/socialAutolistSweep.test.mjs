import test from 'node:test';
import assert from 'node:assert/strict';
import { runSocialAutolistSweep } from '../lib/social/autolistSweep.js';

const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'test' };
const enabled = { PUBLISH_RSS_AUTOLISTS_ENABLED: 'true' };

test('Autolist sweep fails closed when disabled', async () => {
  let calls = 0;
  assert.deepEqual(await runSocialAutolistSweep({ env: {}, cfg, rpcCall: async () => { calls += 1; } }), { ok: true, skipped: 'disabled' });
  assert.equal(calls, 0);
});

test('refreshes a feed with conditional headers and schedules imported items', async () => {
  const calls = []; let request;
  const rpcCall = async (name, args) => {
    calls.push({ name, args });
    if (name === 'claim_due_social_publish_autolists') return { ok: true, autolists: [{ id: 'a1', feed_url: 'https://example.com/feed.xml', etag: '"old"', last_modified: 'Mon, 12 Oct 2026 10:00:00 GMT', auto_schedule: true }] };
    if (name === 'record_social_publish_autolist_refresh') return { ok: true, added: 1 };
    if (name === 'schedule_social_publish_autolist_items') return { ok: true, scheduled: 1 };
    return { ok: true };
  };
  const out = await runSocialAutolistSweep({ env: enabled, cfg, rpcCall, fetcher: async (url, init, timeout, maxBytes) => {
    request = { url, init, timeout, maxBytes };
    return new Response('<rss><channel><item><title>Launch</title><link>https://example.com/launch</link><guid>launch-1</guid></item></channel></rss>', { headers: { 'content-type': 'application/rss+xml', etag: '"new"' } });
  } });
  assert.deepEqual(out, { ok: true, claimed: 1, refreshed: 1, scheduled: 1, failed: 0 });
  assert.equal(request.init.headers['If-None-Match'], '"old"');
  assert.equal(request.init.redirect, 'manual'); assert.equal(request.timeout, 8000); assert.equal(request.maxBytes, 512 * 1024);
  assert.equal(calls[1].args.p_items[0].external_id, 'launch-1');
});

test('records 304 responses and typed failures without leaking provider bodies', async () => {
  const reports = [];
  const rpcCall = async (name, args) => {
    if (name === 'claim_due_social_publish_autolists') return { ok: true, autolists: [
      { id: 'cached', feed_url: 'https://example.com/feed', auto_schedule: false },
      { id: 'bad', feed_url: 'https://localhost/feed', auto_schedule: false },
    ] };
    reports.push({ name, args }); return { ok: true };
  };
  const out = await runSocialAutolistSweep({ env: enabled, cfg, rpcCall, fetcher: async () => new Response(null, { status: 304 }) });
  assert.deepEqual(out, { ok: true, claimed: 2, refreshed: 1, scheduled: 0, failed: 1 });
  assert.equal(reports[0].args.p_not_modified, true);
  assert.equal(reports[1].args.p_error, 'unsafe_feed_url');
});
