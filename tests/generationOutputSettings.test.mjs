import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', OPENROUTER_API_KEY: 'test-key',
    PUBLIC_HOST: 'https://veyrnox.test', FREE_ALLOWANCE_ENABLED: 'false',
});
const { POST } = await import('../app/api/v1/generations/route.js');
const AUTH = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const model = { id: 'seedance-2.0-fast', provider: 'openrouter', provider_endpoint: 'bytedance/seedance-2.0-fast',
    modality: 'text-to-video', credits_5s: 28, active: true, gated_flag: false };

function network(t, row = model, { submit = () => Response.json({ id: 'provider-job' }, { status: 202 }), submitted = { ok: true } } = {}) {
    const calls = []; let debited = false;
    t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
        const u = new URL(String(url));
        const body = init.body ? JSON.parse(init.body) : null;
        calls.push({ path: u.pathname, body });
        if (u.pathname.endsWith('/rpc/check_generation_rate_limit')) return Response.json({ ok: true });
        if (u.pathname === '/rest/v1/model_catalog') return Response.json([row]);
        if (u.pathname === '/rest/v1/users') return Response.json([{ id: AUTH }]);
        if (u.pathname.endsWith('/rpc/ledger_debit')) {
            const replay = debited; debited = true;
            return Response.json({ ok: true, job_id: JOB, idempotent: replay, balance_after: 100 });
        }
        if (u.pathname.endsWith('/rpc/job_submitted')) {
            if (submitted instanceof Error) throw submitted;
            return Response.json(submitted);
        }
        if (u.pathname === '/api/v1/videos') return submit();
        if (u.pathname.includes('/rpc/')) return Response.json({ ok: true });
        assert.fail(`Unexpected request: ${u.pathname}`);
    });
    return calls;
}

function request(inputs) {
    return new Request('https://veyrnox.test/api/v1/generations', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-veyrnox-auth-id': AUTH },
        body: JSON.stringify({ model_id: model.id, idempotency_key: 'output-settings-test', inputs: { prompt: 'Waves on the beach', ...inputs } }),
    });
}

test('resolution and audio choices are stored, charged at catalog price, and submitted exactly', async (t) => {
    const calls = network(t);
    const response = await POST(request({ duration_seconds: 10, output_resolution: '480p', audio_enabled: false }));
    assert.equal(response.status, 200);
    const debit = calls.find((call) => call.path.endsWith('/rpc/ledger_debit')).body;
    assert.equal(debit.p_credits, 56);
    assert.equal(debit.p_inputs.output_resolution, '480p');
    assert.equal(debit.p_inputs.audio_enabled, false);
    const submitted = calls.find((call) => call.path === '/api/v1/videos').body;
    assert.equal(submitted.resolution, '480p');
    assert.equal(submitted.generate_audio, false);
    assert.equal(submitted.duration, 10);
});

test('ambiguous OpenRouter video submit keeps the debit and a replay never resubmits', async (t) => {
    t.mock.method(console, 'error', () => {});
    const calls = network(t, model, { submit: () => { throw new Error('connection reset'); } });
    const response = await POST(request({ duration_seconds: 5 }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'outcome_unknown', job_id: JOB });
    assert.equal(calls.filter((call) => call.path.endsWith('/rpc/ledger_refund')).length, 0);
    assert.equal(calls.find((call) => call.path.endsWith('/rpc/job_submit_rejected')).body.p_error_code, 'provider_outcome_unknown');
    assert.equal((await POST(request({ duration_seconds: 5 }))).status, 200);
    assert.equal(calls.filter((call) => call.path === '/api/v1/videos').length, 1);
});

test('1080p and malformed audio are refused before any lookup or charge', async (t) => {
    const calls = network(t);
    for (const inputs of [{ output_resolution: '1080p' }, { audio_enabled: 'false' }]) {
        assert.equal((await POST(request(inputs))).status, 400);
    }
    assert.equal(calls.length, 0);
});

test('models without output choices refuse them before signing sources or debiting', async (t) => {
    const calls = network(t, { ...model, provider_endpoint: 'fal-ai/veo3.1/fast', provider: 'fal' });
    for (const inputs of [{ output_resolution: '720p' }, { audio_enabled: false }]) {
        const response = await POST(request(inputs));
        assert.equal(response.status, 400);
        assert.match((await response.json()).error, /^inputs_key_not_allowed:/);
    }
    assert.equal(calls.some((call) => call.path.endsWith('/rpc/ledger_debit')), false);
    assert.equal(calls.some((call) => call.path === '/api/v1/videos'), false);
});
