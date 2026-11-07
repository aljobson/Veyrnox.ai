import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { editorAiEditHandlers, requestDigest } from '../lib/editorAiEdit.js';
import { emptySequence, addSequenceMedia, addSequenceClip } from '../app/veyrnox/_lib/editorSequence.mjs';
describe('editor AI edit', () => {
const AUTH = '11111111-1111-4111-8111-111111111111', JOB = '22222222-2222-4222-8222-222222222222';
const MODEL = { id: 'chat-fast', active: true, modality: 'text', provider: 'openrouter-chat', provider_endpoint: 'vendor/fast', credits_5s: 3 };
const timeline = () => addSequenceClip(addSequenceMedia(emptySequence(), { id: 'l-media', kind: 'video', frames: 300, name: 'private-name', hasAudio: true }), 'video', 'l-media');
const body = () => ({ idempotencyKey: 'edit-key-1234', instruction: 'private instruction', timeline: timeline(), expectedCredits: 3 });
const request = (value = body(), method = 'POST', auth = AUTH) => new Request('https://app.test/api/v1/editor/ai-edit', { method, headers: { 'x-veyrnox-auth-id': auth, 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(value) } : {}) });
function fixture({ overrides = {}, model = MODEL, provider, env: patch = {}, ...timings } = {}) {
    const calls = [], providerCalls = [];
    let job = null;
    const env = { EDITOR_AI_EDIT_ENABLED: 'true', EDITOR_AI_EDIT_MODEL_ID: MODEL.id, OPENROUTER_CHAT_API_KEY: 'test', ...patch };
    const rpc = async (name, args) => {
        calls.push({ name, args });
        if (Object.hasOwn(overrides, name)) { const value = overrides[name]; if (value instanceof Error) throw value; return typeof value === 'function' ? value(args) : value; }
        if (name === 'editor_ai_edit_lookup') return { ok: true, found: !!job, ...job };
        if (name === 'ledger_debit') {
            if (job) return { ok: true, idempotent: true, job_id: JOB };
            job = { status: 'pending', model_id: args.p_model_id, digest: args.p_inputs.request_hash, credits: args.p_credits };
            return { ok: true, job_id: JOB };
        }
        if (name === 'editor_ai_edit_settle') job = { ...job, status: 'completed', result: args.p_result };
        if (name === 'ledger_refund') job = { ...job, status: 'failed', refunded: true };
        return { ok: true };
    };
    const complete = async args => { providerCalls.push(args); return provider ? provider(args) : { text: JSON.stringify({ commands: [{ op: 'split', kind: 'video', id: 'v1', frame: 30 }] }) }; };
    const handlers = editorAiEditHandlers({ cfg: {}, rpc, select: async table => table === 'users' ? [{ id: AUTH }] : model ? [model] : [], complete, env, ...timings });
    return { ...handlers, calls, providerCalls, env, job: () => job, count: name => calls.filter(c => c.name === name).length };
}
for (const options of [{ env: { EDITOR_AI_EDIT_ENABLED: 'false' } }, { env: { EDITOR_AI_EDIT_MODEL_ID: '' } }, { model: null }, { model: { ...MODEL, active: false } }, { model: { ...MODEL, provider: 'fal' } }]) {
    test(`unavailable model/flag never debits: ${JSON.stringify(options)}`, async () => {
        const f = fixture(options);
        assert.equal((await f.quote(request(null, 'GET'))).status, 501);
        assert.equal((await f.run(request())).status, 501);
        assert.equal(f.count('ledger_debit'), 0);
    });
}
test('quote uses catalog, read quota, no-store, and no generation rate limit', async () => {
    const f = fixture({ model: { ...MODEL, credits_5s: 7 } });
    const response = await f.quote(request(null, 'GET'));
    assert.deepEqual(await response.json(), { credits: 7, max_commands: 20, max_instruction_chars: 500 });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(f.count('consume_account_read_request'), 1);
    assert.equal(f.count('check_generation_rate_limit'), 0);
});
for (const patch of [{ instruction: '' }, { instruction: 'x'.repeat(501) }, { instruction: 1 }, { timeline: {} }, { timeline: null }, { extra: 'no' }, { expectedCredits: 1.5 }, { idempotencyKey: 'short' }]) {
    test(`bad input has no charge: ${Object.keys(patch)}`, async () => {
        const f = fixture(); assert.equal((await f.run(request({ ...body(), ...patch }))).status, 400); assert.equal(f.count('ledger_debit'), 0);
    });
}
test('cap clips before debit; cap body at 200 KB', async () => {
    const f = fixture(), b = body();
    b.timeline.text = Array.from({ length: 120 }, (_, i) => ({ id: `t${i + 2}`, text: 'a', start: 0, len: 1, trackId: 'text-0', x: .5, y: .5, size: 6 }));
    assert.equal((await (await f.run(request(b))).json()).error, 'timeline_too_large');
    assert.equal((await f.run(request({ ...body(), instruction: 'x'.repeat(201 * 1024) }))).status, 413);
    assert.equal(f.count('ledger_debit'), 0);
});
test('happy path: one debit, checked submit before provider, sanitized settled output', async () => {
    const f = fixture({ provider: async () => ({ text: '```json\n' + JSON.stringify({ vendorSecret: 'secret', commands: [{ op: 'vendor:secret', payload: 'secret' }, { op: 'split', kind: 'video', id: 'v1', frame: 30 }] }) + '\n```' }) });
    const response = await f.run(request()), value = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(value.plan, { commands: [{ op: 'split', kind: 'video', id: 'v1', frame: 30 }] });
    assert.deepEqual(value.skipped, [{ index: 0, reason: 'unsupported_operation' }]);
    assert.equal(JSON.stringify(value).includes('secret'), false);
    assert.equal(f.count('ledger_debit'), 1); assert.equal(f.count('job_submitted'), 1); assert.equal(f.count('editor_ai_edit_settle'), 1); assert.equal(f.count('ledger_refund'), 0);
    const inputs = f.calls.find(c => c.name === 'ledger_debit').args.p_inputs;
    assert.deepEqual(Object.keys(inputs).sort(), ['kind', 'request_hash']);
    assert.equal(inputs.kind, 'editor_ai_edit'); assert.match(inputs.request_hash, /^[a-f0-9]{64}$/);
    assert.equal(f.providerCalls[0].maxTokens, 1024); assert.equal(f.providerCalls[0].model, MODEL.provider_endpoint);
});
for (const text of ['', 'not json', '{"commands":[]}', '{"commands":[{"op":"export"}]}', '{"commands":[{"op":"split","kind":"video","id":"v1","frame":0}]}', '{"commands":[{"op":"split","kind":"video","id":"v1","frame":30,"extra":"bad"}]}']) {
    test(`unusable reply refunded: ${text.slice(0, 60)}`, async () => {
        const f = fixture({ provider: async () => ({ text }) });
        const response = await f.run(request());
        assert.equal(response.status, 422); assert.deepEqual(await response.json(), { error: 'plan_unusable', refunded: true });
        assert.equal(f.count('job_failed'), 1); assert.equal(f.count('ledger_refund'), 1); assert.equal(f.count('editor_ai_edit_settle'), 0);
    });
}
test('provider rejection and hard timeout refund exactly once, even when provider ignores abort', async () => {
    for (const [provider, providerMs, code, status] of [[async () => { throw Error('secret vendor body'); }, 100, 'provider_unavailable', 502], [() => new Promise(() => {}), 5, 'timeout', 504]]) {
        const f = fixture({ provider, providerMs }); const response = await f.run(request());
        assert.equal(response.status, status); assert.deepEqual(await response.json(), { error: code, refunded: true });
        assert.equal(f.count('job_failed'), 1); assert.equal(f.count('ledger_refund'), 1);
    }
});
for (const failedRpc of ['job_failed', 'ledger_refund']) {
    for (const value of [{ ok: false }, new Error('private db message')]) {
        test(`unconfirmed ${failedRpc} never claims refunded`, async () => {
            const f = fixture({ overrides: { [failedRpc]: value }, provider: async () => { throw Error(); } });
            const response = await f.run(request()); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'refund_pending' });
            if (failedRpc === 'job_failed') assert.equal(f.count('ledger_refund'), 0);
        });
    }
}
test('submit rejection is refunded; ambiguous submit never dispatches provider', async () => {
    for (const value of [{ ok: false }, new Error('transport')]) {
        const f = fixture({ overrides: { job_submitted: value } }); const response = await f.run(request());
        assert.equal(f.providerCalls.length, 0);
        assert.equal((await response.json()).refunded, value instanceof Error ? undefined : true);
    }
});
test('settle rejection refunds; ambiguous settle reads recovery without racing a refund', async () => {
    const rejected = fixture({ overrides: { editor_ai_edit_settle: { ok: false } } });
    assert.equal((await (await rejected.run(request())).json()).refunded, true);
    const uncertain = fixture({ overrides: { editor_ai_edit_settle: new Error('lost') } });
    assert.equal((await (await uncertain.run(request())).json()).status, 'pending');
    assert.equal(uncertain.count('ledger_refund'), 0);
});
test('success lost: GET and POST replay survive disabled model/changed price without new debit/model call', async () => {
    const f = fixture(), original = await (await f.run(request())).json();
    f.env.EDITOR_AI_EDIT_ENABLED = 'false'; f.env.EDITOR_AI_EDIT_MODEL_ID = 'other';
    const recovered = await f.recover(request(null, 'GET'), body().idempotencyKey);
    assert.deepEqual(await recovered.json(), original);
    assert.equal(recovered.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await (await f.run(request({ ...body(), expectedCredits: 99 }))).json(), original);
    assert.equal(f.count('ledger_debit'), 1); assert.equal(f.providerCalls.length, 1); assert.equal(f.count('check_generation_rate_limit'), 1);
});
test('same IDs with changed timeline conflict, canonical property order and cleaned instruction replay', async () => {
    const f = fixture(); await f.run(request());
    const changed = body(); changed.timeline.video[0].volume = .5;
    const response = await f.run(request(changed)); assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: 'idempotency_conflict' });
    assert.equal((await f.run(request({ ...body(), instruction: ' private  instruction\n' }))).status, 200);
    assert.equal(await requestDigest('a', { a: 1, b: 2 }, 'm'), await requestDigest('a', { b: 2, a: 1 }, 'm'));
    assert.equal(f.providerCalls.length, 1);
});
test('replay of confirmed refunded job is terminal and never regenerates', async () => {
    const f = fixture({ provider: async () => ({ text: '' }) }); await f.run(request());
    const replay = await f.run(request()); assert.equal(replay.status, 409); assert.equal((await replay.json()).error, 'request_failed_refunded');
    assert.deepEqual(await (await f.recover(request(null, 'GET'), body().idempotencyKey)).json(), { status: 'failed', refunded: true, credits: 3 });
    assert.equal(f.providerCalls.length, 1); assert.equal(f.count('ledger_debit'), 1);
});
test('price change and generation rate refusal do not debit', async () => {
    const f = fixture(); const response = await f.run(request({ ...body(), expectedCredits: 1 }));
    assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: 'price_changed', credits: 3 }); assert.equal(f.count('ledger_debit'), 0);
    const limited = fixture({ overrides: { check_generation_rate_limit: { ok: false, code: 'RATE_LIMITED', retry_after_seconds: 7 } } });
    const rate = await limited.run(request()); assert.equal(rate.status, 429); assert.equal(rate.headers.get('retry-after'), '7'); assert.equal(limited.count('ledger_debit'), 0);
});
test('read quota fails closed; all routes reject missing identity', async () => {
    const f = fixture({ overrides: { consume_account_read_request: { ok: false } } });
    assert.equal((await f.quote(request(null, 'GET'))).status, 503);
    assert.equal((await f.recover(request(null, 'GET'), body().idempotencyKey)).status, 503);
    assert.equal((await f.run(request(body(), 'POST', ''))).status, 401);
    assert.equal((await f.quote(request(null, 'GET', ''))).status, 401);
    assert.equal((await f.recover(request(null, 'GET', ''), body().idempotencyKey)).status, 401);
});
test('no instruction, timeline, reply or vendor/DB payload is logged', async t => {
    const lines = []; for (const method of ['error', 'warn', 'log', 'info']) t.mock.method(console, method, (...args) => lines.push(args));
    const f = fixture({ provider: async () => { throw Error('private vendor response'); }, overrides: { ledger_refund: new Error('private db message') } });
    await f.run(request());
    assert.deepEqual(lines, [['[editor-ai-edit]', 'refund_pending', JOB]]);
    await fixture({ overrides: { job_submitted: new Error('private DB') } }).run(request());
    await fixture({ overrides: { editor_ai_edit_settle: new Error('private reply') } }).run(request());
    await fixture({ overrides: { editor_ai_edit_lookup: new Error('private timeline') } }).run(request());
    assert.deepEqual(lines.map(line => line[1]), ['refund_pending', 'outcome_pending', 'settle_failure', 'lookup_failure']);
    for (const line of lines) assert.match(JSON.stringify(line), /^\["\[editor-ai-edit\]","[a-z_]+",(?:null|"[0-9a-f-]+")\]$/);
    assert.doesNotMatch(JSON.stringify(lines), /private|instruction|timeline|reply|DB/);
});
test('whole request deadline bounds a stalled RPC without a second effect', async () => {
    const f = fixture({ requestMs: 10, overrides: { job_submitted: () => new Promise(() => {}) } });
    const response = await f.run(request()); assert.equal(response.status, 503); assert.equal(f.providerCalls.length, 0); assert.equal(f.count('ledger_debit'), 1);
});
test('a successful provider taking more than 30 seconds remains within the 40-second deadline', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const f = fixture({ provider: () => new Promise(resolve => setTimeout(() => resolve({ text: '{"commands":[{"op":"split","kind":"video","id":"v1","frame":30}]}' }), 31_000)) });
    const response = f.run(request());
    // Digest uses WebCrypto, so allow its real I/O callback before advancing fake time.
    for (let i = 0; i < 200_000 && !f.providerCalls.length; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.providerCalls.length, 1); t.mock.timers.tick(31_001);
    assert.equal((await response).status, 200); assert.equal(f.count('ledger_refund'), 0);
});

test('16 KiB is a UTF-8 byte limit even when the legacy web code-unit check would pass', async () => {
    const f = fixture({ provider: async () => ({ text: JSON.stringify({ commands: [{ op: 'addText', text: 'Title', start: 0, len: 30 }], extra: '界'.repeat(6000) }) }) });
    const response = await f.run(request()); assert.equal(response.status, 422); assert.equal((await response.json()).refunded, true);
});

});
