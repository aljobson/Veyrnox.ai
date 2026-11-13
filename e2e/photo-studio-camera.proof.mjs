// Run against `node scripts/probe-photo-studio-worker.mjs --serve` after build:worker, with Chromium's fake camera.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
test.use({ permissions: ['camera'] });
test('live camera starts only after the click, renders live frames, tracks the face worker, and releases the camera', async ({ page }) => {
    const root = resolve(import.meta.dirname, '..');
    const allowed = /^(app\/veyrnox\/_lib\/(?:liveEdit\/[^/]+|editorVisionRuntime|editorVisionWorkerClient)|packages\/live-edit\/[^/]+|tests\/fixtures\/photo-studio-(?:camera-proof|makeup-fixture))\.(?:js|mjs)$/;
    const outbound = [];
    page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) outbound.push(request.url()); });
    await page.route('**/__photo-proof/**', async route => {
        const path = new URL(route.request().url()).pathname.slice('/__photo-proof/'.length);
        const policy = "default-src 'none'; script-src 'self'; connect-src 'self'; worker-src 'self'; img-src 'self' blob:; style-src 'none'";
        if (path === 'index.html') return route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy': policy }, body: '<!doctype html><html><head><title>Local camera proof</title></head><body><script type="module" src="/__photo-proof/tests/fixtures/photo-studio-camera-proof.mjs"></script></body></html>' });
        if (!allowed.test(path)) return route.abort();
        return route.fulfill({ contentType: 'text/javascript', body: await readFile(resolve(root, path), 'utf8') });
    });
    await page.goto('/__photo-proof/index.html');
    await page.waitForFunction(() => window.cameraProof?.phase === 'waiting', undefined, { timeout: 60000 });
    expect(await page.evaluate(() => window.cameraProof.requestsBeforeClick()), 'the camera is never requested before the click').toBe(0);
    await page.click('#start');
    await page.waitForFunction(() => window.cameraProof?.phase === 'done', undefined, { timeout: 120000 });
    const result = await page.evaluate(() => window.cameraProof);
    console.log(JSON.stringify({ fakeCameraStats_NOT_REPRESENTATIVE_OF_PHONES: result.stats, checks: result.checks }));
    expect(result.misses, JSON.stringify(result)).toEqual([]);
    expect(outbound).toEqual([]);
});
