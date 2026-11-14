import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { serveEditorVision, visionAdmission } from '../lib/editorVisionAdmission.mjs';
import { editorFeatureEnabled } from '../lib/editorRuntimeFlags.mjs';
import { EDITOR_VISION_PATH, FACE_VISION_PATH, HAIR_VISION_PATH, editorVisionWorkerPolicy } from '../app/veyrnox/_lib/editorVisionRuntime.mjs';
import { VISION_RELEASES, FACE_ASSETS, visionDigest, validateVisionManifest } from '../scripts/editor-vision-assets.mjs';
import { parseJsonc } from '../scripts/check-migration-ledger.mjs';
test('Worker-first GET/HEAD admission has independent gates and overrides asset caching', async () => {
    let fetches = 0;
    for (const localInference of ['false', 'true']) for (const photoStudio of ['false', 'true']) {
        const env = { EDITOR_RUNTIME_FLAGS: JSON.stringify({ localInference, photoStudio }), ASSETS: { fetch: async () => { fetches++; return new Response('asset', { headers: { 'Cache-Control': 'public, max-age=31536000', 'Content-Type': 'application/octet-stream' } }); } } };
        for (const [prefix, model] of [[EDITOR_VISION_PATH, 'selfie_multiclass_256x256.tflite'], [FACE_VISION_PATH, 'face_landmarker.task'], [HAIR_VISION_PATH, 'selfie_multiclass_256x256.tflite']]) for (const name of ['worker.mjs', model]) for (const method of ['GET', 'HEAD']) {
            const enabled = localInference === 'true' && (prefix === EDITOR_VISION_PATH || photoStudio === 'true');
            const before = fetches, result = await serveEditorVision(new Request(`https://veyrnox.ai${prefix}/${name}`, { method }), env);
            assert.equal(result.status, enabled ? 200 : 404); assert.equal(fetches - before, enabled ? 1 : 0);
            // Denials are never cached; an admitted file may be stored but must be revalidated before each use.
            assert.equal(result.headers.get('Cache-Control'), enabled ? 'no-cache' : 'no-store');
            if (enabled) assert.equal(result.headers.get('Content-Security-Policy'), editorVisionWorkerPolicy('https://veyrnox.ai', prefix));
            if (method === 'HEAD' || !enabled) assert.equal(await result.text(), '');
        }
    }
    assert.equal(visionAdmission(new Request('https://veyrnox.ai/showcase/test.mp4'), {}), null);
    const enabled = { EDITOR_RUNTIME_FLAGS: '{"localInference":"true","photoStudio":"true"}' };
    for (const path of ['/editor-vision/unknown/worker.mjs', `${FACE_VISION_PATH}/worker.mjs/extra`, `${FACE_VISION_PATH}/%77orker.mjs`]) assert.equal(visionAdmission(new Request(`https://veyrnox.ai${path}`), enabled).status, 404);
    assert.equal(visionAdmission(new Request(`https://veyrnox.ai${FACE_VISION_PATH}/worker.mjs`, { method: 'POST' }), enabled).status, 405);
});
test('Photo Studio is on in production through the shared binding, staging stays dark, and all immutable Workers remain pinned', async () => {
    const config = parseJsonc(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
    // The owner switched the web Photo Studio on in production (2026-11-14). It reads the one shared binding, so no Worker variable was added.
    assert.equal(editorFeatureEnabled('PHOTO_STUDIO_ENABLED', config.vars), true);
    // The face assets need both gates (see the admission test above), so local inference must stay on with it.
    assert.equal(editorFeatureEnabled('EDITOR_LOCAL_INFERENCE_ENABLED', config.vars), true);
    assert.equal(editorFeatureEnabled('PHOTO_STUDIO_ENABLED', config.env.staging.vars), false);
    assert.ok(config.vars.EDITOR_RUNTIME_FLAGS.length < 1024);
    assert.ok(config.assets.run_worker_first.includes('/editor-vision/*'));
    assert.equal(VISION_RELEASES.length, 3);
    for (const release of VISION_RELEASES) {
        const worker = release.assets.find(file => file.path === 'worker.mjs');
        assert.equal(visionDigest(await readFile(new URL(`../${worker.source}`, import.meta.url))), worker.sha256);
    }
    const files = FACE_ASSETS.map(f => ({ ...f, bytes: f.bytes ?? 1, sha256: f.sha256 ?? '0'.repeat(64) }));
    const manifest = { version: VISION_RELEASES[1].version, files };
    validateVisionManifest(manifest, files, manifest.version);
    assert.throws(() => validateVisionManifest({ ...manifest, version: VISION_RELEASES[0].version }, files, manifest.version));
});
test('upstream asset errors are never cacheable and conditional 304s pass through', async () => {
    const flags = JSON.stringify({ localInference: 'true', photoStudio: 'true' });
    const url = `https://veyrnox.ai${FACE_VISION_PATH}/face_landmarker.task`;
    for (const status of [404, 500, 503]) {
        const result = await serveEditorVision(new Request(url), { EDITOR_RUNTIME_FLAGS: flags, ASSETS: { fetch: async () => new Response('x', { status, headers: { 'Cache-Control': 'public, max-age=31536000' } }) } });
        assert.equal(result.status, status); assert.equal(result.headers.get('Cache-Control'), 'no-store');
    }
    const seen = [];
    const result = await serveEditorVision(new Request(url, { headers: { 'If-None-Match': '"abc"' } }), { EDITOR_RUNTIME_FLAGS: flags, ASSETS: { fetch: async request => { seen.push(request.headers.get('If-None-Match')); return new Response(null, { status: 304, headers: { ETag: '"abc"' } }); } } });
    // The binding ignored the conditional header and answered 200: the Worker itself must turn a matching ETag into a 304.
    for (const [header, status] of [['"abc"', 304], ['W/"abc"', 304], ['"zzz", "abc"', 304], ['*', 304], ['"other"', 200], [null, 200]]) {
        const reply = await serveEditorVision(new Request(url, header ? { headers: { 'If-None-Match': header } } : {}), { EDITOR_RUNTIME_FLAGS: flags, ASSETS: { fetch: async () => new Response('bytes', { status: 200, headers: { ETag: '"abc"' } }) } });
        assert.equal(reply.status, status, String(header)); assert.equal(reply.headers.get('Cache-Control'), 'no-cache');
        assert.equal(await reply.text(), status === 304 ? '' : 'bytes');
    }
    assert.deepEqual(seen, ['"abc"']); assert.equal(result.status, 304); assert.equal(result.headers.get('Cache-Control'), 'no-cache'); assert.equal(result.headers.get('ETag'), '"abc"');
});
test('direct page and internal route requests are 404 with photoStudio off regardless of browser preview input', async () => {
    const { register } = await import('node:module');
    register('data:text/javascript,' + encodeURIComponent("export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c);}"));
    const { NextRequest } = await import('next/server.js');
    const { middleware } = await import('../middleware.js');
    const names = ['EDITOR_RUNTIME_FLAGS', 'PHOTO_STUDIO_ENABLED'];
    const previous = names.map(name => process.env[name]);
    try {
        delete process.env.PHOTO_STUDIO_ENABLED;
        process.env.EDITOR_RUNTIME_FLAGS = '{"localInference":"true"}';
        for (const path of ['/app/photo-studio', '/veyrnox/app/photo-studio', '/app/photo-studio/nested']) {
            const response = await middleware(new NextRequest(`https://veyrnox.ai${path}?photoStudio=true`, { headers: { cookie: 'veyrnox_photo_studio_preview=1' } }));
            assert.equal(response.status, 404); assert.equal(response.headers.get('Cache-Control'), 'no-store');
        }
    } finally { names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; }); }
});
test('Vey hides the generated route until the server photoStudio gate is enabled', async () => {
    const { publicProductInventory } = await import('../lib/productKnowledge.js');
    assert.equal(publicProductInventory({}).some(entry => entry.route === '/app/photo-studio'), false);
    assert.equal(publicProductInventory({ EDITOR_RUNTIME_FLAGS: '{"photoStudio":"true"}' }).some(entry => entry.route === '/app/photo-studio'), true);
});
