// Drives the GENERATED mobile runtime page (apps/mobile/assets/live-edit/runtime.html, built by `node scripts/prepare-live-edit.mjs`
// from apps/mobile) from file://, like the app's WebView, with Chromium's fake camera. It proves the in-page glue, the inlined engine
// and three.js under the page CSP, and that nothing leaves the document. It is NOT a WKWebView/Android WebView test.
import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const runtime = resolve(import.meta.dirname, '../apps/mobile/assets/live-edit/runtime.html');
test('mobile runtime page: live camera starts, renders, takes settings, captures and stops', async ({ page }) => {
    test.skip(!existsSync(runtime), 'run `node scripts/prepare-live-edit.mjs` in apps/mobile first');
    const outbound = [];
    page.on('request', request => { if (!/^(file|data|blob):/.test(request.url())) outbound.push(request.url()); });
    await page.addInitScript(() => {
        window.__msgs = []; window.__stops = 0;
        window.ReactNativeWebView = { postMessage: raw => window.__msgs.push(JSON.parse(raw)) };
        const stop = MediaStreamTrack.prototype.stop; MediaStreamTrack.prototype.stop = function () { window.__stops++; return stop.call(this); };
    });
    await page.goto(`${pathToFileURL(runtime).href}#live`);
    const send = op => page.evaluate(message => window.liveEditReceive(JSON.stringify(message)), op);
    // The page CSP forbids eval, so matchers are plain data, compared inside the page.
    const wait = (match, timeout = 180000) => page.waitForFunction(want => window.__msgs.some(m => Object.entries(want).every(([k, v]) => Array.isArray(v) ? v.includes(m[k]) : m[k] === v)), match, { timeout });
    const pixels = () => page.evaluate(() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let sum = 0; for (let i = 0; i < d.length; i += 97) sum += d[i] + d[i + 1] + d[i + 2]; return { width: c.width, height: c.height, sum }; });

    // The bundle is inlined, the wig art maps to data: images, and three.js is the injected copy.
    expect(await page.evaluate(() => typeof VeyrnoxLive === 'object' && Boolean(globalThis.__veyrnoxThree?.WebGLRenderer))).toBe(true);
    expect(await page.evaluate(async () => { const src = globalThis.__veyrnoxAssetUrl('/photo-studio/wigs/pixie.svg'); const image = new Image(); image.src = src; await image.decode(); return src.startsWith('data:image/svg+xml') && image.naturalWidth > 0; })).toBe(true);

    await send({ op: 'live.start' });
    await wait({ live: ['started', 'error'] });
    const started = await page.evaluate(() => window.__msgs.find(m => m.live === 'started' || m.live === 'error'));
    expect(started, JSON.stringify(started)).toMatchObject({ live: 'started' });
    expect(started.width).toBeGreaterThan(0); expect(started.cameras).toBeGreaterThanOrEqual(1);

    // Frames reach the canvas, and the face tracker reports (the fake camera shows no face).
    await page.waitForFunction(() => { const c = document.querySelector('canvas'); return c && c.width > 0; });
    // The first frame is drawn a moment after the canvas appears: poll instead of sampling once.
    await expect.poll(async () => (await pixels()).sum, { timeout: 30000, intervals: [250] }).toBeGreaterThan(0);
    const plain = await pixels();
    await wait({ live: 'face', status: ['no-face', 'detecting', 'one-face'] });

    // A look changes the picture; compare restores it.
    await send({ op: 'live.settings', settings: { look: 'noir', strength: 1 } });
    await page.waitForTimeout(800); const looked = await pixels(); expect(looked.sum).not.toBe(plain.sum);
    await send({ op: 'live.compare', value: true }); await page.waitForTimeout(800); const compared = await pixels();
    expect(Math.abs(compared.sum - plain.sum) / Math.max(1, plain.sum)).toBeLessThan(.5);
    await send({ op: 'live.compare', value: false });

    // A 3D wig needs the inlined three.js to start under the page CSP; with no face it must say so, not stay "loading".
    await send({ op: 'live.settings', settings: { look: 'original', strength: 1, wig: { style: '3d-bob', size: 1, offset: 0, strength: 1 } } });
    await wait({ live: 'wig', status: 'face-required' }, 60000);

    await send({ op: 'live.capture', id: 7 }); await wait({ live: 'photo', id: 7 }, 30000);
    const photo = await page.evaluate(() => window.__msgs.find(m => m.live === 'photo'));
    expect(photo.jpeg.startsWith('data:image/jpeg;base64,')).toBe(true); expect(photo.width).toBe(started.width);

    await send({ op: 'live.stop' }); await wait({ live: 'stopped' }, 30000);
    expect(await page.evaluate(() => [document.querySelector('canvas'), document.querySelector('video')])).toEqual([null, null]);
    expect(await page.evaluate(() => window.__stops)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__msgs.filter(m => m.live === 'error'))).toEqual([]);
    expect(outbound).toEqual([]);
});

