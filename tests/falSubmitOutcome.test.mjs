import test from 'node:test';
import assert from 'node:assert/strict';
import { submitJob } from '../packages/adapters/fal.js';

const job = { job_id: 'job-test-1', provider_endpoint: 'fal-ai/flux-2-pro', inputs: { prompt: 'A teapot' } };
const cfg = { falKey: 'test-key', webhookBaseUrl: 'https://veyrnox.test/api/webhook/fal' };

test('valid acceptance returns the handle without another submission', async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ request_id: 'request-1' }));
    assert.deepEqual(await submitJob(job, cfg), { ok: true, outcome: 'accepted', providerJobId: 'request-1', statusUrl: undefined });
    assert.equal(fetch.mock.callCount(), 1);
});

test('explicit client refusals are rejected; timeouts and server errors are uncertain', async (t) => {
    t.mock.method(console, 'error', () => {});
    for (const status of [400, 401, 403, 422, 429, 408, 500, 502, 503, 504]) {
        const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('failure', { status }));
        const result = await submitJob(job, cfg);
        assert.equal(result.ok, false);
        assert.equal(result.outcome, status < 500 && status !== 408 ? 'rejected' : 'unknown', String(status));
        assert.equal(fetch.mock.callCount(), 1);
        fetch.mock.restore();
    }
});

test('lost connection and actual abort are unknown, with no retry', async (t) => {
    t.mock.method(console, 'error', () => {});
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('connection reset'); });
    assert.equal((await submitJob(job, cfg)).outcome, 'unknown');
    assert.equal(fetch.mock.callCount(), 1);
    fetch.mock.restore();
    const aborted = t.mock.method(globalThis, 'fetch', async (_url, { signal }) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    assert.equal((await submitJob(job, { ...cfg, timeoutMs: 5 })).outcome, 'unknown');
    assert.equal(aborted.mock.callCount(), 1);
});

test('malformed or unusable acceptance cannot be declared a rejection', async (t) => {
    t.mock.method(console, 'error', () => {});
    for (const body of ['not json', 'null', '{}', '{"request_id":123}', '{"request_id":"bad/handle"}', 'x'.repeat(128 * 1024 + 1)]) {
        const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(body));
        const result = await submitJob(job, cfg);
        assert.equal(result.ok, false);
        assert.equal(result.outcome, 'unknown');
        assert.equal(fetch.mock.callCount(), 1);
        fetch.mock.restore();
    }
});

test('a stalled acceptance body is bounded by the submit timeout', async (t) => {
    t.mock.method(console, 'error', () => {});
    let canceled = false;
    t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ cancel() { canceled = true; } })));
    const result = await submitJob(job, { ...cfg, timeoutMs: 5 });
    assert.equal(result.outcome, 'unknown');
    assert.equal(canceled, true);
});

test('local validation rejects before touching the provider', async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected provider call'); });
    assert.equal((await submitJob({ ...job, provider_endpoint: '../bad' }, cfg)).outcome, 'rejected');
    assert.equal(fetch.mock.callCount(), 0);
});
