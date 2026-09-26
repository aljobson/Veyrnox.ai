import test from 'node:test';
import assert from 'node:assert/strict';
import { copyUrlToR2 } from '../packages/adapters/r2Copy.js';

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
    // The byteplus allowlist is empty until a live output host is recorded (ADR-0058).
    assert.equal((await copyUrlToR2('https://ark.ap-southeast.bytepluses.com/x.mp4', 'k', cfg, { provider: 'byteplus' })).error, 'source host not allowed');
});

// ADR-0025 option E: the digest is what lets a holder of a file check it
// against our record, so it has to be the hash of the exact bytes stored.
test('returns the SHA-256 of the copied bytes', async () => {
    const realFetch = globalThis.fetch;
    // Known vector: SHA-256 of "abc".
    const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    globalThis.fetch = async (url) => {
        if (String(url).includes('fal.media')) return new Response('abc', { status: 200, headers: { 'content-type': 'image/png' } });
        return new Response(null, { status: 200 });
    };
    try {
        const res = await copyUrlToR2('https://v3.fal.media/out.png', 'k', cfg);
        assert.equal(res.ok, true);
        assert.equal(res.sha256, expected);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('a failed copy carries no digest', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('nope', { status: 404 });
    try {
        const res = await copyUrlToR2('https://v3.fal.media/out.png', 'k', cfg);
        assert.equal(res.ok, false);
        assert.equal(res.sha256, undefined);
    } finally {
        globalThis.fetch = realFetch;
    }
});

// The provider's Content-Type is attacker-influenceable — it is whatever the
// model host chooses to serve — and it used to be stored verbatim on the
// asset, so an output served as text/html became an HTML document behind a
// presigned URL of ours (audit 2026-09-23).
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const HTML = new TextEncoder().encode('<html><script>alert(1)</script></html>');

async function storedType(body, header) {
    const realFetch = globalThis.fetch;
    let put = null;
    globalThis.fetch = async (url, init = {}) => {
        if (String(url).includes('fal.media')) return new Response(body, { status: 200, headers: { 'content-type': header } });
        put = (init.headers && (init.headers['content-type'] || init.headers['Content-Type'])) || null;
        return new Response(null, { status: 200 });
    };
    try {
        const res = await copyUrlToR2('https://v3.fal.media/out.bin', 'k', cfg);
        return { ok: res.ok, mimeType: res.mimeType, put };
    } finally {
        globalThis.fetch = realFetch;
    }
}

test('the stored media type comes from the bytes, never from the provider header', async () => {
    // Real PNG mislabelled as HTML: stored as the image it is.
    const png = await storedType(PNG, 'text/html');
    assert.equal(png.ok, true);
    assert.equal(png.mimeType, 'image/png');

    // HTML dressed as a PNG: stored as an inert download, never text/html.
    const html = await storedType(HTML, 'image/png');
    assert.equal(html.ok, true);
    assert.equal(html.mimeType, 'application/octet-stream');
    assert.notEqual(html.mimeType, 'text/html');
});

test('an MP4-only copy still refuses anything that is not an MP4', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => (String(url).includes('fal.media')
        ? new Response(HTML, { status: 200, headers: { 'content-type': 'video/mp4' } })
        : new Response(null, { status: 200 }));
    try {
        const res = await copyUrlToR2('https://v3.fal.media/out.mp4', 'k', cfg, { expectMp4: true });
        assert.deepEqual(res, { ok: false, error: 'source not mp4' });
    } finally {
        globalThis.fetch = realFetch;
    }
});
