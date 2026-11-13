import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA_LIMITS, cameraConstraints, cameraErrorCode, listCameras, startCamera, stopWhenHidden } from '../app/veyrnox/_lib/liveEdit/camera.js';

function fakeTrack(extra = {}) {
    const listeners = new Map();
    const track = { kind: 'video', stopped: 0, readyState: 'live', stop() { track.stopped++; track.readyState = 'ended'; }, getSettings: () => ({ deviceId: 'cam-1' }),
        addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); }, fire(type) { listeners.get(type)?.(); }, hasListener: type => listeners.has(type), ...extra };
    return track;
}
const fakeStream = (tracks = [fakeTrack()]) => ({ getTracks: () => tracks, getVideoTracks: () => tracks.filter(t => t.kind === 'video'), getAudioTracks: () => tracks.filter(t => t.kind === 'audio'), tracks });
function fakeVideo(size = { videoWidth: 1280, videoHeight: 720 }) {
    const listeners = new Map();
    return { muted: false, playsInline: false, srcObject: null, played: 0, paused: 0, ...size, play() { this.played++; return Promise.resolve(); }, pause() { this.paused++; },
        addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); }, fire(type) { listeners.get(type)?.(); } };
}
const devices = (...impl) => { let call = 0; const seen = []; return { seen, getUserMedia: async constraints => { seen.push(constraints); return impl[Math.min(call++, impl.length - 1)](constraints); } }; };

test('constraints never ask for audio, default to the front camera, cap size and frame rate', () => {
    const c = cameraConstraints();
    assert.equal(c.audio, false); assert.equal(c.video.facingMode, 'user'); assert.equal(c.video.deviceId, undefined);
    assert.deepEqual(c.video.width, { ideal: CAMERA_LIMITS.idealWidth, max: CAMERA_LIMITS.maxWidth });
    assert.deepEqual(c.video.height, { ideal: CAMERA_LIMITS.idealHeight, max: CAMERA_LIMITS.maxHeight });
    assert.deepEqual(c.video.frameRate, { ideal: 30, max: 30 });
    const withDevice = cameraConstraints('abc');
    assert.deepEqual(withDevice.video.deviceId, { exact: 'abc' }); assert.equal(withDevice.video.facingMode, undefined); assert.equal(withDevice.audio, false);
});

test('every browser failure maps to its own state', () => {
    const cases = { NotAllowedError: 'camera-denied', PermissionDeniedError: 'camera-denied', SecurityError: 'camera-blocked', NotFoundError: 'camera-missing', DevicesNotFoundError: 'camera-missing',
        NotReadableError: 'camera-busy', TrackStartError: 'camera-busy', AbortError: 'camera-busy', OverconstrainedError: 'camera-unsupported', TypeError: 'camera-failed', SomethingElse: 'camera-failed' };
    for (const [name, code] of Object.entries(cases)) assert.equal(cameraErrorCode({ name }), code, name);
    assert.equal(cameraErrorCode(undefined), 'camera-failed');
    // Codes this module throws itself are plain Errors (name 'Error'); they must keep their own state (inspection S2B-06).
    for (const code of ['camera-blocked', 'camera-denied', 'camera-missing', 'camera-busy', 'camera-lost', 'camera-unsupported', 'camera-failed']) assert.equal(cameraErrorCode(new Error(code)), code, code);
    assert.equal(cameraErrorCode(new Error('something unrelated')), 'camera-failed');
});

test('start succeeds only with frames, mutes and inlines the video, and stop releases every track', async () => {
    const stream = fakeStream(), video = fakeVideo();
    const session = await startCamera({ video, mediaDevices: devices(async () => stream) });
    assert.equal(video.srcObject, stream); assert.equal(video.muted, true); assert.equal(video.playsInline, true); assert.equal(video.played, 1);
    assert.equal(session.settings.deviceId, 'cam-1');
    session.stop(); session.stop(); // idempotent
    assert.equal(stream.tracks[0].stopped, 1); assert.equal(stream.tracks[0].readyState, 'ended'); assert.equal(video.srcObject, null);
});

test('waits for real frames: a video without dimensions resolves on loadeddata and times out otherwise', async () => {
    const stream = fakeStream(), video = fakeVideo({ videoWidth: 0, videoHeight: 0 });
    const pending = startCamera({ video, mediaDevices: devices(async () => stream) });
    await new Promise(r => setTimeout(r, 10)); video.videoWidth = 640; video.videoHeight = 480; video.fire('loadeddata');
    assert.ok((await pending).stream);
    const stuck = fakeStream(), noFrames = fakeVideo({ videoWidth: 0, videoHeight: 0 });
    await assert.rejects(startCamera({ video: noFrames, mediaDevices: devices(async () => stuck), timeoutMs: 20 }), /camera-failed/);
    assert.equal(stuck.tracks[0].stopped, 1); assert.equal(noFrames.srcObject, null); // a failed start never leaves the camera on
});

test('permission and device errors are thrown unchanged for mapping', async () => {
    for (const name of ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'SecurityError']) {
        const error = Object.assign(new Error(name), { name });
        await assert.rejects(startCamera({ video: fakeVideo(), mediaDevices: devices(async () => { throw error; }) }), e => e === error && cameraErrorCode(e) !== 'camera-failed');
    }
});

test('an over-constrained camera is retried once with a plain, still audio-free request', async () => {
    const md = devices(async () => { throw Object.assign(new Error('x'), { name: 'OverconstrainedError' }); }, async () => fakeStream());
    const session = await startCamera({ video: fakeVideo(), mediaDevices: md });
    assert.ok(session.stream); assert.equal(md.seen.length, 2); assert.equal(md.seen[1].audio, false); assert.equal(md.seen[1].video, true);
});

