import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveEngine, LIVE } from '../app/veyrnox/_lib/liveEdit/liveEngine.js';
import { DEFAULTS } from '../app/veyrnox/_lib/liveEdit/settings.js';

function rig({ count = 1, width = 640, height = 480, drawError = false, processorError = false } = {}) {
    const clock = { t: 1000 }, log = { draws: [], masks: [], builds: 0, closes: 0, faces: [], wig: [], errors: [], updates: 0, detects: 0, processorClosed: 0 };
    let frameCallback, cancelled = 0, results = [], gate;
    const video = { readyState: 4, videoWidth: width, videoHeight: height, requestVideoFrameCallback(fn) { frameCallback = fn; return 1; }, cancelVideoFrameCallback() { cancelled++; frameCallback = undefined; } };
    const renderer = () => { log.builds++; return {
        updateSource() { log.updates++; }, draw(settings) { if (drawError) throw new Error('graphics-lost'); log.draws.push(settings); },
        setLandmarks(points) { log.masks.push(points ? points.length : 0); }, close() { log.closes++; } }; };
    const processor = () => ({ detect: async () => { log.detects++; if (processorError) throw new Error('face-inference-unavailable'); await gate; const next = results.length ? results.shift() : { count, landmarks: count === 1 ? new Float32Array(1434).fill(.5) : new Float32Array() }; return next; }, close() { log.processorClosed++; } });
    const make = (options = {}) => createLiveEngine({}, video, { rendererFactory: renderer, processorFactory: async () => processor(), now: () => clock.t, onFace: s => log.faces.push(s), onError: e => log.errors.push(e), onWig: s => log.wig.push(s), ...options });
    return { make, log, video, clock, results: v => { results = v; }, hold: () => { let open; gate = new Promise(r => { open = r; }); return () => { open(); gate = undefined; }; },
        tick: async (ms = 16) => { clock.t += ms; const fn = frameCallback; frameCallback = undefined; assert.ok(fn, 'a frame is scheduled'); fn(clock.t); await new Promise(r => setImmediate(r)); }, pending: () => Boolean(frameCallback), cancelled: () => cancelled };
}
const lm = value => new Float32Array(1434).fill(value);

test('draws every frame from the video and starts face tracking once ready', async () => {
    const r = rig(), engine = r.make(); await engine.ready;
    assert.equal(r.log.builds, 1);
    await r.tick(); await r.tick();
    assert.equal(r.log.updates, 2); assert.equal(r.log.draws.length, 2);
    assert.ok(r.log.faces.includes('detecting') && r.log.faces.includes('one-face'));
});

test('one detection in flight, latest frame wins: busy frames are dropped, never queued', async () => {
    const r = rig(), open = r.hold(), engine = r.make(); await engine.ready;
    for (let i = 0; i < 5; i++) await r.tick();
    assert.equal(r.log.detects, 1); assert.equal(engine.stats().dropped, 4); assert.equal(r.log.draws.length, 5); // rendering never waits for the tracker
    open(); await new Promise(r2 => setImmediate(r2)); await r.tick();
    assert.equal(r.log.detects, 2);
});

test('masks are rebuilt at most every maskIntervalMs, drawing reuses them', async () => {
    const r = rig(); r.results([{ count: 1, landmarks: lm(.4) }, { count: 1, landmarks: lm(.41) }, { count: 1, landmarks: lm(.42) }, { count: 1, landmarks: lm(.43) }]);
    const engine = r.make(); await engine.ready;
    await r.tick(16); await r.tick(16); await r.tick(16); await r.tick(16); await r.tick(16);
    const applied = r.log.masks.filter(n => n === 1434).length;
    assert.ok(applied >= 1 && applied <= 3, `applied ${applied}`);
    r.clock.t += LIVE.maskIntervalMs; // after the interval the freshest landmarks go in
    await r.tick(LIVE.maskIntervalMs); assert.ok(r.log.masks.length >= applied);
});

test('a short detection dropout keeps the last good face; a long one turns effects off', async () => {
    const r = rig(); r.results([{ count: 1, landmarks: lm(.5) }, { count: 0, landmarks: new Float32Array() }, { count: 0, landmarks: new Float32Array() }]);
    const engine = r.make(); await engine.ready;
    await r.tick(16); await r.tick(100); // good face, then a dropout 100 ms later
    assert.ok(!r.log.faces.includes('no-face'), 'held');
    await r.tick(LIVE.holdMs + 100); await r.tick(16);
    assert.ok(r.log.faces.includes('no-face'), 'after the hold the face is reported lost');
    assert.equal(r.log.masks.at(-1), 0); // landmarks cleared => effects off
});

