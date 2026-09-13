import test from 'node:test';
import assert from 'node:assert/strict';

const { putObject, deleteObject, presignGetUrl } = await import('../packages/adapters/r2.js');

const BASE = { accountId: 'acc123', accessKeyId: 'k', secretAccessKey: 's', bucket: 'veyrnox-media' };

function recordFetch(status = 200) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), host: init && init.headers && init.headers.host });
        return new Response(null, { status });
    };
    return calls;
}

test('default-jurisdiction bucket uses the account endpoint', async () => {
    const calls = recordFetch();
    await putObject('fal/r1/a.png', new Uint8Array([1]), 'image/png', BASE);
    assert.equal(calls[0].url, 'https://acc123.r2.cloudflarestorage.com/veyrnox-media/fal/r1/a.png');
    assert.equal(calls[0].host, 'acc123.r2.cloudflarestorage.com');
    const { url } = await presignGetUrl('fal/r1/a.png', 300, BASE);
    assert.ok(url.startsWith('https://acc123.r2.cloudflarestorage.com/veyrnox-media/fal/r1/a.png?'));
});

test('an EU bucket is reached only through the eu endpoint, for put, delete and presign', async () => {
    const eu = { ...BASE, jurisdiction: 'eu' };
    const calls = recordFetch(204);
    await putObject('fal/r1/a.png', new Uint8Array([1]), 'image/png', eu);
    await deleteObject('fal/r1/a.png', eu);
    for (const c of calls) {
        assert.equal(new URL(c.url).host, 'acc123.eu.r2.cloudflarestorage.com');
        assert.equal(c.host, 'acc123.eu.r2.cloudflarestorage.com');
    }
    const { url } = await presignGetUrl('fal/r1/a.png', 300, eu);
    assert.equal(new URL(url).host, 'acc123.eu.r2.cloudflarestorage.com');
});

test('an unknown jurisdiction never reaches the network', async () => {
    const calls = recordFetch();
    const res = await putObject('k', new Uint8Array([1]), 'image/png', { ...BASE, jurisdiction: 'evil.example' });
    assert.deepEqual(res, { ok: false, error: 'R2 not configured' });
    await assert.rejects(presignGetUrl('k', 300, { ...BASE, jurisdiction: 'evil.example' }), /R2 not configured/);
    assert.equal(calls.length, 0);
});