test('insecure contexts, missing APIs and missing video elements are unsupported', async () => {
    await assert.rejects(startCamera({ video: fakeVideo(), mediaDevices: undefined }), /camera-unsupported/);
    await assert.rejects(startCamera({ video: fakeVideo(), mediaDevices: devices(async () => fakeStream()), secure: false }), /camera-unsupported/);
    await assert.rejects(startCamera({ video: null, mediaDevices: devices(async () => fakeStream()) }), /camera-unsupported/);
});

test('a stream that includes audio is stopped and refused, whatever the browser granted', async () => {
    const stream = fakeStream([fakeTrack(), fakeTrack({ kind: 'audio' })]);
    await assert.rejects(startCamera({ video: fakeVideo(), mediaDevices: devices(async () => stream) }), /camera-failed/);
    assert.ok(stream.tracks.every(t => t.stopped === 1));
    const none = fakeStream([]);
    await assert.rejects(startCamera({ video: fakeVideo(), mediaDevices: devices(async () => none) }), /camera-missing/);
});

test('cancelling while the permission prompt is open stops the camera that arrives late', async () => {
    const stream = fakeStream(), controller = new AbortController();
    const md = devices(async () => { controller.abort(); return stream; });
    await assert.rejects(startCamera({ video: fakeVideo(), mediaDevices: md, signal: controller.signal }), { name: 'AbortError' });
    assert.equal(stream.tracks[0].stopped, 1);
    await assert.rejects(startCamera({ video: fakeVideo(), mediaDevices: md, signal: controller.signal }), { name: 'AbortError' }); // already aborted: never even asks
});

test('a camera that ends mid-session reports once, and not after the page stopped it', async () => {
    const stream = fakeStream(); let ended = 0;
    const session = await startCamera({ video: fakeVideo(), mediaDevices: devices(async () => stream), onEnded: () => ended++ });
    stream.tracks[0].fire('ended'); assert.equal(ended, 1);
    session.stop(); assert.equal(stream.tracks[0].hasListener('ended'), false); stream.tracks[0].fire('ended'); assert.equal(ended, 1);
});

test('hidden tabs and page exits stop the camera; the disposer removes both listeners', () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' }), win = new EventTarget();
    let stops = 0, hidden = 0;
    const dispose = stopWhenHidden(() => stops++, () => hidden++, doc, win);
    doc.dispatchEvent(new Event('visibilitychange')); assert.equal(stops, 0); // visible: nothing
    doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')); assert.deepEqual([stops, hidden], [1, 1]);
    win.dispatchEvent(new Event('pagehide')); assert.deepEqual([stops, hidden], [2, 2]);
    dispose(); doc.dispatchEvent(new Event('visibilitychange')); win.dispatchEvent(new Event('pagehide')); assert.deepEqual([stops, hidden], [2, 2]);
});

test('camera listing returns only real video inputs and never throws', async () => {
    const md = { enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'a' }, { kind: 'audioinput', deviceId: 'm' }, { kind: 'videoinput', deviceId: '' }, { kind: 'videoinput', deviceId: 'b' }] };
    assert.deepEqual((await listCameras(md)).map(d => d.deviceId), ['a', 'b']);
    assert.deepEqual(await listCameras({ enumerateDevices: async () => { throw new Error('x'); } }), []);
    assert.deepEqual(await listCameras(undefined), []);
});

test('the Errors startCamera really throws map to the right state, end to end (S2B-06)', async () => {
    const thrown = async options => startCamera({ video: fakeVideo(), ...options }).then(() => null, error => error);
    assert.equal(cameraErrorCode(await thrown({ mediaDevices: undefined })), 'camera-unsupported');
    assert.equal(cameraErrorCode(await thrown({ mediaDevices: devices(async () => fakeStream()), secure: false })), 'camera-unsupported');
    assert.equal(cameraErrorCode(await thrown({ mediaDevices: devices(async () => fakeStream([])) })), 'camera-missing');
    assert.equal(cameraErrorCode(await thrown({ mediaDevices: devices(async () => fakeStream([fakeTrack(), fakeTrack({ kind: 'audio' })])) })), 'camera-failed');
});

test('a tab that is already hidden stops at once, and a stop registered before the camera is requested aborts the start (S2B-01)', async () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'hidden' }), win = new EventTarget();
    let stops = 0, hidden = 0;
    stopWhenHidden(() => stops++, () => hidden++, doc, win);
    assert.deepEqual([stops, hidden], [1, 1]); // no later event is needed
    // The editor aborts the start signal from that stop; a stream that arrives afterwards must be released.
    const controller = new AbortController(), stream = fakeStream();
    const pending = startCamera({ video: fakeVideo(), signal: controller.signal, mediaDevices: devices(async () => { await new Promise(r => setTimeout(r, 5)); return stream; }) });
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' }); assert.equal(stream.tracks[0].stopped, 1);
});

test('only a TypeError from getUserMedia means unsupported; a TypeError elsewhere stays a generic failure', async () => {
    const fromBrowser = await startCamera({ video: fakeVideo(), mediaDevices: devices(async () => { throw new TypeError('bad constraints'); }) }).catch(e => e);
    assert.equal(cameraErrorCode(fromBrowser), 'camera-unsupported');
    assert.equal(cameraErrorCode(new TypeError('cannot read properties of null')), 'camera-failed'); // e.g. video.current was null
    const blocked = Object.assign(new Error('x'), { name: 'SecurityError' });
    assert.equal(cameraErrorCode(await startCamera({ video: fakeVideo(), mediaDevices: devices(async () => { throw blocked; }) }).catch(e => e)), 'camera-blocked');
});