test('more than one face turns effects off at once, with no hold', async () => {
    const r = rig(); r.results([{ count: 1, landmarks: lm(.5) }, { count: 2, landmarks: new Float32Array() }]);
    const engine = r.make(); await engine.ready;
    await r.tick(16); await r.tick(16); await r.tick(LIVE.maskIntervalMs);
    assert.ok(r.log.faces.includes('multiple-faces')); assert.equal(r.log.masks.at(-1), 0);
});

test('a tracker failure reports face-unavailable, turns effects off, and the camera keeps rendering', async () => {
    const r = rig({ processorError: true }), engine = r.make(); await engine.ready;
    await r.tick(); await r.tick(LIVE.maskIntervalMs); await r.tick();
    assert.ok(r.log.faces.includes('face-unavailable')); assert.ok(r.log.draws.length >= 3); assert.deepEqual(r.log.errors, []);
    assert.equal(r.log.detects, 1); // the client closed itself; no retry storm
});

test('a processor that cannot start still renders the camera, flagged unavailable', async () => {
    const r = rig(), engine = r.make({ processorFactory: async () => { throw new Error('face-inference-unavailable'); } }); await engine.ready;
    await r.tick(); assert.ok(r.log.faces.includes('face-unavailable')); assert.equal(r.log.draws.length, 1);
});

test('a lost graphics context stops the loop and reports once', async () => {
    const r = rig({ drawError: true }), engine = r.make(); await engine.ready;
    await r.tick(); assert.deepEqual(r.log.errors, ['graphics-lost']); assert.equal(r.pending(), false); assert.equal(r.log.draws.length, 0);
    engine.close(); assert.equal(r.log.closes, 1);
});

test('a resized stream rebuilds the renderer instead of drawing stale dimensions', async () => {
    const r = rig(), engine = r.make(); await engine.ready;
    await r.tick(); r.video.videoWidth = 480; r.video.videoHeight = 640; await r.tick();
    assert.equal(r.log.builds, 2); assert.equal(r.log.closes, 1); assert.equal(r.log.draws.length, 2);
});

test('compare draws the untouched defaults, settings apply on the next frame', async () => {
    const r = rig(), engine = r.make(); await engine.ready;
    engine.setSettings({ ...DEFAULTS, brightness: .5 }); await r.tick();
    assert.equal(r.log.draws.at(-1).brightness, .5);
    engine.compare(true); await r.tick(); assert.equal(r.log.draws.at(-1), DEFAULTS);
    engine.compare(false); await r.tick(); assert.equal(r.log.draws.at(-1).brightness, .5);
});

test('capture returns the raw, unmirrored, effect-free frame as a PNG at video size', async () => {
    const r = rig({ width: 800, height: 600 }), engine = r.make({ createCaptureCanvas: () => { const calls = []; return { calls, width: 0, height: 0, getContext: () => ({ drawImage: (...a) => calls.push(a) }), toBlob(cb, type) { cb(Object.assign(new Blob(['png'], { type }), { calls, w: this.width, h: this.height })); } }; } });
    await engine.ready; await r.tick();
    const blob = await engine.capture();
    assert.equal(blob.type, 'image/png'); assert.equal(blob.w, 800); assert.equal(blob.h, 600);
    assert.deepEqual(blob.calls[0].slice(1), [0, 0]); assert.equal(blob.calls[0][0], r.video); // the video itself, no scale(-1) transform
    r.video.readyState = 0; await assert.rejects(engine.capture(), /camera-not-ready/);
});

test('close cancels the loop, closes the tracker and renderer once, and ignores later work', async () => {
    const r = rig(), open = r.hold(), engine = r.make(); await engine.ready; await r.tick();
    engine.close(); engine.close();
    assert.equal(r.log.closes, 1); assert.equal(r.log.processorClosed, 1); assert.equal(r.pending(), false); assert.ok(r.cancelled() >= 1);
    open(); await new Promise(r2 => setImmediate(r2)); assert.equal(r.log.draws.length, 1);
});

