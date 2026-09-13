import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Next resolves the extensionless `next/server` through its bundler; plain
// Node ESM needs the file name.
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
process.env.FAL_KEY = 'fal-test';
process.env.PUBLIC_HOST = 'https://veyrnox.test';

const { POST } = await import('../app/api/v1/generations/route.js');

test('a Frozen account gets 403 account_frozen and nothing is submitted to fal', async () => {
    const seen = [];
    globalThis.fetch = async (url) => {
        const u = String(url);
        seen.push(u);
        if (u.includes('/rpc/check_generation_rate_limit')) return Response.json({ ok: true });
        if (u.includes('/rest/v1/model_catalog')) {
            return Response.json([{ id: 'm1', provider: 'fal', provider_endpoint: 'fal-ai/x', modality: 'text-to-image', credits_5s: 4, gated_flag: false, active: true }]);
        }
        if (u.includes('/rest/v1/users')) return Response.json([{ id: '00000000-0000-4000-8000-000000000009' }]);
        if (u.includes('/rpc/ledger_debit')) return Response.json({ ok: false, code: 'ACCOUNT_FROZEN' });
        throw new Error(`unexpected fetch ${u}`);
    };

    const res = await POST(new Request('https://veyrnox.test/api/v1/generations', {
        method: 'POST',
        headers: { 'x-veyrnox-auth-id': 'auth-user-1', 'content-type': 'application/json' },
        body: JSON.stringify({ model_id: 'm1', idempotency_key: 'gen-key-0001', inputs: { prompt: 'a cat' } }),
    }));

    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'account_frozen' });
    assert.ok(!seen.some((u) => u.includes('fal.run')), 'no fal submission');
});
