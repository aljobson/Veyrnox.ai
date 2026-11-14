import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFalWebhookHandler } from '../lib/falWebhookHandler.js';
import { copyUrlToR2 } from '../packages/adapters/r2Copy.js';

// Music Stems (mureka-stems-v3) answers with one ZIP. The generic copy stored it as
// application/octet-stream, and both stem readers (0480) ask for application/zip,
// so a paid stem request stayed "queued" for ever and was never refunded.

const cfg = { accountId: 'fixture', accessKeyId: 'fixture', secretAccessKey: 'fixture', bucket: 'fixture' };
const zipBytes = () => { const b = new Uint8Array(64); b.set([0x50, 0x4b, 0x03, 0x04]); return b; };

async function copyWith(bytes, options) {
    const realFetch = globalThis.fetch;
    let put = null;
    globalThis.fetch = async (url, init = {}) => {
        if (String(url).includes('fal.media')) return new Response(bytes, { status: 200, headers: { 'content-type': 'text/html' } });
        put = { type: init.headers?.['content-type'] ?? init.headers?.get?.('content-type') ?? null };
        return new Response(null, { status: 200 });
    };
    try {
        return { res: await copyUrlToR2('https://v3.fal.media/stems.zip', 'k', cfg, options), put };
    } finally {
        globalThis.fetch = realFetch;
    }
}

test('a ZIP-only copy stores the archive as application/zip', async () => {
    const { res } = await copyWith(zipBytes(), { expectZip: true });
    assert.equal(res.ok, true);
    assert.equal(res.mimeType, 'application/zip');
    assert.match(res.sha256, /^[0-9a-f]{64}$/);
});

test('a ZIP-only copy refuses anything that is not a ZIP, whatever the header says', async () => {
    const html = new TextEncoder().encode('<!doctype html><html><body>not an archive at all</body></html>');
    const { res } = await copyWith(html, { expectZip: true });
    assert.deepEqual(res, { ok: false, error: 'source not zip' });
});

test('without the option a ZIP is still stored as an inert download', async () => {
    const { res } = await copyWith(zipBytes(), {});
    assert.equal(res.ok, true);
    assert.equal(res.mimeType, 'application/octet-stream');
});

function fixture(modelId, copyResult = null) {
    const copies = [], rpcs = [];
    let state = 'SUBMITTED', processed = false, attempt = 0;
    const handler = createFalWebhookHandler({
        config: () => ({ supabaseUrl: 'https://fixture.invalid', serviceRoleKey: 'fixture' }),
        storageConfig: () => cfg, expectedTenant: () => 'fixture', verify: async () => true,
        fetchCall: async (url, init = {}) => {
            if (url.pathname.endsWith('/jobs')) {
                return Response.json(!url.searchParams.get('state') || url.searchParams.get('state').includes(state)
                    ? [{ id: 'job', user_id: 'owner', credits: 13, state, model_id: modelId }] : []);
            }
            if (init.method === 'PATCH') { processed = true; return new Response(null, { status: 204 }); }
            if (init.method === 'POST') return Response.json(attempt++ ? [] : [{ id: 'event' }], { status: 201 });
            return Response.json([{ processed_at: processed ? 'done' : null }]);
        },
        rpcCall: async (name, args) => {
            rpcs.push({ name, args });
            if (name === 'job_succeeded') { state = 'SUCCEEDED'; return { ok: true }; }
            if (name === 'job_stored') { state = 'STORED'; return { ok: true }; }
            return { ok: true };
        },
        copyAsset: async (url, key, storage, options) => {
            copies.push({ url, options });
            return copyResult ?? { ok: true, r2Key: key, mimeType: options?.expectZip ? 'application/zip' : 'audio/mpeg', size: 100, sha256: 'a'.repeat(64) };
        },
    });
    const request = (payload) => new Request('https://fixture.invalid/webhook', {
        method: 'POST',
        headers: { 'x-fal-webhook-request-id': 'request-fixture', 'x-fal-webhook-user-id': 'fixture' },
        body: JSON.stringify({ request_id: 'request-fixture', status: 'OK', payload }),
    });
    return { handler, request, copies, rpcs, get state() { return state; }, get processed() { return processed; } };
}

test('the Stems model is copied as a ZIP and stored as application/zip', async () => {
    const f = fixture('mureka-stems-v3');
    assert.equal((await f.handler(f.request({ zip_url: 'https://v3.fal.media/stems.zip' }))).status, 200);
    assert.deepEqual(f.copies[0].options, { expectZip: true });
    assert.equal(f.rpcs.find((r) => r.name === 'job_stored').args.p_mime_type, 'application/zip');
    assert.equal(f.state, 'STORED');
});

test('a Stems output that is not a ZIP is final: marked processed for the refund sweep, never stored', async () => {
    const f = fixture('mureka-stems-v3', { ok: false, error: 'source not zip' });
    assert.equal((await f.handler(f.request({ zip_url: 'https://v3.fal.media/stems.zip' }))).status, 200);
    assert.equal(f.processed, true);
    assert.equal(f.rpcs.some((r) => r.name === 'job_stored'), false);
});

test('other models keep the generic copy', async () => {
    const f = fixture('ace-step');
    assert.equal((await f.handler(f.request({ audio: { url: 'https://v3.fal.media/a.wav' } }))).status, 200);
    assert.equal(f.copies[0].options, undefined);
});

test('the stem readers still ask for application/zip, so the stored type must match it', () => {
    const sql = readFileSync(new URL('../packages/db/schema/supabase/0480_music_stem_archives.sql', import.meta.url), 'utf8');
    assert.equal((sql.match(/a\.mime_type='application\/zip'/g) ?? []).length, 2);
});
