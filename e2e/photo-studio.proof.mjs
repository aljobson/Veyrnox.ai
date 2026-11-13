// Run against `node scripts/probe-photo-studio-worker.mjs --serve` after build:worker.
// Only the test harness/source modules are intercepted. Both inference prefixes
// and every model/runtime request go to the actual built Worker + Assets binding.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
test('real WebGL2 rendering, export, page CSP and retained-client inference', async ({ page }) => {
    const root = resolve(import.meta.dirname, '..');
    const allowed = /^(app\/veyrnox\/_lib\/(?:liveEdit\/[^/]+|editorVisionRuntime|editorVisionWorkerClient|editorMotionAnalysis)|packages\/live-edit\/[^/]+|tests\/fixtures\/photo-studio-(?:browser-proof|makeup-proof|makeup-fixture|makeup-goldens))\.(?:js|mjs)$/;
    const outbound = [];
    page.on('request', request => { if (!['GET','HEAD'].includes(request.method())) outbound.push(request.url()); });
    await page.route('**/__photo-proof/**', async route => {
        const path = new URL(route.request().url()).pathname.slice('/__photo-proof/'.length);
        const policy = "default-src 'none'; script-src 'self'; connect-src 'self'; worker-src 'self'; img-src 'self' blob:; style-src 'none'";
        if (path === 'index.html') return route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy': policy }, body: '<!doctype html><html><head><title>Local photo proof</title></head><body><script type="module" src="/__photo-proof/tests/fixtures/photo-studio-browser-proof.mjs"></script></body></html>' });
        if (!allowed.test(path)) return route.abort();
        return route.fulfill({ contentType: 'text/javascript', body: await readFile(resolve(root, path), 'utf8') });
    });
    await page.goto('/__photo-proof/index.html');
    await page.waitForFunction(() => window.photoProof !== undefined, undefined, { timeout: 150000 });
    const result = await page.evaluate(() => window.photoProof);
    expect(result.error, JSON.stringify(result)).toBeUndefined();
    expect(result.checks).toContain('retained-person-client');
    expect(result.checks).toContain('face-worker-no-face');
    for (const check of ['makeup-zero-identical', 'makeup-golden-crops', 'makeup-regions-holes-monotonic', 'makeup-finishes-gradient-wing-volume', 'makeup-face-lost', 'makeup-export-equality', 'makeup-multiple-faces']) expect(result.checks).toContain(check);
    expect(outbound).toEqual([]);
    console.log(JSON.stringify(result));
});
