// Isolated Worker document: never import this module on the page or SSR graph.
let detector, initialization, busy = false;
async function init() {
    if (!initialization) initialization = (async () => {
        const { FilesetResolver, FaceLandmarker } = await import('./vision_bundle.mjs');
        const prefix = new URL('./', self.location.href).href;
        const files = await FilesetResolver.forVisionTasks(`${prefix}wasm`, true);
        detector = await FaceLandmarker.createFromOptions(files, {
            baseOptions: { modelAssetPath: `${prefix}face_landmarker.task`, delegate: 'CPU' },
            runningMode: 'IMAGE', numFaces: 2,
            minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5,
            outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false,
        });
    })();
    return initialization;
}
self.onmessage = async ({ data: request }) => {
    if (!request || !Number.isSafeInteger(request.id) || request.id < 1 || request.id >= 1000000 || !['init', 'detect'].includes(request.op)) { request?.bitmap?.close?.(); return; }
    if (busy) { request.bitmap?.close?.(); self.postMessage({ id: request.id, error: 'busy' }); return; }
    busy = true;
    try {
        if (request.op === 'init') { await init(); self.postMessage({ id: request.id, ready: true }); }
        else {
            const { bitmap } = request;
            if (!detector || !(bitmap instanceof ImageBitmap) || Math.min(bitmap.width, bitmap.height) < 8 || Math.max(bitmap.width, bitmap.height) > 384) throw new Error('bounds');
            const faces = detector.detect(bitmap).faceLandmarks;
            const count = Math.min(2, faces.length);
            // Multiple/no face never sends a stale face or a whole-frame mask.
            const landmarks = count === 1 ? new Float32Array(faces[0].flatMap(({ x, y, z }) => [x, y, z])) : new Float32Array();
            if (count === 1 && (landmarks.length !== 478 * 3 || !landmarks.every(Number.isFinite))) throw new Error('landmarks');
            self.postMessage({ id: request.id, count, landmarks }, [landmarks.buffer]);
        }
    } catch { self.postMessage({ id: request.id, error: 'face-inference-unavailable' }); }
    finally { request.bitmap?.close?.(); busy = false; }
};
