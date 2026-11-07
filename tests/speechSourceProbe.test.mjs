import test from 'node:test';
import assert from 'node:assert/strict';
import { probeSpeechSource, SPEECH_PROBE_MAX_BYTES } from '../lib/speechSourceProbe.js';
import { speechCorrelation, verifySpeechCorrelation } from '../lib/speechCutCorrelation.js';
import { JOB, r2 } from './fixtures/speechAnalysisHarness.mjs';
const wav = () => {
    const bytes = new Uint8Array(44 + 16000 * 2), view = new DataView(bytes.buffer);
    const text = (start, value) => bytes.set(new TextEncoder().encode(value), start);
    text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, bytes.length - 44, true); return bytes;
};
test('trusted WAV measured using server-signed URL, capped exact range and no redirects', async () => {
    const bytes = wav(), calls = [], asset = { size_bytes: bytes.length, sha256: 'a'.repeat(64), mime_type: 'audio/wav', r2_key: 'owned' };
    const probe = await probeSpeechSource(asset, r2, { sign: async (key, ttl) => { assert.equal(key, 'owned'); assert.equal(ttl, 300); return { url: 'https://r2.test/owned' }; },
        fetcher: async (url, init, timeout, cap) => { calls.push({ url, init, cap }); assert.ok(timeout <= 5000); return new Response(bytes, { status: 206 }); } });
    assert.deepEqual(probe, { duration: 1, mime: 'audio/wav', fingerprint: 'a'.repeat(64) });
    assert.equal(calls[0].url, 'https://r2.test/owned'); assert.equal(calls[0].init.redirect, 'error'); assert.equal(calls[0].init.headers.Range, `bytes=0-${bytes.length - 1}`); assert.ok(calls[0].cap <= SPEECH_PROBE_MAX_BYTES);
});
test('unsupported container, forged fingerprint, malformed/range-ignoring response fail closed', async () => {
    const base = { size_bytes: 100000, sha256: 'a'.repeat(64), mime_type: 'audio/wav', r2_key: 'owned' };
    let reads = 0;
    const deps = { sign: async () => ({ url: 'https://r2.test/owned' }), fetcher: async () => { reads++; return new Response(new Uint8Array(12), { status: 200 }); } };
    assert.equal(await probeSpeechSource({ ...base, mime_type: 'image/png' }, r2, deps), null);
    assert.equal(await probeSpeechSource({ ...base, sha256: 'caller-url' }, r2, deps), null); assert.equal(reads, 0);
    assert.equal(await probeSpeechSource(base, r2, deps), null); assert.equal(reads, 1);
    assert.equal(await probeSpeechSource(base, r2, { ...deps, sign: async () => { throw Error('private signing failure'); } }), null);
    assert.equal(await probeSpeechSource(base, r2, { ...deps, fetcher: async () => { throw Error('signed URL'); } }), null);
});
test('correlation token is bound to job and Worker secret; malformed/tampered tokens refused', async () => {
    const secret = 's'.repeat(32), token = await speechCorrelation(JOB, secret);
    assert.equal(await verifySpeechCorrelation(JOB, token, secret), true);
    assert.equal(await verifySpeechCorrelation(JOB, token, 'z'.repeat(32)), false);
    assert.equal(await verifySpeechCorrelation('33333333-3333-4333-8333-333333333333', token, secret), false);
    assert.equal(await verifySpeechCorrelation(JOB, token.slice(1), secret), false);
    assert.equal(await verifySpeechCorrelation(JOB, token, ''), false);
});
