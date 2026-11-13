// Run against `node scripts/probe-photo-studio-worker.mjs --serve` after build:worker.
// Only test harness/source modules and an optional private fixture are intercepted. All prefixes
// and every model/runtime request go to the actual built Worker + Assets binding.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
test('real WebGL2 rendering, export, page CSP and retained-client inference', async ({ page }) => {
    const root = resolve(import.meta.dirname, '..');
    const allowed = /^(app\/veyrnox\/_lib\/(?:liveEdit\/[^/]+|editorVisionRuntime|editorVisionWorkerClient|editorMotionAnalysis)|packages\/live-edit\/[^/]+|tests\/fixtures\/photo-studio-(?:browser-proof|makeup-proof|makeup-fixture|makeup-goldens|hair-proof|hair-fixture|wig-proof|wig-fixture))\.(?:js|mjs)$/;
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
    await page.waitForFunction(() => window.photoProof !== undefined, undefined, { timeout: 240000 });
    const result = await page.evaluate(() => window.photoProof);
    console.log(JSON.stringify(result));
    expect.soft(result.misses, JSON.stringify(result)).toEqual([]);
    expect.soft(result.error, JSON.stringify(result)).toBeUndefined();
    expect.soft(result.checks).toContain('retained-person-client');
    expect.soft(result.checks).toContain('face-worker-no-face');
    for (const check of ['makeup-zero-identical', 'makeup-golden-crops', 'makeup-regions-holes-monotonic', 'makeup-finishes-gradient-wing-volume', 'makeup-face-lost', 'makeup-export-equality', 'makeup-multiple-faces']) expect.soft(result.checks).toContain(check);
    for (const check of ['hair-worker-channel', 'hair-subject-association-speck', 'hair-zero-identical', 'hair-golden-crops', 'hair-feather-luminance-alpha-monotonic', 'hair-face-lost-multiple-no-hair', 'hair-export-equality']) expect.soft(result.checks).toContain(check);
    for (const check of ['wig-zero-identical','wig-r4-long-hair-short-wig','wig-tint-luminance','wig-face-lost-pose-off','wig-face-count-0','wig-face-count-2','wig-transparent-source','wig-export-history-compare', ...['pixie','bob','waves','curls','long','braids'].map(id => `wig-svg-${id}`)]) expect.soft(result.checks).toContain(check);
    expect.soft(outbound).toEqual([]);
});

// Private NASA-style fixture per ADR-0092; image/metadata never enter git or a service.
test('private portrait hair confidence excludes known background', async ({ page }) => {
    const fixturePath = process.env.PHOTO_HAIR_FIXTURE;
    test.skip(!fixturePath, 'PHOTO_HAIR_FIXTURE manifest required for private portrait qualification');
    const { createHash } = await import('node:crypto');
    const { dirname } = await import('node:path');
    const root = resolve(import.meta.dirname, '..'), fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
    expect(fixture.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Array.isArray(fixture.backgroundRects) && fixture.backgroundRects.length > 0).toBe(true);
    for (const r of fixture.backgroundRects) {
        expect(r.length).toBe(4);
        expect(r.every(Number.isFinite) && r[0]>=0 && r[1]>=0 && r[2]>0 && r[3]>0 && r[0]+r[2]<=1 && r[1]+r[3]<=1).toBe(true);
    }
    const bytes = await readFile(resolve(dirname(fixturePath), fixture.image));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixture.sha256);
    const allowed = /^(app\/veyrnox\/_lib\/(?:liveEdit\/faceClient|editorVisionRuntime|editorVisionWorkerClient|editorMotionAnalysis)|packages\/live-edit\/(?:hair|regions)|tests\/fixtures\/photo-studio-hair-model-proof)\.(?:js|mjs)$/;
    const outbound=[];
    page.on('request',r=>{if(!['GET','HEAD'].includes(r.method())) outbound.push(r.url());});
    await page.route('**/__photo-proof/**', async route => {
        const path = new URL(route.request().url()).pathname.slice('/__photo-proof/'.length);
        if(path==='index.html') return route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':"default-src 'none'; script-src 'self'; connect-src 'self'; worker-src 'self'; img-src 'self' blob:"},body:'<!doctype html><script type="module" src="/__photo-proof/tests/fixtures/photo-studio-hair-model-proof.mjs"></script>'});
        if(path.endsWith('/private-hair.png')) return route.fulfill({contentType:'image/png',body:bytes});
        if(path.endsWith('/private-hair.json')) return route.fulfill({contentType:'application/json',body:JSON.stringify({backgroundRects:fixture.backgroundRects})});
        if(!allowed.test(path)) return route.abort();
        return route.fulfill({contentType:'text/javascript',body:await readFile(resolve(root,path),'utf8')});
    });
    await page.goto('/__photo-proof/index.html');
    await page.waitForFunction(()=>window.photoHairModelProof!==undefined,undefined,{timeout:240000});
    const result=await page.evaluate(()=>window.photoHairModelProof);
    console.log(JSON.stringify(result));
    expect(result.error,JSON.stringify(result)).toBeUndefined();
    expect(result.misses,JSON.stringify(result)).toEqual([]);
    expect(outbound).toEqual([]);
});
