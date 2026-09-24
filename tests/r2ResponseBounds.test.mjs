import test from 'node:test';
import assert from 'node:assert/strict';
import { listObjects } from '../packages/adapters/r2.js';

test('oversized R2 listing is cancelled and refused before XML parsing', async () => {
    const original = globalThis.fetch;
    let cancelled = false;
    globalThis.fetch = async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); },
        cancel() { cancelled = true; },
    }));
    try {
        const result = await listObjects('uploads/', {
            accountId: 'test', accessKeyId: 'test', secretAccessKey: 'test', bucket: 'test',
        });
        assert.equal(result.ok, false);
        assert.equal(cancelled, true);
    } finally { globalThis.fetch = original; }
});
