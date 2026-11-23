import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', PUBLIC_HOST: 'https://veyrnox.test',
    CRUN_ENABLED: 'true', CRUN_API_KEY: 'test-crun', FAL_KEY: 'test-fal',
    R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test', R2_BUCKET: 'test',
});
const { POST } = await import('../app/api/v1/generations/route.js');
const AUTH = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const qwen = { id: 'qwen3-tts', provider: 'crun', provider_endpoint: 'crun:qwen3-tts/speech-synthesis', credits_5s: 2 };
const minimax = { id: 'minimax-speech-2.6-hd', provider: 'fal', provider_endpoint: 'fal-ai/minimax/speech-2.6-hd', credits_5s: 6 };
async function run(model, inputs, verify) {
    const original = globalThis.fetch, calls = [];
    globalThis.fetch = async (url, init = {}) => {
        const u = new URL(String(url));
        calls.push({ path: u.pathname, host: u.hostname, body: init.body && JSON.parse(init.body) });
        if (u.pathname.endsWith('/rpc/ledger_debit')) return Response.json({ ok: true, job_id: JOB, balance_after: 98 });
        if (u.pathname.includes('/rpc/')) return Response.json({ ok: true });
        if (u.pathname.endsWith('/model_catalog')) return Response.json([{ ...model, modality: 'text-to-speech', active: true, gated_flag: false }]);
        if (u.pathname.endsWith('/model_routes')) return Response.json([]);
        if (u.pathname.endsWith('/users')) return Response.json([{ id: AUTH }]);
        if (u.hostname === 'api.crun.ai') return Response.json({ code: 200, data: { task_id: 'qwen-task' } });
        throw new Error(`Unexpected request: ${u.hostname}${u.pathname}`);
    };
    try {
        const res = await POST(new Request('https://veyrnox.test/api/v1/generations', {
            method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH, 'content-type': 'application/json' },
            body: JSON.stringify({ model_id: model.id, idempotency_key: 'qwen-contract-test', confirmed_credits: model.credits_5s, inputs }),
        }));
        await verify(res, await res.json(), calls);
    } finally { globalThis.fetch = original; }
}
test('real gateway refuses cross-model voices and Qwen delivery controls before debit', async () => {
    for (const [model, extra] of [
        [qwen, { tts_voice: 'Wise_Woman' }], [minimax, { tts_voice: 'Cherry' }],
        ...Object.entries({ tts_emotion: 'neutral', tts_speed: 1, tts_volume: 1, tts_pitch: 0, instructions: 'Whisper' }).map(([key, value]) => [qwen, { [key]: value }]),
        [qwen, { prompt: 'x'.repeat(601) }],
    ]) await run(model, { prompt: 'Hello', ...extra }, (res, body, calls) => {
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.match(body.error, /^inputs_(invalid|key_not_allowed)/);
        assert.equal(calls.some(call => call.path.endsWith('/ledger_debit')), false);
        assert.equal(calls.some(call => call.host === 'api.crun.ai'), false);
    });
});
test('real gateway charges Qwen once at its own price and submits only its controls', async () => {
    await run(qwen, { prompt: 'Hello', tts_voice: 'Cherry', tts_language: 'auto' }, (res, body, calls) => {
        assert.equal(res.status, 200, JSON.stringify(body));
        const debit = calls.filter(call => call.path.endsWith('/ledger_debit'));
        assert.equal(debit.length, 1);
        assert.equal(debit[0].body.p_credits, 2);
        assert.deepEqual(calls.find(call => call.host === 'api.crun.ai').body, {
            model: 'qwen3-tts/speech-synthesis', input: { text: 'Hello', voice: 'Cherry', language_type: 'Auto' },
        });
    });
});
