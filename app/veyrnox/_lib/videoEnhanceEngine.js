import { VIDEO_ENHANCE_ASSET_PATH } from './videoEnhanceAssets.mjs';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { createRenderer } from './videoEnhanceRenderer';
import { exportEnhancedVideo } from './videoEnhanceExport.mjs';
import { acquireSetupTracker } from './videoEnhanceSetup.mjs';

export async function createVideoEnhanceEngine(video, canvas, onFrame, onError, signal) {
    // Production CSP intentionally does not allow WASM compilation. This spike
    // uses next dev's existing policy; a production engine needs a separate ADR.
    if (process.env.NODE_ENV !== 'development') throw new Error('Video Enhance is a local preview only.');
    signal?.throwIfAborted();
    const files = await FilesetResolver.forVisionTasks(`${VIDEO_ENHANCE_ASSET_PATH}/wasm`);
    const tracker = await acquireSetupTracker(() => FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: `${VIDEO_ENHANCE_ASSET_PATH}/face_landmarker.task`, delegate: 'CPU' },
        runningMode: 'VIDEO', numFaces: 2,
        minFaceDetectionConfidence: 0.6, minFacePresenceConfidence: 0.6, minTrackingConfidence: 0.6,
    }), signal);
    let renderer;
    try { renderer = createRenderer(canvas); } catch (error) { tracker.close(); throw error; }
    const input = document.createElement('canvas');
    const context = input.getContext('2d');
    let settings = { smoothing: 30, look: 'natural', intensity: 100 };
    let callback, disposed = false, timestamp = 0, faces = [], lastTime = -1, exportController, failure, cancelSeek;
    function fail(error) {
        if (disposed || failure) return;
        failure = error;
        cancelSeek?.(error);
        video.pause(); exportController?.abort();
        if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(callback); else cancelAnimationFrame(callback);
        onError(error.message);
    }
    const graphicsLost = () => fail(new Error('The video preview lost graphics access. Choose the video again to retry.'));
    canvas.addEventListener('webglcontextlost', graphicsLost);
    function draw(force = false) {
        if (disposed || failure || exportController || video.readyState < 2 || video.seeking) return;
        try {
            if (force || video.currentTime !== lastTime) {
                const scale = Math.min(1, 384 / Math.max(video.videoWidth, video.videoHeight));
                input.width = Math.round(video.videoWidth * scale); input.height = Math.round(video.videoHeight * scale);
                context.drawImage(video,0,0,input.width,input.height);
                timestamp = Math.max(timestamp + 1, performance.now());
                faces = settings.smoothing > 0 ? tracker.detectForVideo(input, timestamp).faceLandmarks : [];
                lastTime = video.currentTime;
            }
            renderer.draw(video, faces, settings);
            onFrame({ time: video.currentTime, faces: faces.length, playing: !video.paused });
        } catch (error) { fail(error); }
    }
    function tick() {
        draw();
        if (!disposed && !failure) callback = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
    }
    const redraw = () => draw(true);
    video.addEventListener('seeked', redraw); video.addEventListener('loadeddata', redraw);
    tick();
    const seek = seconds => new Promise((resolve, reject) => {
        if (disposed) { reject(new DOMException('The video editor is closed.', 'AbortError')); return; }
        if (failure) { reject(failure); return; }
        cancelSeek?.(new DOMException('A newer seek replaced this one.', 'AbortError'));
        if (Math.abs(video.currentTime - seconds) < 0.001 && video.readyState >= 2 && !video.seeking) { draw(true); resolve(); return; }
        let timeout;
        const cleanup = () => {
            clearTimeout(timeout); video.removeEventListener('seeked', done);
            if (cancelSeek === cancel) cancelSeek = undefined;
        };
        const cancel = error => { cleanup(); reject(error); };
        const done = () => { cleanup(); resolve(); };
        cancelSeek = cancel;
        timeout = setTimeout(() => cancel(new Error('The video could not seek. Try a different clip.')), 5000);
        video.addEventListener('seeked', done, { once: true });
        try { video.currentTime = seconds; } catch (error) { cancel(error); }
    });
    return {
        setSettings(value) { settings = value; draw(true); },
        async play() { await video.play(); },
        pause() { video.pause(); },
        seek,
        cancel() { exportController?.abort(); },
        async export(file) {
            if (failure) throw failure;
            if (disposed) throw new Error('The video editor is closed.');
            if (exportController) throw new Error('An export is already running.');
            const controller = new AbortController(); exportController = controller;
            const assertActive = () => {
                if (failure) throw failure;
                if (disposed || controller.signal.aborted) throw new Error('Export cancelled.');
            };
            const hidden = () => { if (document.hidden) controller.abort(); };
            document.addEventListener('visibilitychange', hidden);
            video.pause();
            const decoded = document.createElement('canvas');
            const decodedContext = decoded.getContext('2d');
            try {
                const result = await exportEnhancedVideo(file, {
                    signal: controller.signal,
                    process(sample) {
                        assertActive();
                        decoded.width = sample.displayWidth; decoded.height = sample.displayHeight;
                        sample.draw(decodedContext, 0, 0);
                        const scale = Math.min(1, 384 / Math.max(decoded.width, decoded.height));
                        input.width = Math.round(decoded.width * scale); input.height = Math.round(decoded.height * scale);
                        context.drawImage(decoded, 0, 0, input.width, input.height);
                        timestamp = Math.max(timestamp + 1, performance.now());
                        faces = settings.smoothing > 0 ? tracker.detectForVideo(input, timestamp).faceLandmarks : [];
                        try { renderer.draw(decoded, faces, settings); } catch (error) { fail(error); throw error; }
                        onFrame({ time: sample.timestamp, faces: faces.length, playing: false });
                        return canvas;
                    },
                });
                assertActive();
                return result;
            } catch (error) {
                throw failure || error;
            } finally {
                document.removeEventListener('visibilitychange', hidden);
                exportController = undefined;
                if (!disposed) draw(true);
            }
        },
        close() {
            if (disposed) return;
            canvas.removeEventListener('webglcontextlost', graphicsLost);
            disposed = true;
            cancelSeek?.(new DOMException('The video editor is closed.', 'AbortError'));
            exportController?.abort(); video.pause();
            if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(callback); else cancelAnimationFrame(callback);
            video.removeEventListener('seeked', redraw); video.removeEventListener('loadeddata', redraw);
            tracker.close(); renderer.close();
        },
    };
}
