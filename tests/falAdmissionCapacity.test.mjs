import test from 'node:test';
import assert from 'node:assert/strict';
import { admitFalDispatch } from '../lib/falDispatch.js';
const args = { userId: 'fixture-user', key: 'fixture-key', model: { id: 'flux-2-pro', provider_endpoint: 'fal-ai/flux-2-pro' },
    record: { inputs: { prompt: {} }, rename: {}, media: {}, fixed: {} },
    inputs: { prompt: 'test' }, jobInputs: { prompt: 'test' }, cfg: {} };

test('full or paused capacity returns retryable 503 and never publishes', async () => {
    for (const code of ['PROVIDER_CAPACITY_UNAVAILABLE', 'PROVIDER_ADMISSION_PAUSED']) {
        let calls = 0, published = 0;
        const response = await admitFalDispatch({ ...args,
            rpc: async () => { calls++; return { ok: false, code, retry_after_seconds: 9999 }; },
            onCommitted: async () => { published++; } });
        assert.equal(response.status, 503);
        assert.equal(response.headers.get('retry-after'), '600');
        assert.deepEqual(await response.json(), { error: code.toLowerCase() });
        assert.equal(calls, 1); assert.equal(published, 0);
    }
});

test('replay remains successful and a lost acknowledgement stays distinct', async () => {
    const replay = await admitFalDispatch({ ...args, rpc: async () => ({ ok: true, idempotent: true, job_id: 'existing', state: 'STORED' }) });
    assert.equal(replay.status, 200);
    const lost = await admitFalDispatch({ ...args, rpc: async () => { throw Error('lost'); } });
    assert.equal(lost.status, 503);
    assert.deepEqual(await lost.json(), { error: 'dispatch_acceptance_unknown' });
    assert.equal(lost.headers.get('retry-after'), null);
});
