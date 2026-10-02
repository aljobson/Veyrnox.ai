import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../app/veyrnox/_lib/', import.meta.url);
const rendererSource = (await readFile(new URL('videoEnhanceRenderer.js', root), 'utf8'))
    .replace("'./videoEnhance.mjs'", JSON.stringify(new URL('videoEnhance.mjs', root).href));
const { createRenderer } = await import(`data:text/javascript,${encodeURIComponent(rendererSource)}`);

function graphics({ compile = true, link = true } = {}) {
    const allocated = [], deleted = [];
    let lost = false, releases = 0;
    const gl = new Proxy({
        getShaderParameter: () => compile, getProgramParameter: () => link,
        isContextLost: () => lost,
        getExtension: () => ({ loseContext() { lost = true; releases++; } }),
    }, { get(target, key) {
        if (key in target) return target[key];
        if (key.startsWith('create')) return () => { const handle = {}; allocated.push(handle); return handle; };
        if (key.startsWith('delete')) return handle => deleted.push(handle);
        return () => {};
    } });
    return { canvas: { getContext: () => gl }, allocated, deleted,
        lose: () => { lost = true; }, releases: () => releases };
}

for (const stage of ['compile', 'link']) {
    test(`renderer releases partial GPU resources when ${stage} fails`, () => {
        const fixture = graphics({ [stage]: false });
        assert.throws(() => createRenderer(fixture.canvas), /could not initialize/);
        assert.deepEqual(new Set(fixture.deleted), new Set(fixture.allocated));
        assert.equal(fixture.releases(), 1);
    });
}

test('renderer refuses lost graphics and closes resources only once', () => {
    const previous = globalThis.document;
    globalThis.document = { createElement: () => ({ getContext: () => ({}) }) };
    try {
        const fixture = graphics();
        const renderer = createRenderer(fixture.canvas);
        fixture.lose();
        assert.throws(() => renderer.draw({}, [], {}), /lost graphics access/);
        renderer.close(); renderer.close();
        assert.deepEqual(new Set(fixture.deleted), new Set(fixture.allocated));
        assert.equal(fixture.deleted.length, fixture.allocated.length);
        assert.equal(fixture.releases(), 1);
    } finally { globalThis.document = previous; }
});

const engineSource = (await readFile(new URL('videoEnhanceEngine.js', root), 'utf8'))
    .replace(/^import .*;$/gm, '')
    .replace('export async function', `const { VIDEO_ENHANCE_ASSET_PATH, FaceLandmarker, FilesetResolver,
        createRenderer, exportEnhancedVideo, acquireSetupTracker } = globalThis.graphicsHarness;
        export async function`);

