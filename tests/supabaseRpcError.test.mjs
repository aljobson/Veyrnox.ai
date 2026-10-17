import test from 'node:test';
import assert from 'node:assert/strict';
import { rpc, SupabaseError } from '../packages/db/supabase-client.js';
import { dbErrorSummary } from '../lib/dbErrorSummary.js';

const options = { supabaseUrl: 'https://abc123.supabase.co', serviceRoleKey: 'test-only-key', timeoutMs: 2000 };

test('a failed rpc carries the status, body, target host and Cloudflare ray id, and no key', async () => {
    globalThis.fetch = async () => new Response('error code: 1003', { status: 403, headers: { 'content-type': 'text/plain', 'cf-ray': '9a1b2c3d4e5f-LHR' } });
    await assert.rejects(() => rpc('next_top_up_backfill_batch', { p_limit: 1 }, options), (err) => {
        assert.ok(err instanceof SupabaseError);
        assert.equal(err.status, 403); assert.equal(err.body, 'error code: 1003');
        assert.equal(err.host, 'abc123.supabase.co'); assert.equal(err.ray, '9a1b2c3d4e5f-LHR');
        const line = dbErrorSummary(err);
        assert.equal(line, 'status=403 host=abc123.supabase.co ray=9a1b2c3d4e5f-LHR text=error code: 1003');
        assert.ok(!line.includes('test-only-key') && !line.includes('/rest/v1'));
        return true;
    });
});

test('a failure with no ray header or a database JSON body still logs cleanly, and errors before a response have no host', async () => {
    globalThis.fetch = async () => Response.json({ code: '42501', message: 'permission denied' }, { status: 403 });
    await assert.rejects(() => rpc('x', {}, options), (err) => dbErrorSummary(err) === 'status=403 host=abc123.supabase.co code=42501 message=permission denied');
    globalThis.fetch = async () => { throw new Error('boom'); };
    await assert.rejects(() => rpc('x', {}, options), (err) => err.host === undefined && /transport error/.test(err.message));
});
