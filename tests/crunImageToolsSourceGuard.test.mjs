import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    FAL_KEY: 'fal-test',
    CRUN_API_KEY: 'crun-test',
    CRUN_ENABLED: 'true',
    PUBLIC_HOST: 'https://veyrnox.test',
    R2_ACCOUNT_ID: 'acct',
    R2_ACCESS_KEY_ID: 'AKIDTEST',
    R2_SECRET_ACCESS_KEY: 'secret-test',
    R2_BUCKET: 'veyrnox-test',
});
const generations = await import('../app/api/v1/generations/route.js');

// The two Crun image tools forward their one image to Crun by URL. That URL must only ever be one this server signed for the
// caller's own upload: a URL typed into `inputs` never stands in for it (the same guard tests/sourceUrlGuard.test.mjs pins for Topaz).
const ROWS = {
    'upscale-2x-clean': { id: 'upscale-2x-clean', provider: 'crun', provider_endpoint: 'crun:image-upscale', modality: 'image-to-image', credits_5s: 2, gated_flag: false, active: true },
    'background-remove-fast': { id: 'background-remove-fast', provider: 'crun', provider_endpoint: 'crun:image-background-remove', modality: 'image-to-image', credits_5s: 1, gated_flag: false, active: true },
};

function stub(row) {
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
        const u = String(url);
        calls.push({ url: u });
        if (u.includes('/rpc/check_generation_rate_limit')) return Response.json({ ok: true });
        if (u.includes('/rest/v1/model_catalog')) return Response.json([row]);
        if (u.includes('/rest/v1/users')) return Response.json([{ id: '00000000-0000-4000-8000-000000000009' }]);
        if (u.includes('/rpc/ledger_debit')) return Response.json({ ok: true, job_id: '55555555-5555-4555-8555-555555555555', idempotent: false, balance_after: 1 });
        if (u.includes('api.crun.ai')) return Response.json({ code: 200, data: { task_id: 'task-1' } });
        if (u.includes('/rpc/')) return Response.json({ ok: true });
        throw new Error(`unexpected fetch ${u}`);
    };
    return calls;
}

const post = (body) => generations.POST(new Request('https://veyrnox.test/api/v1/generations', {
    method: 'POST',
    headers: { 'x-veyrnox-auth-id': 'auth-user-1', 'content-type': 'application/json' },
    body: JSON.stringify({ idempotency_key: 'crun-img-guard-0001', consent: true, ...body }),
}));

for (const id of Object.keys(ROWS)) {
  test(`${id}: a client-sent image_url never becomes the source and never reaches Crun`, async () => {
    const calls = stub(ROWS[id]);
    const res = await post({ model_id: id, inputs: { image_url: 'https://attacker.example/internal-or-huge.png' } });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'inputs_invalid:image_url' });
    assert.ok(!calls.some((c) => c.url.includes('/rpc/ledger_debit')), 'no debit');
    assert.ok(!calls.some((c) => c.url.includes('api.crun.ai')), 'nothing submitted to Crun');
  });
}
