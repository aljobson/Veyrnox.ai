// ADR-0067: the streaming chat adapter, against a fake fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_COMPLETIONS_URL, ChatProviderError, streamChat } from '../packages/adapters/openrouterChat.js';

const enc = new TextEncoder();
/** A Response whose body arrives in the given chunks. */
const sse = (chunks, status = 200) => new Response(new ReadableStream({
    start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); },
}), { status });
const frame = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
const collect = async (it) => { const out = []; for await (const x of it) out.push(x.delta); return out; };
const base = { apiKey: 'sk-test', model: 'vendor/model', messages: [{ role: 'user', content: 'hi' }], maxTokens: 1024 };

test('streams text, ignores comments and keep-alives, stops at [DONE]', async () => {
    const fetchImpl = async () => sse([': keep-alive\n\n', frame('Hel'), frame('lo'), 'data: [DONE]\n\n', frame('NEVER')]);
    assert.deepEqual(await collect(streamChat({ ...base, fetchImpl })), ['Hel', 'lo']);
});

test('a frame split across network chunks is reassembled', async () => {
    const whole = frame('split');
    const fetchImpl = async () => sse([whole.slice(0, 20), whole.slice(20, 41), whole.slice(41)]);
    assert.deepEqual(await collect(streamChat({ ...base, fetchImpl })), ['split']);
});

test('sends a constant URL, the key, and the caps; the body decides nothing about the host', async () => {
    let seen;
    const fetchImpl = async (url, init) => { seen = { url, init }; return sse(['data: [DONE]\n\n']); };
    await collect(streamChat({ ...base, model: 'vendor/model:free', fetchImpl }));
    assert.equal(seen.url, CHAT_COMPLETIONS_URL);
    assert.equal(CHAT_COMPLETIONS_URL, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(seen.init.method, 'POST');
    assert.equal(seen.init.headers.Authorization, 'Bearer sk-test');
    assert.deepEqual(JSON.parse(seen.init.body), { model: 'vendor/model:free', messages: base.messages, max_tokens: 1024, stream: true });
});

test('refuses a missing key and a model slug that could carry anything else', async () => {
    const never = async () => { assert.fail('must not call the provider'); };
    await assert.rejects(collect(streamChat({ ...base, apiKey: '', fetchImpl: never })), { code: 'provider_not_configured' });
    for (const model of ['', 'a b', '../x', 'x'.repeat(200), '/etc/passwd', 'vendor/model\n', null]) {
        await assert.rejects(collect(streamChat({ ...base, model, fetchImpl: never })), { code: 'provider_model_unmapped' }, String(model));
    }
});

test('HTTP errors become typed codes, never the vendor message', async () => {
    for (const [status, code] of [[402, 'provider_payment_required'], [401, 'provider_auth_failed'], [403, 'provider_auth_failed'],
        [404, 'provider_model_unavailable'], [408, 'provider_timeout'], [429, 'provider_rate_limited'], [400, 'provider_request_rejected'],
        [500, 'provider_unavailable'], [503, 'provider_unavailable']]) {
        const fetchImpl = async () => new Response('{"error":{"message":"secret account detail for user@x"}}', { status });
        await assert.rejects(collect(streamChat({ ...base, fetchImpl })), (e) => e instanceof ChatProviderError && e.code === code && !e.message.includes('secret'), String(status));
    }
});

test('an error inside the stream, a dropped connection and a network failure are typed', async () => {
    await assert.rejects(collect(streamChat({ ...base, fetchImpl: async () => sse([frame('ok'), 'data: {"error":{"message":"x"}}\n\n']) })), { code: 'provider_error' });
    const dropped = new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(frame('part'))); }, pull() { throw new Error('reset'); } }));
    const got = []; 
    await assert.rejects((async () => { for await (const x of streamChat({ ...base, fetchImpl: async () => dropped })) got.push(x.delta); })(), { code: 'provider_dropped' });
    assert.deepEqual(got, ['part'], 'text before the drop was delivered');
    await assert.rejects(collect(streamChat({ ...base, fetchImpl: async () => { throw new TypeError('fetch failed'); } })), { code: 'provider_unavailable' });
});

test('an abort is passed through as an abort, not disguised as a provider failure', async () => {
    const ac = new AbortController();
    const fetchImpl = async (_u, { signal }) => { ac.abort(); signal.throwIfAborted(); };
    await assert.rejects(collect(streamChat({ ...base, signal: ac.signal, fetchImpl })), (e) => !(e instanceof ChatProviderError));
});

test('malformed JSON frames are skipped, empty deltas are not yielded', async () => {
    const fetchImpl = async () => sse(['data: {not json}\n\n', frame(''), 'data: {"choices":[{"delta":{}}]}\n\n', frame('kept')]);
    assert.deepEqual(await collect(streamChat({ ...base, fetchImpl })), ['kept']);
});

test('sends a reasoning effort when one is set, and no reasoning key when it is not', async () => {
    const bodies = [];
    const fetchImpl = async (_u, init) => { bodies.push(JSON.parse(init.body)); return sse(['data: [DONE]\n\n']); };
    await collect(streamChat({ ...base, reasoningEffort: 'low', fetchImpl }));
    await collect(streamChat({ ...base, fetchImpl }));
    await collect(streamChat({ ...base, reasoningEffort: null, fetchImpl }));
    assert.deepEqual(bodies[0].reasoning, { effort: 'low' });
    assert.equal('reasoning' in bodies[1], false);
    assert.equal('reasoning' in bodies[2], false);
});

test('an unknown reasoning effort is never sent', async () => {
    let body;
    const fetchImpl = async (_u, init) => { body = JSON.parse(init.body); return sse(['data: [DONE]\n\n']); };
    await collect(streamChat({ ...base, reasoningEffort: 'extreme', fetchImpl }));
    assert.equal('reasoning' in body, false);
});

test('reasoning text in the stream is never yielded as reply text', async () => {
    const f = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
    const fetchImpl = async () => sse([f({ reasoning: 'thinking about it' }), f({ reasoning_details: [{ text: 'x' }] }), f({ content: 'Answer.' }), 'data: [DONE]\n\n']);
    assert.deepEqual(await collect(streamChat({ ...base, reasoningEffort: 'low', fetchImpl })), ['Answer.']);
});
