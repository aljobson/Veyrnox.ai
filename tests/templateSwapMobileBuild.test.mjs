import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url), hash = value => createHash('sha256').update(value).digest('hex');
const scripts = new URL('../apps/mobile/scripts/', import.meta.url);
test('swap-only packaging keeps real assets, dark writes stub, runner changes invalidate manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'swap-build-')), app = join(root, 'apps/mobile'), directory = join(app, 'assets/live-edit');
    try {
        for (const dir of ['src/lib/templateSwap', 'scripts', 'assets/live-edit']) mkdirSync(join(app, dir), { recursive: true });
        mkdirSync(join(root, 'scripts'));
        for (const file of ['ensure-live-edit.cjs', 'live-edit-build-state.cjs', 'live-edit-webview.js', 'prepare-live-edit.mjs']) cpSync(new URL(file, scripts), join(app, 'scripts', file));
        writeFileSync(join(root, 'scripts/editor-vision-assets.mjs'), 'inventory');
        writeFileSync(join(app, 'src/lib/photoStudioFlag.ts'), 'export const PHOTO_STUDIO_ENABLED = false;');
        const flag = join(app, 'src/lib/templateSwap/runtimeFlag.ts'); writeFileSync(flag, 'export const TEMPLATE_SWAP_RUNTIME: boolean = true;');
        const state = require(join(app, 'scripts/live-edit-build-state.cjs')), ensure = require(join(app, 'scripts/ensure-live-edit.cjs'));
        assert.equal(state.readEnabled(), true); assert.equal(state.readPhotoStudio(), false);
        const html = 'real runtime fixture', inputs = {};
        for (let i = 0; i < 10; i++) { writeFileSync(join(root, `input${i}`), 'x'); inputs[`input${i}`] = hash('x'); }
        writeFileSync(join(directory, 'runtime.html'), html);
        writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ photoStudioEnabled: false, inputs, inventorySha256: hash('inventory'), runnerSha256: hash(readFileSync(join(app, 'scripts/live-edit-webview.js'))), prepareSha256: hash(readFileSync(join(app, 'scripts/prepare-live-edit.mjs'))), htmlBytes: html.length, htmlSha256: hash(html) }));
        ensure(); assert.equal(readFileSync(join(directory, 'runtime.html'), 'utf8'), html);
        writeFileSync(join(app, 'scripts/live-edit-webview.js'), 'changed'); assert.throws(ensure, /Stale/);
        writeFileSync(flag, 'export const TEMPLATE_SWAP_RUNTIME = false;'); ensure(); assert.equal(readFileSync(join(directory, 'runtime.html'), 'utf8'), state.STUB);
        writeFileSync(join(app, 'src/lib/photoStudioFlag.ts'), 'export const PHOTO_STUDIO_ENABLED = true;'); assert.equal(state.readEnabled(), true);
        const build = readFileSync(new URL('build-live-edit.mjs', scripts), 'utf8'); assert.match(build, /state.readEnabled\(\)/);
        assert.match(readFileSync(new URL('prepare-live-edit.mjs', scripts), 'utf8'), /PHOTO_STUDIO_RUNTIME=\$\{state.readPhotoStudio\(\)\}/);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

import { runInNewContext } from 'node:vm';
test('swapDetect returns three quantised frame-sized masks and never segments zero or multiple faces', async () => {
    const source = readFileSync(new URL('live-edit-webview.js', scripts), 'utf8');
    for (const count of [0, 1, 2]) {
        const messages = [], calls = [], context = {
            PHOTO_STUDIO_RUNTIME: false, LIVE_ASSETS: { face: 'AAAA', hair: 'AAAA' },
            atob: s => Buffer.from(s, 'base64').toString('binary'), btoa: s => Buffer.from(s, 'binary').toString('base64'),
            window: { addEventListener() {} }, location: { hash: '' }, ReactNativeWebView: { postMessage: m => messages.push(JSON.parse(m)) },
            document: { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }) }) },
            Image: class { naturalWidth = 32; naturalHeight = 32; set src(value) { if (value) this.onload(); } },
            Vision: {
                FaceLandmarker: { createFromOptions: async () => ({ detect: () => ({ faceLandmarks: Array.from({ length: count }, () => Array.from({ length: 478 }, () => ({ x: .5, y: .5, z: 0 }))) }) }) },
                ImageSegmenter: { createFromOptions: async () => ({ getLabels: () => ['background', 'hair', 'body-skin', 'face-skin', 'clothes', 'others'], segment: () => { calls.push('segment'); return { confidenceMasks: Array.from({ length: 6 }, () => ({ width: 8, height: 8, getAsFloat32Array: () => new Float32Array(64).fill(.5) })), close() {} }; } }) },
            },
        };
        runInNewContext(source, context);
        await context.window.liveEditReceive(JSON.stringify({ id: 1, op: 'init' }));
        await context.window.liveEditReceive(JSON.stringify({ id: 2, op: 'swapDetect', sourceId: 1, frameId: 1, width: 32, height: 32, jpeg: 'data:image/jpeg;base64,AAAA' }));
        const result = messages.at(-1); assert.equal(result.count, count); assert.equal(calls.length, count === 1 ? 1 : 0);
        for (const channel of ['background', 'body', 'face']) if (count === 1) {
            const bytes = Buffer.from(result[channel], 'base64'); assert.equal(bytes.length, 1024); assert.equal(bytes[0], 128);
        } else assert.equal(channel in result, false);
        assert.equal(result.landmarks.length, count === 1 ? 1434 : 0);
    }
});
