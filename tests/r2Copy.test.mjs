import test from 'node:test';
import assert from 'node:assert/strict';
import { copyUrlToR2 } from '../packages/adapters/r2.js';

const cfg = { accountId: 'acc', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' };

// Host and scheme checks run before any fetch, so these never touch the network.
test('refuses provider URLs outside the fal CDN allowlist', async () => {
    assert.equal((await copyUrlToR2('https://evil.example.com/x.png', 'k', cfg)).error, 'source host not allowed');
    assert.equal((await copyUrlToR2('https://169.254.169.254/latest', 'k', cfg)).error, 'source host not allowed');
    assert.equal((await copyUrlToR2('https://fal.media.evil.com/x', 'k', cfg)).error, 'source host not allowed');
    assert.equal((await copyUrlToR2('http://v3.fal.media/x.png', 'k', cfg)).error, 'source host not allowed');
    assert.equal((await copyUrlToR2('not a url', 'k', cfg)).error, 'source url invalid');
});

test('rejects a declared body over the cap without reading it', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('x', { status: 200, headers: { 'content-length': String(200 * 1024 * 1024) } });
    try {
        assert.equal((await copyUrlToR2('https://v3.fal.media/big.mp4', 'k', cfg)).error, 'source too large');
    } finally {
        globalThis.fetch = realFetch;
    }
});