test('paused graphics loss aborts export, reports once, and disposes listeners', async () => {
    const previousDocument = globalThis.document, previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const canvas = new EventTarget(), video = new EventTarget();
    let cancelled = 0, closed = 0, rejectExport, exportSignal;
    const errors = [];
    Object.assign(video, { readyState: 2, currentTime: 0, videoWidth: 640, videoHeight: 360,
        pause() {}, requestVideoFrameCallback: () => 1, cancelVideoFrameCallback() { cancelled++; } });
    globalThis.document = Object.assign(new EventTarget(), { createElement: () => ({ getContext: () => ({ drawImage() {} }) }) });
    globalThis.graphicsHarness = {
        VIDEO_ENHANCE_ASSET_PATH: '', FilesetResolver: { forVisionTasks: async () => ({}) },
        FaceLandmarker: { createFromOptions: async () => ({ detectForVideo: () => ({ faceLandmarks: [] }), close() { closed++; } }) },
        acquireSetupTracker: factory => factory(), createRenderer: () => ({ draw() {}, close() { closed++; } }),
        exportEnhancedVideo: (_file, { signal }) => { exportSignal = signal; return new Promise((_resolve, reject) => { rejectExport = reject; }); },
    };
    try {
        const { createVideoEnhanceEngine } = await import(`data:text/javascript,${encodeURIComponent(engineSource)}`);
        const engine = await createVideoEnhanceEngine(video, canvas, () => {}, message => errors.push(message));
        const pendingSeek = assert.rejects(engine.seek(1), /lost graphics access/);
        const pending = engine.export({});
        canvas.dispatchEvent(new Event('webglcontextlost'));
        canvas.dispatchEvent(new Event('webglcontextlost'));
        await pendingSeek;
        assert.equal(exportSignal.aborted, true);
        assert.equal(errors.length, 1);
        assert.match(errors[0], /Choose the video again/);
        assert.equal(cancelled, 1);
        rejectExport(new Error('Export cancelled.'));
        await assert.rejects(pending, /lost graphics access/);
        await assert.rejects(engine.export({}), /lost graphics access/);
        engine.close(); engine.close();
        assert.equal(closed, 2);
        canvas.dispatchEvent(new Event('webglcontextlost'));
        assert.equal(errors.length, 1);
    } finally {
        globalThis.document = previousDocument;
        if (previousEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnv;
        delete globalThis.graphicsHarness;
    }
});

test('superseded and abandoned seeks settle promptly without timers or listeners', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const previousDocument = globalThis.document, previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const video = new EventTarget(), canvas = new EventTarget();
    let time = 0, throwOnSeek = false, completed = 0;
    Object.assign(video, { readyState: 2, videoWidth: 640, videoHeight: 360,
        pause() {}, requestVideoFrameCallback: () => 1, cancelVideoFrameCallback() {} });
    Object.defineProperty(video, 'currentTime', { get: () => time, set(value) {
        if (throwOnSeek) throw new Error('Seek assignment failed');
        time = value;
    } });
    const { getEventListeners } = await import('node:events');
    globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {} }) }) };
    globalThis.graphicsHarness = {
        VIDEO_ENHANCE_ASSET_PATH: '', FilesetResolver: { forVisionTasks: async () => ({}) },
        FaceLandmarker: { createFromOptions: async () => ({ detectForVideo: () => ({ faceLandmarks: [] }), close() {} }) },
        acquireSetupTracker: factory => factory(), createRenderer: () => ({ draw() {}, close() {} }),
    };
    try {
        const { createVideoEnhanceEngine } = await import(`data:text/javascript,${encodeURIComponent(engineSource)}#seeks`);
        const engine = await createVideoEnhanceEngine(video, canvas, () => {}, assert.fail);
        const first = engine.seek(1);
        const firstRejected = assert.rejects(first, { name: 'AbortError' });
        const second = engine.seek(2).then(() => { completed++; });
        await firstRejected;
        assert.equal(getEventListeners(video, 'seeked').length, 2); // redraw + current seek
        video.dispatchEvent(new Event('seeked'));
        await second;
        assert.equal(completed, 1);
        assert.equal(getEventListeners(video, 'seeked').length, 1);
        throwOnSeek = true;
        await assert.rejects(engine.seek(3), /Seek assignment failed/);
        assert.equal(getEventListeners(video, 'seeked').length, 1);
        throwOnSeek = false;
        const timedOut = assert.rejects(engine.seek(3), /could not seek/);
        t.mock.timers.tick(5000);
        await timedOut;
        assert.equal(getEventListeners(video, 'seeked').length, 1);
        const pending = engine.seek(4);
        const closed = assert.rejects(pending, { name: 'AbortError' });
        engine.close();
        await closed;
        assert.equal(getEventListeners(video, 'seeked').length, 0);
        t.mock.timers.tick(5001);
        await assert.rejects(engine.seek(5), { name: 'AbortError' });
    } finally {
        globalThis.document = previousDocument;
        if (previousEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnv;
        delete globalThis.graphicsHarness;
    }
});

for (const action of ['close', 'cancel']) {
    test(`${action} rejects late export frames and completion`, async () => {
        const previousDocument = globalThis.document, previousEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';
        const video = Object.assign(new EventTarget(), { readyState: 2, currentTime: 0,
            videoWidth: 640, videoHeight: 360, pause() {},
            requestVideoFrameCallback: () => 1, cancelVideoFrameCallback() {} });
        let finish, processFrame, signal, frames = 0, closed = 0, calls = 0;
        globalThis.document = Object.assign(new EventTarget(), {
            createElement: () => ({ getContext: () => ({ drawImage() {} }) }),
        });
        globalThis.graphicsHarness = {
            VIDEO_ENHANCE_ASSET_PATH: '', FilesetResolver: { forVisionTasks: async () => ({}) },
            FaceLandmarker: { createFromOptions: async () => ({ detectForVideo: () => ({ faceLandmarks: [] }), close() { closed++; } }) },
            acquireSetupTracker: factory => factory(), createRenderer: () => ({ draw() {}, close() { closed++; } }),
            exportEnhancedVideo: (_file, options) => {
                calls++; processFrame = options.process; signal = options.signal;
                return new Promise(resolve => { finish = resolve; });
            },
        };
        try {
            const { getEventListeners } = await import('node:events');
            const { createVideoEnhanceEngine } = await import(`data:text/javascript,${encodeURIComponent(engineSource)}#late-${action}`);
            const engine = await createVideoEnhanceEngine(video, new EventTarget(), () => { frames++; }, assert.fail);
            const pending = engine.export({});
            const rejected = assert.rejects(pending, /Export cancelled/);
            await assert.rejects(engine.export({}), /already running/);
            assert.equal(calls, 1);
            engine[action]();
            assert.equal(signal.aborted, true);
            const before = frames;
            assert.throws(() => processFrame({ draw() { assert.fail('Cancelled frame was decoded'); } }), /Export cancelled/);
            assert.equal(frames, before);
            finish(new Blob(['late result']));
            await rejected;
            assert.equal(getEventListeners(document, 'visibilitychange').length, 0);
            if (action === 'close') {
                assert.equal(closed, 2);
                await assert.rejects(engine.export({}), /closed/);
            } else {
                const retry = engine.export({});
                assert.equal(signal.aborted, false);
                finish(new Blob(['new result']));
                assert.equal(await (await retry).text(), 'new result');
            }
            engine.close();
            assert.equal(closed, 2);
        } finally {
            globalThis.document = previousDocument;
            if (previousEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnv;
            delete globalThis.graphicsHarness;
        }
    });
}
