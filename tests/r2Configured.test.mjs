import test from 'node:test';
import assert from 'node:assert/strict';

const { isConfigured } = await import('../packages/adapters/r2.js');
const { copyUrlToR2 } = await import('../packages/adapters/r2Copy.js');

const FULL = { accountId: 'acc', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' };

test('every credential is required, not just the account id', () => {
    assert.equal(isConfigured(FULL), true);
    for (const missing of Object.keys(FULL)) {
        const partial = { ...FULL, [missing]: undefined };
        assert.equal(isConfigured(partial), false, `missing ${missing} must not read as configured`);
        assert.equal(isConfigured({ ...FULL, [missing]: '' }), false, `empty ${missing}`);
    }
});

test('no config at all', () => {
    assert.equal(isConfigured(undefined), false);
    assert.equal(isConfigured(null), false);
    assert.equal(isConfigured({}), false);
});

test('an unconfigured copy still reports the config fault rather than uploading', async () => {
    // The webhook now refuses before reaching this, but the guard inside
    // putObject stays: a partial config must never produce a silent success.
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('bytes', {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': '5' },
    });
    try {
        const res = await copyUrlToR2('https://v3.fal.media/x.png', 'k', { ...FULL, secretAccessKey: undefined });
        assert.equal(res.ok, false);
        assert.equal(res.error, 'R2 not configured');
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('an EU jurisdiction is accepted; anything else reads as not configured', () => {
    assert.equal(isConfigured({ ...FULL, jurisdiction: 'eu' }), true);
    assert.equal(isConfigured({ ...FULL, jurisdiction: undefined }), true);
    for (const bad of ['EU', 'us', 'fedramp', 'eu.evil.com', 'x']) {
        assert.equal(isConfigured({ ...FULL, jurisdiction: bad }), false, bad);
    }
});
