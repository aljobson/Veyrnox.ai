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
    PUBLIC_HOST: 'https://veyrnox.test',
    R2_ACCOUNT_ID: 'acct',
    R2_ACCESS_KEY_ID: 'AKIDTEST',
    R2_SECRET_ACCESS_KEY: 'secret-test',
    R2_BUCKET: 'veyrnox-test',
});
const generations = await import('../app/api/v1/generations/route.js');

// Topaz is priced for a 6 MP source (lib/modelCapabilities.js). Its cap is
// checked against the bytes we stored, so the only source it may read is one
// this server signed — a client URL must never stand in for one.
const TOPAZ = { id: 'topaz-upscale', provider: 'fal', provider_endpoint: 'fal-ai/topaz/upscale/image', modality: 'image-to-image', credits_5s: 5, gated_flag: false, active: true };

function stub(rows = TOPAZ) {
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
        const u = String(url);
        calls.push({ url: u, body: init.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
        if (u.includes('/rpc/check_generation_rate_limit')) return Response.json({ ok: true });
        if (u.includes('/rest/v1/model_catalog')) return Response.json([rows]);
        if (u.includes('/rest/v1/users')) return Response.json([{ id: '00000000-0000-4000-8000-000000000009' }]);
        if (u.includes('/rpc/ledger_debit')) return Response.json({ ok: true, job_id: '55555555-5555-4555-8555-555555555555', idempotent: false, balance_after: 1 });
        if (u.includes('queue.fal.run')) return Response.json({ request_id: 'req-1' });
        if (u.includes('openrouter.ai')) return Response.json({ id: 'or-video-1' });
        if (u.includes('/rpc/')) return Response.json({ ok: true });
        throw new Error(`unexpected fetch ${u}`);
    };
    return calls;
}

const post = (body) => generations.POST(new Request('https://veyrnox.test/api/v1/generations', {
    method: 'POST',
    headers: { 'x-veyrnox-auth-id': 'auth-user-1', 'content-type': 'application/json' },
    body: JSON.stringify({ idempotency_key: 'src-guard-0001', ...body }),
}));

test('a client-sent image_url never becomes a model source, and never reaches the provider', async () => {
    const calls = stub();
    const res = await post({ model_id: 'topaz-upscale', inputs: { image_url: 'https://attacker.example/100-megapixels.png' } });
    // The slot is required, and the client URL was dropped before the check.
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'inputs_invalid:image_url' });
    assert.ok(!calls.some((c) => c.url.includes('/rpc/ledger_debit')), 'no debit');
    assert.ok(!calls.some((c) => c.url.includes('queue.fal.run')), 'nothing submitted');
});

test('a client-sent video_url cannot stand in for an upload on a model that takes one', async () => {
    const calls = stub({ ...TOPAZ, id: 'latentsync', provider_endpoint: 'fal-ai/latentsync', modality: 'video-to-video', credits_5s: 13 });
    const res = await post({ model_id: 'latentsync', inputs: { video_url: 'https://attacker.example/2-hours.mp4', audio_url: 'https://attacker.example/2-hours.mp3' } });
    assert.equal(res.status, 400);
    assert.ok(!calls.some((c) => c.url.includes('/rpc/ledger_debit')), 'no debit');
});

test('a model whose media slot is optional still runs, without the client URL', async () => {
    const calls = stub({ ...TOPAZ, id: 'seedance-2.0-fast', provider_endpoint: 'bytedance/seedance-2.0-fast', provider: 'openrouter', modality: 'text-to-video', credits_5s: 28 });
    process.env.OPENROUTER_API_KEY = 'or-test';
    const res = await post({ model_id: 'seedance-2.0-fast', inputs: { prompt: 'a cat', duration_seconds: 5, image_url: 'https://attacker.example/start.png' } });
    const debit = calls.find((c) => c.url.includes('/rpc/ledger_debit'));
    assert.ok(debit, `expected a debit, got ${res.status}`);
    assert.equal(debit.body.p_inputs.image_url, undefined, 'the client URL is not stored on the job');
});
