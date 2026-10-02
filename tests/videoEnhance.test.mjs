import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateVideo, VIDEO_LIMITS, VIDEO_LOOKS, lookSettings, downloadName, validateExportAudio, validateExportBrowser } from '../app/veyrnox/_lib/videoEnhance.mjs';

const file = { type: 'video/mp4', size: 1000 };
const metadata = { duration: 10, width: 1080, height: 1920 };
test('unqualified Opus padding cannot silently produce a downloadable export', () => {
    assert.match(validateExportAudio('opus'), /Opus.*AAC/);
    assert.equal(validateExportAudio('aac'), null);
    assert.equal(validateExportAudio(null), null);
});
test('local video validation accepts supported portrait and landscape clips', () => {
    assert.equal(validateVideo(file, metadata), null);
    assert.equal(validateVideo({ ...file, type: 'video/webm' }, { ...metadata, width: 1920, height: 1080 }), null);
});
test('empty, oversized and unsupported files fail before creating an object URL', () => {
    for (const candidate of [null, { ...file, size: 0 }, { ...file, size: VIDEO_LIMITS.bytes + 1 }, { ...file, type: 'image/png' }]) assert.ok(validateVideo(candidate));
});
test('duration and decoded dimensions have bounded limits', () => {
    for (const duration of [NaN, Infinity, 0, -1, 15.01]) assert.ok(validateVideo(file, { ...metadata, duration }));
    for (const dimensions of [{ width: 0 }, { width: 3840 }, { height: 2160 }]) assert.ok(validateVideo(file, { ...metadata, ...dimensions }));
    assert.equal(validateVideo(file, { ...metadata, duration: 15 }), null);
});
test('zero look intensity is an identity transform for every look', () => {
    for (const look of VIDEO_LOOKS) assert.deepEqual(lookSettings(look.id, 0), { saturation: 1, contrast: 1, warmth: 0 });
});
test('look settings clamp range and reject nonfinite intensities', () => {
    assert.deepEqual(lookSettings('warm', 150), lookSettings('warm', 100));
    assert.deepEqual(lookSettings('cool', -1), lookSettings('cool', 0));
    assert.deepEqual(lookSettings('cinema', NaN), lookSettings('natural', 0));
});
test('download names match the exported container', () => {
    const mime = 'video/webm';
    assert.equal(downloadName('my clip.MOV', mime), 'my-clip-enhanced.webm');
    assert.equal(downloadName('my clip.mov', 'video/mp4'), 'my-clip-enhanced.mp4');
});
test('local preview cannot be enabled in a production build', () => {
    const hook = readFileSync(new URL('../app/veyrnox/_lib/useVideoEnhancePreview.js', import.meta.url), 'utf8');
    const engine = readFileSync(new URL('../app/veyrnox/_lib/videoEnhanceEngine.js', import.meta.url), 'utf8');
    assert.match(hook, /process\.env\.NODE_ENV === 'development' && localStorage/);
    assert.match(engine, /process\.env\.NODE_ENV !== 'development'/);
    assert.doesNotMatch(engine, /getUserMedia|gatewayFetch|\/api\/v1|FAL_KEY/);
});

test('export cancelled before initialization never attempts to decode media', async () => {
    const { exportEnhancedVideo } = await import('../app/veyrnox/_lib/videoEnhanceExport.mjs');
    const controller = new AbortController(); controller.abort();
    await assert.rejects(exportEnhancedVideo(new Blob(['unused']), { signal: controller.signal, process() { assert.fail('Cancelled export processed a frame'); } }), /Export cancelled/);
});

test('unreadable media cannot receive a successful export compatibility check', async () => {
    const { inspectVideoExport } = await import('../app/veyrnox/_lib/videoEnhanceExport.mjs');
    assert.match(await inspectVideoExport(new Blob(['invalid media'])), /could not be checked/);
});


test('unqualified and unknown audio codecs fail closed', () => {
    for (const codec of ['pcm-s16', 'mp3', 'flac', undefined, '']) {
        assert.match(validateExportAudio(codec), /supports AAC/);
    }
});


test('WebKit is preview-only while desktop Chromium retains capability checks', () => {
    const base = 'Mozilla/5.0 AppleWebKit/605.1.15 ';
    for (const browser of ['Version/27.0 Safari/605.1.15', 'CriOS/154.0 Mobile/15E148 Safari/604.1', 'FxiOS/143.0 Mobile/15E148 Safari/605.1.15']) {
        assert.match(validateExportBrowser(base + browser), /can stall.*desktop Google Chrome/);
    }
    for (const browser of ['Chrome/154.0 Safari/537.36', 'Chromium/154.0 Safari/537.36', 'Chrome/154.0 Edg/154.0', 'Chrome/154.0 OPR/125.0']) {
        assert.equal(validateExportBrowser(base + browser), null);
    }
    assert.equal(validateExportBrowser('Mozilla/5.0 Gecko/20100101 Firefox/143.0'), null);
});

test('WebKit preflight and direct export fail before opening media', async () => {
    const { inspectVideoExport, exportEnhancedVideo } = await import('../app/veyrnox/_lib/videoEnhanceExport.mjs');
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'AppleWebKit/605.1.15 Version/27.0 Safari/605.1.15' } });
    try {
        // Deliberately invalid input: a missing early guard would enter the media parser.
        assert.match(await inspectVideoExport(null), /desktop Google Chrome/);
        const controller = new AbortController();
        await assert.rejects(exportEnhancedVideo(null, { signal: controller.signal, process() { assert.fail('Processed unsupported export'); } }), /desktop Google Chrome/);
        controller.abort();
        await assert.rejects(exportEnhancedVideo(null, { signal: controller.signal }), /Export cancelled/);
    } finally {
        if (original) Object.defineProperty(globalThis, 'navigator', original);
        else delete globalThis.navigator;
    }
});
