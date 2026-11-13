// Live camera proof page (ADR-0335, S2b). Runs under the strict harness CSP against the BUILT Worker with Chromium's
// FAKE camera (no real camera, no person). The camera must start only from the click on #start.
import { startCamera } from '../../app/veyrnox/_lib/liveEdit/camera.js';
import { createLiveEngine } from '../../app/veyrnox/_lib/liveEdit/liveEngine.js';
import { createPhotoRenderer } from '../../app/veyrnox/_lib/liveEdit/renderer.js';
import { DEFAULTS } from '../../packages/live-edit/effects.js';
import { MAKEUP_PRESETS, normalizeMakeup } from '../../packages/live-edit/makeup.js';
import { makeupFixture } from './photo-studio-makeup-fixture.mjs';

const requests = [];
const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia = constraints => { requests.push(constraints); return original(constraints); };
const video = document.createElement('video'), canvas = document.createElement('canvas'), button = document.createElement('button');
button.id = 'start'; button.textContent = 'Start camera'; video.muted = true; video.playsInline = true;
document.body.append(button, video, canvas);
window.cameraProof = { phase: 'waiting', requestsBeforeClick: () => requests.length };

button.addEventListener('click', async () => {
    const misses = [], checks = [], stats = {};
    const expect = (ok, label) => { if (ok) checks.push(label); else misses.push(label); };
    let session, engine;
    try {
        session = await startCamera({ video });
        expect(requests.length === 1 && requests[0].audio === false && requests[0].video.facingMode === 'user', 'camera-requested-once-no-audio-front');
        expect(video.videoWidth > 0 && video.videoHeight > 0, 'camera-frames-available');
        const faces = [];
        // Real renderer + REAL face Worker from the built Worker. The fake camera shows no face, so tracking must report that honestly.
        engine = createLiveEngine(canvas, video, { onFace: s => faces.push(s), onError: e => misses.push(`engine-error:${e}`) });
        engine.setSettings({ ...DEFAULTS, makeup: normalizeMakeup(MAKEUP_PRESETS.glam) });
        await engine.ready;
        await new Promise(resolve => setTimeout(resolve, 3000));
        Object.assign(stats, engine.stats());
        expect(stats.frames >= 10, `rendered-frames>=10 (got ${stats.frames})`);
        expect(stats.landmarkResults >= 5, `landmark-results>=5 (got ${stats.landmarkResults})`);
        expect(faces.includes('no-face') && !faces.includes('face-unavailable'), `fake-camera-reports-no-face (${faces.join(',')})`);
        expect(canvas.width === video.videoWidth && canvas.height === video.videoHeight, 'canvas-matches-video-size');
        const blob = await engine.capture();
        expect(blob.type === 'image/png' && blob.size > 100, 'capture-png');
        // Same-task relation on a live frame: makeup changes lips/eyes regions only, and strength 0 changes nothing.
        const { points } = makeupFixture(), out = document.createElement('canvas'), renderer = createPhotoRenderer(out, video);
        try {
            renderer.updateSource(); renderer.setLandmarks(points);
            const read = () => out.getContext('2d').getImageData(0, 0, out.width, out.height).data;
            // Compare WebGL against WebGL. The untouched path draws the <video> through the 2D canvas, which converts video colour
            // differently, and a playing video's current frame may advance between two 2D reads. A negligible brightness offset keeps
            // every draw on the same shader path and the same uploaded frame, so only the makeup can differ.
            const gl = { ...DEFAULTS, brightness: .001 };
            renderer.draw({ ...gl, makeup: normalizeMakeup(MAKEUP_PRESETS.glam) }); const withMakeup = Uint8ClampedArray.from(read());
            renderer.draw(gl); const plain = Uint8ClampedArray.from(read());
            renderer.draw({ ...gl, makeup: normalizeMakeup(Object.fromEntries(Object.entries(MAKEUP_PRESETS.glam).map(([k, v]) => [k, { ...v, strength: 0 }]))) }); const zero = Uint8ClampedArray.from(read());
            let changed = 0, zeroChanged = 0, cornerChanged = 0;
            for (let i = 0; i < plain.length; i += 4) {
                const d = Math.abs(withMakeup[i] - plain[i]) + Math.abs(withMakeup[i + 1] - plain[i + 1]) + Math.abs(withMakeup[i + 2] - plain[i + 2]);
                if (d > 6) { changed++; const p = i / 4, x = p % out.width, y = Math.floor(p / out.width); if (x < out.width * .05 && y < out.height * .05) cornerChanged++; }
                if (Math.abs(zero[i] - plain[i]) + Math.abs(zero[i + 1] - plain[i + 1]) + Math.abs(zero[i + 2] - plain[i + 2]) > 0) zeroChanged++;
            }
            expect(changed > 200, `makeup-changes-live-pixels (${changed})`); expect(cornerChanged === 0, 'makeup-leaves-frame-corner-alone'); expect(zeroChanged === 0, 'strength-0-identical-on-live-frame');
        } finally { renderer.close(); }
        engine.close(); engine = undefined;
        const tracks = session.stream.getTracks();
        session.stop(); session = undefined;
        expect(tracks.length === 1 && tracks.every(t => t.readyState === 'ended') && video.srcObject === null, 'stop-releases-every-track');
    } catch (error) { misses.push(`threw:${error?.name ?? ''}:${error?.message ?? error}`); }
    finally { engine?.close(); session?.stop(); }
    window.cameraProof = { phase: 'done', checks, misses, stats, requests };
});
