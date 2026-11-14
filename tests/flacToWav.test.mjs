import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { flacToWav, looksLikeFlac } from '../lib/flacToWav.js';
import { copyUrlToR2 } from '../packages/adapters/r2Copy.js';
import { createFalWebhookHandler } from '../lib/falWebhookHandler.js';

// ACE-Step 1.5 returns FLAC, which no Music editing path reads. The Worker decodes it
// to WAV when the file arrives (docs/product/music-source-formats-plan-2026-11-14.md).
// Each fixture was encoded by ffmpeg; the hash is of ffmpeg's own decode to raw PCM,
// so a match means the decoder is bit-exact with the reference decoder.

const fixture = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/flac/${name}.flac`, import.meta.url)));
const REFERENCE = {
    'mono': { rate: 22050, channels: 1, bits: 16, pcm: '1602667689e709424dfd000343c9bc86f0a07cd6c6426570d12d0ac109f88d15' },
    's16-left-side': { rate: 44100, channels: 2, bits: 16, pcm: '684b80b213684ab5f2f77e4ccd508541d798f80b14dbe2d6013d28e44013bbe0' },
    's16-right-side': { rate: 44100, channels: 2, bits: 16, pcm: '684b80b213684ab5f2f77e4ccd508541d798f80b14dbe2d6013d28e44013bbe0' },
    's16-mid-side': { rate: 48000, channels: 2, bits: 16, pcm: '26a17eafb4764366fa70c62679600c5dafd36c76a5545794b7ac01eb204b5605' },
    's24': { rate: 48000, channels: 2, bits: 24, pcm: '551f4354edeb12bf3c12e9f1cd1736db46416038ff65c255c1a84d61d5093d00' },
};

for (const [name, ref] of Object.entries(REFERENCE)) {
    test(`${name}: decodes bit-exact to a WAV of the same format`, () => {
        const out = flacToWav(fixture(name));
        assert.equal(out.sampleRate, ref.rate);
        assert.equal(out.channels, ref.channels);
        assert.equal(out.bitsPerSample, ref.bits);
        const v = new DataView(out.wav.buffer);
        assert.equal(new TextDecoder().decode(out.wav.subarray(0, 4)), 'RIFF');
        assert.equal(new TextDecoder().decode(out.wav.subarray(8, 12)), 'WAVE');
        assert.equal(v.getUint16(20, true), 1, 'PCM');
        assert.equal(v.getUint32(24, true), ref.rate);
        assert.equal(v.getUint16(34, true), ref.bits);
        assert.equal(v.getUint32(40, true), out.wav.length - 44);
        assert.equal(createHash('sha256').update(out.wav.subarray(44)).digest('hex'), ref.pcm);
    });
}

test('a corrupted frame fails its CRC instead of producing wrong audio', () => {
    const bytes = fixture('s16-mid-side');
    bytes[bytes.length - 200] ^= 0x10;
    assert.throws(() => flacToWav(bytes), /flac:/);
});

test('a truncated stream is refused', () => {
    const bytes = fixture('s24');
    assert.throws(() => flacToWav(bytes.subarray(0, bytes.length - 500)), /flac:/);
});

test('output larger than the cap is refused', () => {
    assert.throws(() => flacToWav(fixture('s24'), { maxOutputBytes: 1000 }), /too large/);
});

test('only FLAC is recognised', () => {
    assert.equal(looksLikeFlac(fixture('mono')), true);
    assert.equal(looksLikeFlac(new TextEncoder().encode('RIFF....WAVEfmt ')), false);
    assert.equal(looksLikeFlac(new Uint8Array(0)), false);
});

const cfg = { accountId: 'fixture', accessKeyId: 'fixture', secretAccessKey: 'fixture', bucket: 'fixture' };
async function copyWith(bytes, options) {
    const realFetch = globalThis.fetch;
    const put = {};
    globalThis.fetch = async (url, init = {}) => {
        if (String(url).includes('fal.media')) return new Response(bytes, { status: 200, headers: { 'content-type': 'audio/flac' } });
        put.size = init.body?.byteLength ?? init.body?.length;
        return new Response(null, { status: 200 });
    };
    try { return { res: await copyUrlToR2('https://v3.fal.media/a.flac', 'k', cfg, options), put }; }
    finally { globalThis.fetch = realFetch; }
}

test('with flacToWav a FLAC output is stored as WAV, hashed as the WAV', async () => {
    const wav = flacToWav(fixture('s16-mid-side')).wav;
    const { res, put } = await copyWith(fixture('s16-mid-side'), { flacToWav: true });
    assert.equal(res.ok, true);
    assert.equal(res.mimeType, 'audio/wav');
    assert.equal(res.size, wav.length);
    assert.equal(put.size, wav.length);
    assert.equal(res.sha256, createHash('sha256').update(wav).digest('hex'));
});

test('without the option FLAC is stored as FLAC', async () => {
    const { res } = await copyWith(fixture('mono'), {});
    assert.equal(res.mimeType, 'audio/flac');
});

test('a FLAC that fails to decode is stored as FLAC, not lost', async () => {
    const bytes = fixture('s16-mid-side');
    bytes[bytes.length - 200] ^= 0x10;
    const { res } = await copyWith(bytes, { flacToWav: true });
    assert.equal(res.ok, true);
    assert.equal(res.mimeType, 'audio/flac');
});

function webhook(modelId) {
    const copies = [];
    let state = 'SUBMITTED', attempt = 0, processed = false;
    const handler = createFalWebhookHandler({
        config: () => ({ supabaseUrl: 'https://fixture.invalid', serviceRoleKey: 'fixture' }),
        storageConfig: () => cfg, expectedTenant: () => 'fixture', verify: async () => true,
        fetchCall: async (url, init = {}) => {
            if (url.pathname.endsWith('/jobs')) return Response.json([{ id: 'job', user_id: 'owner', credits: 3, state, model_id: modelId }]);
            if (init.method === 'PATCH') { processed = true; return new Response(null, { status: 204 }); }
            if (init.method === 'POST') return Response.json(attempt++ ? [] : [{ id: 'event' }], { status: 201 });
            return Response.json([{ processed_at: processed ? 'done' : null }]);
        },
        rpcCall: async (name) => { if (name === 'job_succeeded') state = 'SUCCEEDED'; if (name === 'job_stored') state = 'STORED'; return { ok: true }; },
        copyAsset: async (url, key, storage, options) => { copies.push(options); return { ok: true, r2Key: key, mimeType: 'audio/wav', size: 1, sha256: 'a'.repeat(64) }; },
    });
    const req = new Request('https://fixture.invalid/webhook', {
        method: 'POST',
        headers: { 'x-fal-webhook-request-id': 'request-fixture', 'x-fal-webhook-user-id': 'fixture' },
        body: JSON.stringify({ request_id: 'request-fixture', status: 'OK', payload: { audio: { url: 'https://v3.fal.media/a.flac' } } }),
    });
    return { run: () => handler(req), copies };
}

test('the webhook asks for FLAC to WAV for ACE-Step 1.5 only', async () => {
    const premium = webhook('ace-step-1.5');
    assert.equal((await premium.run()).status, 200);
    assert.deepEqual(premium.copies[0], { flacToWav: true });
    const standard = webhook('ace-step');
    assert.equal((await standard.run()).status, 200);
    assert.equal(standard.copies[0], undefined);
});
