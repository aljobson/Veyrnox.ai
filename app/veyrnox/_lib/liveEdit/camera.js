// Live camera lifecycle for the web Photo Studio (ADR-0338, S2b).
// Frames never leave this page: no recording, no audio (audio is never requested), no upload.
// Every failure maps to its own state so the UI can say what actually happened.
export const CAMERA_LIMITS = Object.freeze({ idealWidth: 1280, idealHeight: 720, maxWidth: 1920, maxHeight: 1080, frameRate: 30, startTimeoutMs: 15000 });

// Codes this module throws itself as plain Errors (name 'Error', message = code). They win over browser exception names.
const INTERNAL_CODES = new Set(['camera-blocked', 'camera-denied', 'camera-missing', 'camera-busy', 'camera-lost', 'camera-unsupported', 'camera-failed']);
export function cameraErrorCode(error) {
    if (INTERNAL_CODES.has(error?.message)) return error.message;
    const name = error?.name;
    if (name === 'SecurityError') return 'camera-blocked'; // e.g. a Permissions-Policy block: browser settings will not help
    if (['NotAllowedError', 'PermissionDeniedError'].includes(name)) return 'camera-denied';
    if (['NotFoundError', 'DevicesNotFoundError'].includes(name)) return 'camera-missing';
    if (['NotReadableError', 'TrackStartError', 'AbortError'].includes(name)) return 'camera-busy';
    if (['OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(name)) return 'camera-unsupported';
    return 'camera-failed';
}

export function cameraConstraints(deviceId) {
    const { idealWidth, idealHeight, maxWidth, maxHeight, frameRate } = CAMERA_LIMITS;
    return {
        audio: false, // never: the page has no use for a microphone
        video: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }),
            width: { ideal: idealWidth, max: maxWidth }, height: { ideal: idealHeight, max: maxHeight }, frameRate: { ideal: frameRate, max: frameRate },
        },
    };
}

export async function listCameras(mediaDevices = globalThis.navigator?.mediaDevices) {
    try { return (await mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput' && device.deviceId); }
    catch { return []; }
}

const abortError = () => new DOMException('Camera start cancelled.', 'AbortError');
function stopStream(stream) { stream?.getTracks?.().forEach(track => { try { track.stop(); } catch { /* already stopped */ } }); }

/**
 * Starts the camera into `video`, resolving once real frames are available.
 * The caller must invoke start only from an explicit user gesture (a visible button).
 */
export async function startCamera({ video, deviceId, signal, onEnded = () => {}, mediaDevices = globalThis.navigator?.mediaDevices, secure = globalThis.isSecureContext !== false, timeoutMs = CAMERA_LIMITS.startTimeoutMs } = {}) {
    if (!video || !mediaDevices?.getUserMedia || !secure) throw new Error('camera-unsupported');
    if (signal?.aborted) throw abortError();
    let stream;
    try { stream = await mediaDevices.getUserMedia(cameraConstraints(deviceId)); }
    catch (error) {
        // A TypeError from getUserMedia itself means the browser cannot do this request; a TypeError anywhere else is a bug and must not hide as "unsupported".
        if (error?.name === 'TypeError') throw new Error('camera-unsupported');
        // A camera that cannot honour the preferred size or facing still works with the plain request.
        if (!['OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(error?.name)) throw error;
        stream = await mediaDevices.getUserMedia({ audio: false, video: deviceId ? { deviceId: { exact: deviceId } } : true });
    }
    if (signal?.aborted) { stopStream(stream); throw abortError(); }
    // A stream with audio must never be kept, whatever the browser decided to grant.
    if (stream.getAudioTracks?.().length) { stopStream(stream); throw new Error('camera-failed'); }
    const track = stream.getVideoTracks?.()[0];
    if (!track) { stopStream(stream); throw new Error('camera-missing'); }
    let stopped = false;
    const ended = () => { if (!stopped) onEnded(); };
    track.addEventListener?.('ended', ended);
    function stop() {
        if (stopped) return;
        stopped = true; track.removeEventListener?.('ended', ended);
        stopStream(stream);
        try { video.pause?.(); } catch { /* detached */ }
        video.srcObject = null;
    }
    try {
        video.muted = true; video.playsInline = true; video.srcObject = stream;
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('camera-failed')), timeoutMs);
            const abort = () => reject(abortError());
            signal?.addEventListener('abort', abort, { once: true });
            Promise.resolve(video.play?.()).then(() => {
                const ready = () => { if (video.videoWidth > 0 && video.videoHeight > 0) { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(); return true; } return false; };
                if (ready()) return;
                const check = () => { if (ready()) video.removeEventListener('loadeddata', check); };
                video.addEventListener('loadeddata', check); video.addEventListener('resize', check);
            }, reject);
        });
    } catch (error) { stop(); throw error; }
    return { stream, track, video, stop, settings: track.getSettings?.() ?? {} };
}

/**
 * Stops a running camera when the tab is hidden or the page is going away: a hidden tab must not hold the camera.
 * Returns a disposer. `onHidden` runs after the camera has been stopped.
 */
export function stopWhenHidden(stop, onHidden = () => {}, target = globalThis.document, pageTarget = globalThis.window) {
    const hide = () => { stop(); onHidden(); };
    const visibility = () => { if (target?.visibilityState === 'hidden') hide(); };
    target?.addEventListener?.('visibilitychange', visibility);
    pageTarget?.addEventListener?.('pagehide', hide);
    // Register BEFORE the camera is requested and look at the current state straight away: a tab hidden while the permission
    // prompt is open must never end up holding a live camera.
    if (target?.visibilityState === 'hidden') hide();
    return () => { target?.removeEventListener?.('visibilitychange', visibility); pageTarget?.removeEventListener?.('pagehide', hide); };
}
