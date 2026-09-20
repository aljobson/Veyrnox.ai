import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';

const { presignPutUrl } = await import('../packages/adapters/r2.js');

const CFG = { accountId: 'acc123', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', bucket: 'veyrnox-ai-media', jurisdiction: 'eu' };
const KEY = 'uploads/11111111-2222-3333-4444-555555555555/abcdef.png';

// Independent SigV4 implementation, written from the AWS spec with node:crypto
// rather than Web Crypto. If the adapter's canonical request drifts — a missing
// newline, an unsorted header, the wrong method — these signatures diverge.
// A test that reused the adapter's own helpers would agree with any bug.
function expectedSignature(url, contentType, cfg) {
    const u = new URL(url);
    const amzDate = u.searchParams.get('X-Amz-Date');
    const dateStamp = amzDate.slice(0, 8);
    const query = new URLSearchParams(u.searchParams);
    query.delete('X-Amz-Signature');
    const sorted = [...query.entries()].sort(([a], [b]) => a.localeCompare(b));
    const canonicalQuery = sorted.map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');

    const canonicalRequest = [
        'PUT',
        u.pathname,
        canonicalQuery,
        `content-type:${contentType}`,
        `host:${u.host}`,
        '',
        'content-type;host',
        'UNSIGNED-PAYLOAD',
    ].join('\n');

    const scope = `${dateStamp}/auto/s3/aws4_request`;
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        scope,
        createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const kDate = createHmac('sha256', `AWS4${cfg.secretAccessKey}`).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update('auto').digest();
    const kService = createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    return createHmac('sha256', kSigning).update(stringToSign).digest('hex');
}

function enc(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

test('the signature matches an independently computed SigV4 PUT signature', async () => {
    const { url } = await presignPutUrl(KEY, 'image/png', 900, CFG);
    const actual = new URL(url).searchParams.get('X-Amz-Signature');
    assert.equal(actual, expectedSignature(url, 'image/png', CFG));
});

test('Content-Type is signed, so the upload cannot swap it', async () => {
    const { url, contentType } = await presignPutUrl(KEY, 'image/png', 900, CFG);
    assert.equal(contentType, 'image/png');
    assert.equal(new URL(url).searchParams.get('X-Amz-SignedHeaders'), 'content-type;host');
    // Same URL, a different declared type: the signature must not verify.
    assert.notEqual(new URL(url).searchParams.get('X-Amz-Signature'), expectedSignature(url, 'video/mp4', CFG));
});

test('a different content type produces a different signature', async () => {
    const png = await presignPutUrl(KEY, 'image/png', 900, CFG);
    const mp4 = await presignPutUrl(KEY, 'video/mp4', 900, CFG);
    assert.notEqual(
        new URL(png.url).searchParams.get('X-Amz-Signature'),
        new URL(mp4.url).searchParams.get('X-Amz-Signature'),
    );
});

test('content type is normalised, so client casing still matches the signature', async () => {
    const a = await presignPutUrl(KEY, 'Image/PNG', 900, CFG);
    const b = await presignPutUrl(KEY, 'image/png', 900, CFG);
    assert.equal(a.contentType, 'image/png');
    // Both sign the same canonical value; only X-Amz-Date may differ.
    assert.equal(a.contentType, b.contentType);
});

test('TTL is clamped to the 15-minute ceiling in both directions', async () => {
    assert.equal((await presignPutUrl(KEY, 'image/png', 86400, CFG)).expires, 900);
    assert.equal((await presignPutUrl(KEY, 'image/png', 1, CFG)).expires, 60);
    assert.equal((await presignPutUrl(KEY, 'image/png', 300, CFG)).expires, 300);
});

test('the EU jurisdiction endpoint is used, matching the media bucket', async () => {
    const { url } = await presignPutUrl(KEY, 'image/png', 900, CFG);
    assert.ok(url.startsWith('https://acc123.eu.r2.cloudflarestorage.com/veyrnox-ai-media/uploads/'), url);
});

test('key segments are escaped per RFC 3986 without escaping the separators', async () => {
    const { url } = await presignPutUrl('uploads/u1/a b(1).png', 'image/png', 900, CFG);
    const path = new URL(url).pathname;
    assert.equal(path, '/veyrnox-ai-media/uploads/u1/a%20b%281%29.png');
    // Still verifies after escaping.
    assert.equal(new URL(url).searchParams.get('X-Amz-Signature'), expectedSignature(url, 'image/png', CFG));
});

test('an unconfigured bucket throws rather than returning an unsigned URL', async () => {
    await assert.rejects(() => presignPutUrl(KEY, 'image/png', 900, { accountId: 'acc' }), /not configured/);
    // An unknown jurisdiction is not guessed at — same rule as presignGetUrl.
    await assert.rejects(() => presignPutUrl(KEY, 'image/png', 900, { ...CFG, jurisdiction: 'us' }), /not configured/);
});

test('an empty content type is refused rather than signed as blank', async () => {
    await assert.rejects(() => presignPutUrl(KEY, '', 900, CFG), /contentType required/);
    await assert.rejects(() => presignPutUrl(KEY, '   ', 900, CFG), /contentType required/);
});
