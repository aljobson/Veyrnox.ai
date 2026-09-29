import test from 'node:test';
import assert from 'node:assert/strict';
import { getObject } from '../packages/adapters/r2.js';

const cfg = { accountId: 'acct', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'bucket' };

test('refuses when R2 is not configured', async () => {
    assert.deepEqual(await getObject('assets/a.jpg', {}), { ok: false, error: 'R2 not configured' });
});

test('signs a GET against the SigV4 endpoint and returns the raw response on success', async () => {
    const realFetch = globalThis.fetch;
    let sentUrl, sentHeaders;
    globalThis.fetch = async (url, init) => {
        sentUrl = url; sentHeaders = init.headers;
        return new Response('bytes', { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': '5' } });
    };
    try {
        const result = await getObject('assets/a.jpg', cfg);
        assert.equal(result.ok, true);
        assert.equal(result.response.status, 200);
        assert.equal(new URL(sentUrl).pathname, '/bucket/assets/a.jpg');
        assert.ok(sentHeaders.authorization.startsWith('AWS4-HMAC-SHA256'));
        assert.ok(sentHeaders['x-amz-date']);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('reports a non-ok status as a failure, not a thrown exception', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('not found', { status: 404 });
    try {
        assert.deepEqual(await getObject('assets/missing.jpg', cfg), { ok: false, error: 'R2 GET 404' });
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('reports a transport failure without throwing', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new DOMException('aborted', 'AbortError'); };
    try {
        const result = await getObject('assets/a.jpg', cfg);
        assert.equal(result.ok, false);
        assert.match(result.error, /R2 GET transport/);
    } finally {
        globalThis.fetch = realFetch;
    }
});
