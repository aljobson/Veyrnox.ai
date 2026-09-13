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

// The Workers runtime throws on redirect: 'error', which made every copy fail
// in production while this suite (on Node, where 'error' is valid) passed.
test('fetches the source with redirect manual, the only non-following mode Workers accept', async () => {
    const realFetch = globalThis.fetch;
    let seen;
    globalThis.fetch = async (url, init) => {
        if (String(url).includes('fal.media')) { seen = init && init.redirect; return new Response('x', { status: 302, headers: { location: 'https://evil.example.com/x' } }); }
        throw new Error('unexpected fetch ' + url);
    };
    try {
        const res = await copyUrlToR2('https://v3.fal.media/out.wav', 'k', cfg);
        assert.equal(seen, 'manual');
        assert.equal(res.error, 'source 302');
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('each provider may only copy from its own CDN', async () => {
    // A kie output host is refused on the fal path, and vice versa.
    assert.equal((await copyUrlToR2('https://tempfile.aiquickdraw.com/x.mp4', 'k', cfg)).error, 'source host not allowed');
    assert.equal((await copyUrlToR2('https://v3.fal.media/x.png', 'k', cfg, { provider: 'kie' })).error, 'source host not allowed');
    assert.equal((await copyUrlToR2('https://v3.fal.media/x.png', 'k', cfg, { provider: 'nope' })).error, 'source host not allowed');
    assert.equal((await copyUrlToR2('https://aiquickdraw.com.evil.com/x', 'k', cfg, { provider: 'kie' })).error, 'source host not allowed');
});
