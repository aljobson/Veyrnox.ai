// Live camera engine (ADR-0338, S2b). Same renderer and face Worker as a still photo, driven by a playing <video>.
//  - Render at display/video rate; landmarks arrive as fast as the Worker answers.
//  - ONE detection in flight, latest frame wins: while busy, frames are dropped, never queued, so lag cannot build up.
//  - Landmarks are smoothed (One-Euro). Switching face effects OFF is immediate and never throttled; only building
//    replacement masks is limited (LIVE.maskIntervalMs). The dropout hold and the stalled-tracker limit are enforced from the
//    RENDER clock, so a tracker request that never returns cannot leave stale effects on screen.
//  - Hair segmentation (16 MB model) is NOT run live; take a photo to use hair recolour. Stickers are not drawn live.
import { createPhotoRenderer } from './renderer.js';
import { createFaceProcessor } from './faceClient.mjs';
import { DEFAULTS, normalize } from './settings.js';
import { createLandmarkFilter } from '../../../../packages/live-edit/smoothing.js';

export const LIVE = Object.freeze({ holdMs: 400, staleMs: 1000, maskIntervalMs: 66 });

export function createLiveEngine(canvas, video, {
    onFace = () => {}, onWig = () => {}, onError = () => {}, onResize = () => {}, rendererFactory = createPhotoRenderer, processorFactory = createFaceProcessor,
    now = () => performance.now(), createCaptureCanvas = () => document.createElement('canvas'),
} = {}) {
    const controller = new AbortController(), filter = createLandmarkFilter();
    let closed = false, renderer, processor, busy = false, compare = false, settings = live(normalize(DEFAULTS));
    let landmarks = new Float32Array(), active = false, pending, lastMaskAt = -Infinity, lastResultAt = -Infinity, missingSince, face = '', size = '', loop = 0, cancel;
    const counters = { frames: 0, results: 0, dropped: 0, startedAt: 0 };

    function live(value) { return { ...value, stickers: [] }; } // stickers have no handles live and would sit at fixed coordinates
    function report(status) { if (status !== face) { face = status; onFace(status); } }
    function build() { renderer = rendererFactory(canvas, video, { onWigChange: () => {}, onWig }); size = `${video.videoWidth}x${video.videoHeight}`; }
    function applyLandmarks(points) {
        landmarks = points?.length ? points : new Float32Array(); active = landmarks.length > 0;
        renderer.setLandmarks(active ? landmarks : null);
    }
    /** Effects off NOW (no throttle). Cheap: an empty face mask. */
    function disable(status) {
        filter.reset(); pending = undefined; missingSince = undefined;
        if (active) { applyLandmarks(new Float32Array()); lastMaskAt = now(); }
        report(status);
    }
    function frame(time) {
        loop = 0; if (closed) return;
        schedule();
        if (video.readyState < 2 || !video.videoWidth) return;
        try {
            if (size !== `${video.videoWidth}x${video.videoHeight}`) { // device rotated or stream renegotiated
                renderer.close(); build(); applyLandmarks(landmarks); onResize(video.videoWidth, video.videoHeight);
            }
            const t = now();
            const tracked = active || pending !== undefined;
            if (tracked && t - lastResultAt >= LIVE.staleMs) disable('face-unavailable'); // the tracker has gone quiet: do not claim there is no face
            else if (tracked && missingSince !== undefined && t - missingSince >= LIVE.holdMs) disable('no-face');
            else if (pending !== undefined && t - lastMaskAt >= LIVE.maskIntervalMs) { applyLandmarks(pending); pending = undefined; lastMaskAt = t; }
            renderer.updateSource(); renderer.draw(compare ? DEFAULTS : settings, { quiet: compare });
            if (!counters.frames) counters.startedAt = time ?? t;
            counters.frames++;
        } catch { stop(); onError('graphics-lost'); return; }
        detect();
    }
    function schedule() {
        if (closed || loop) return;
        if (typeof video.requestVideoFrameCallback === 'function') { const id = video.requestVideoFrameCallback(frame); cancel = () => video.cancelVideoFrameCallback?.(id); loop = id || 1; }
        else { const id = requestAnimationFrame(frame); cancel = () => cancelAnimationFrame(id); loop = id || 1; }
    }
    function stop() { closed = true; cancel?.(); cancel = undefined; }
    async function detect() {
        if (busy || closed || !processor) { if (busy) counters.dropped++; return; }
        busy = true;
        try {
            const result = await processor.detect(video);
            if (closed) return;
            counters.results++;
            const time = now(); lastResultAt = time;
            if (result.count === 1) {
                missingSince = undefined; pending = filter.update(result.landmarks, time); report('one-face');
            } else if (result.count === 2) {
                disable('multiple-faces'); // ambiguous: never pick a face, and never wait for the mask throttle
            } else if (!active && pending === undefined) {
                report('no-face');
            } else {
                missingSince ??= time; // a short dropout keeps the last good face; frame() enforces the limit from the render clock
                if (time - missingSince >= LIVE.holdMs) disable('no-face');
            }
        } catch (error) {
            if (closed || error?.name === 'AbortError') return;
            // The Worker client closes itself on a failed request; effects go off and the UI offers a retry.
            processor = undefined; disable('face-unavailable');
        } finally { busy = false; }
    }

    const ready = (async () => {
        report('detecting');
        renderer = undefined;
        try { build(); } catch (error) { onError(error?.message === 'photo-too-large' ? 'photo-too-large' : 'graphics-unavailable'); throw error; }
        try { processor = await processorFactory({ signal: controller.signal }); }
        catch (error) { if (!closed && error?.name !== 'AbortError') report('face-unavailable'); }
        if (!closed) { lastResultAt = now(); schedule(); }
    })();

    return {
        ready,
        get landmarks() { return landmarks.slice(); },
        setSettings(next) { settings = live(normalize(next)); },
        compare(value) { compare = Boolean(value); },
        /** Raw frame (no effects, not mirrored) as a PNG, for the normal photo flow where hair and wig coverage work at full quality. */
        async capture() {
            if (closed || video.readyState < 2 || !video.videoWidth) throw new Error('camera-not-ready');
            const still = createCaptureCanvas(); still.width = video.videoWidth; still.height = video.videoHeight;
            still.getContext('2d').drawImage(video, 0, 0);
            return new Promise((resolve, reject) => still.toBlob(blob => blob ? resolve(blob) : reject(new Error('export-failed')), 'image/png'));
        },
        stats() {
            const seconds = counters.frames ? Math.max(0.001, (now() - counters.startedAt) / 1000) : 0;
            return { frames: counters.frames, landmarkResults: counters.results, dropped: counters.dropped, seconds, fps: seconds ? counters.frames / seconds : 0, landmarkHz: seconds ? counters.results / seconds : 0 };
        },
        close() {
            if (closed && !renderer) return;
            stop(); controller.abort(); processor?.close?.(); processor = undefined; filter.reset(); landmarks = new Float32Array(); active = false; pending = undefined;
            try { renderer?.close(); } catch { /* context already lost */ } renderer = undefined;
        },
    };
}