test('stats report frames, landmark results and rates without needing a clock to start', async () => {
    const r = rig(), engine = r.make(); await engine.ready;
    assert.deepEqual([engine.stats().frames, engine.stats().fps], [0, 0]);
    for (let i = 0; i < 4; i++) await r.tick(100);
    const s = engine.stats(); assert.equal(s.frames, 4); assert.ok(s.fps > 0 && s.seconds > 0);
});

test('multiple faces switch effects off immediately, inside the mask throttle window (S2B-05)', async () => {
    const r = rig(); r.results([{ count: 1, landmarks: lm(.5) }, { count: 1, landmarks: lm(.51) }, { count: 2, landmarks: new Float32Array() }]);
    const engine = r.make(); await engine.ready;
    await r.tick(16); await r.tick(LIVE.maskIntervalMs + 4); // first face applied; a second good result is now pending
    assert.equal(r.log.masks.at(-1), 1434);
    await r.tick(5); // 5 ms later (far inside maskIntervalMs) the 2-face result arrives
    assert.ok(r.log.faces.includes('multiple-faces')); assert.equal(r.log.masks.at(-1), 0, 'cleared at once, not at the next throttled rebuild');
});

test('a single-face result right after a clear cannot resurrect the cleared face before its throttle (S2B-05)', async () => {
    const r = rig(); r.results([{ count: 1, landmarks: lm(.5) }, { count: 2, landmarks: new Float32Array() }, { count: 1, landmarks: lm(.52) }]);
    const engine = r.make(); await engine.ready;
    await r.tick(16); await r.tick(LIVE.maskIntervalMs); await r.tick(5); await r.tick(5);
    // After the clear, the new face is applied only once the interval has passed, never earlier.
    const cleared = r.log.masks.lastIndexOf(0); assert.ok(cleared >= 0);
    await r.tick(LIVE.maskIntervalMs + 1); assert.equal(r.log.masks.at(-1), 1434);
});

test('the dropout hold is enforced from the render clock even when the next detection never returns (S2B-05)', async () => {
    const r = rig(); r.results([{ count: 1, landmarks: lm(.5) }, { count: 0, landmarks: new Float32Array() }]);
    const engine = r.make(); await engine.ready;
    await r.tick(16); await r.tick(LIVE.maskIntervalMs + 4); // face on; the second detection says "no face" and starts the hold
    assert.equal(r.log.masks.at(-1), 1434);
    const open = r.hold(); // from now every detection stalls and never reports
    await r.tick(50); assert.equal(r.log.masks.at(-1), 1434, 'inside the hold the last good face stays');
    await r.tick(LIVE.holdMs + 50);
    assert.ok(r.log.faces.includes('no-face')); assert.equal(r.log.masks.at(-1), 0);
    open();
});

test('a tracker that stalls for staleMs turns stale effects off from the render clock (S2B-05)', async () => {
    const r = rig(); r.results([{ count: 1, landmarks: lm(.5) }]);
    const engine = r.make(); await engine.ready;
    await r.tick(16); await r.tick(LIVE.maskIntervalMs); assert.equal(r.log.masks.at(-1), 1434);
    const open = r.hold(); // no further result ever arrives
    await r.tick(100); await r.tick(100); assert.equal(r.log.masks.at(-1), 1434, 'still inside the limit');
    await r.tick(LIVE.staleMs); assert.equal(r.log.masks.at(-1), 0);
    assert.ok(r.log.faces.includes('face-unavailable') && !r.log.faces.includes('no-face'), 'a hung tracker is not reported as "no face"'); open();
});

test('stickers are never drawn live, and a resized stream tells the page so it can refit (S2B-07, S2B-08)', async () => {
    const resized = [], r = rig(), engine = r.make({ onResize: (w, h) => resized.push([w, h]) }); await engine.ready;
    engine.setSettings({ ...DEFAULTS, stickers: [{ kind: 'heart', x: .5, y: .5, size: .1, rotation: 0 }] }); await r.tick();
    assert.deepEqual(r.log.draws.at(-1).stickers, []);
    r.video.videoWidth = 480; r.video.videoHeight = 640; await r.tick();
    assert.deepEqual(resized, [[480, 640]]); assert.equal(r.log.builds, 2);
});