// 3D wig overlay for a still (S9): the hidden-WebView op the app calls. Synthetic landmarks only (no photo).
test('mobile runtime page: a 3D wig overlay is rendered for a still, carved around the face, and refused when it cannot fit', async ({ page }) => {
    test.skip(!existsSync(runtime), 'run `node scripts/prepare-live-edit.mjs` in apps/mobile first');
    const { wigPoints } = await import('../tests/fixtures/photo-studio-wig-fixture.mjs');
    const outbound = [];
    page.on('request', request => { if (!/^(file|data|blob):/.test(request.url())) outbound.push(request.url()); });
    await page.addInitScript(() => { window.__msgs = []; window.ReactNativeWebView = { postMessage: raw => window.__msgs.push(JSON.parse(raw)) }; });
    await page.goto(pathToFileURL(runtime).href);
    const ask = async (id, extra) => {
        await page.evaluate(message => window.liveEditReceive(JSON.stringify(message)), { op: 'wig3d', id, style: '3d-bob', width: 256, height: 256, size: 1, offset: 0, landmarks: Array.from(wigPoints()), ...extra });
        await page.waitForFunction(want => window.__msgs.some(m => m.wig3d && m.id === want), id, { timeout: 120000 });
        return page.evaluate(want => window.__msgs.find(m => m.wig3d && m.id === want), id);
    };
    const alphaAt = (png, points) => page.evaluate(async ({ png, points }) => {
        const image = new Image(); image.src = png; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        return points.map(([x, y]) => context.getImageData(x, y, 1, 1).data[3]);
    }, { png, points });

    const reply = await ask(1);
    expect(reply).toMatchObject({ status: 'ready', fade: 1, width: 256, height: 256 });
    expect(reply.png.startsWith('data:image/png;base64,')).toBe(true);
    // Hair above the head is drawn; eyes, nose and mouth are carved out of the overlay.
    const above = await alphaAt(reply.png, [[128, 30], [100, 40]]); expect(Math.max(...above)).toBeGreaterThan(200);
    expect(await alphaAt(reply.png, [[128, 121], [105, 121], [151, 121], [128, 146], [128, 173]])).toEqual([0, 0, 0, 0, 0]);

    // A head turned far past the fade cannot carry the wig; a landmark set with no face cannot place it. Neither returns a picture.
    const turned = wigPoints(); for (let i = 0; i < 478; i++) { if (!turned[i * 3] && !turned[i * 3 + 1]) continue; const dx = turned[i * 3] * 256 - 128; turned[i * 3] = (128 + dx * Math.cos(1.31)) / 256; turned[i * 3 + 2] = -dx * Math.sin(1.31) / 256; }
    expect(await ask(2, { landmarks: Array.from(turned) })).toMatchObject({ status: 'angle' });
    const none = await ask(3, { landmarks: new Array(1434).fill(0) }); expect(none.status).toBe('face-required'); expect(none.png).toBeUndefined();
    // Bad input is refused, not rendered.
    expect(await ask(4, { style: 'pixie' })).toMatchObject({ status: 'unavailable' });
    expect(await ask(5, { width: 99999 })).toMatchObject({ status: 'unavailable' });
    expect(await ask(6, { landmarks: [1, 2, 3] })).toMatchObject({ status: 'unavailable' });
    expect(outbound).toEqual([]);
});

// Camera capability is per document: the hidden still-photo / 3D-wig documents (no `#live`) can never open the camera, even if asked.
test('mobile runtime page: a document loaded without #live refuses the camera and every live operation', async ({ page }) => {
    test.skip(!existsSync(runtime), 'run `node scripts/prepare-live-edit.mjs` in apps/mobile first');
    await page.addInitScript(() => {
        window.__msgs = []; window.__gum = 0;
        window.ReactNativeWebView = { postMessage: raw => window.__msgs.push(JSON.parse(raw)) };
        const original = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
        if (original) navigator.mediaDevices.getUserMedia = (...args) => { window.__gum++; return original(...args); }; // counts only calls that reach the real API
    });
    await page.goto(pathToFileURL(runtime).href); // no #live: this is what the hidden bridges load
    expect(await page.evaluate(async () => { try { await navigator.mediaDevices.getUserMedia({ video: true }); return 'granted'; } catch (error) { return error.name; } })).toBe('NotAllowedError');
    // The prototype method is closed too, and neither can be put back.
    expect(await page.evaluate(async () => { try { await MediaDevices.prototype.getUserMedia.call(navigator.mediaDevices, { video: true }); return 'granted'; } catch (error) { return error.name; } })).toBe('NotAllowedError');
    expect(await page.evaluate(() => { try { navigator.mediaDevices.getUserMedia = () => 'restored'; } catch { /* strict mode throws */ } try { Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { value: () => 'restored' }); } catch { /* not configurable */ } return typeof navigator.mediaDevices.getUserMedia.call(navigator.mediaDevices).then; })).toBe('function');
    for (const op of ['live.start', 'live.settings', 'live.capture', 'live.switch', 'live.stop'])
        await page.evaluate(message => window.liveEditReceive(JSON.stringify(message)), { op, id: 1, settings: {} });
    await page.waitForFunction(() => window.__msgs.filter(m => m.live === 'error' && m.code === 'live-unavailable').length === 5);
    expect(await page.evaluate(() => [window.__gum, window.__msgs.filter(m => m.live !== 'error').length, document.querySelector('canvas'), document.querySelector('video')])).toEqual([0, 0, null, null]);
});

// A stop that arrives while the models are still loading must cancel the start: the camera is never opened afterwards.
test('mobile runtime page: live.stop during start-up cancels it before the camera is touched', async ({ page }) => {
    test.skip(!existsSync(runtime), 'run `node scripts/prepare-live-edit.mjs` in apps/mobile first');
    let graphs = 0; page.on('console', message => { if (/Graph successfully started running/.test(message.text())) graphs++; });
    await page.addInitScript(() => {
        window.__msgs = []; window.__gum = 0;
        window.ReactNativeWebView = { postMessage: raw => window.__msgs.push(JSON.parse(raw)) };
        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = (...args) => { window.__gum++; return original(...args); };
    });
    await page.goto(`${pathToFileURL(runtime).href}#live`);
    await page.evaluate(() => { window.liveEditReceive(JSON.stringify({ op: 'live.start' })); window.liveEditReceive(JSON.stringify({ op: 'live.stop' })); });
    await page.waitForFunction(() => window.__msgs.some(m => m.live === 'stopped'));
    await expect.poll(() => graphs, { timeout: 120000, intervals: [500] }).toBeGreaterThanOrEqual(2); // both models are up: the start has run its course
    await page.waitForTimeout(2000);
    expect(await page.evaluate(() => [window.__gum, window.__msgs.filter(m => m.live === 'started' || m.live === 'error').length, document.querySelector('canvas'), document.querySelector('video')])).toEqual([0, 0, null, null]);
});
