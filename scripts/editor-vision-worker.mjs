// This module runs only in its same-origin, separately governed Worker document.
// Model/SDK paths are fixed. No user source bytes, names or masks leave the device.
let segmenter, initialization, busy = false, timestamp = -1;
const boundedId = id => Number.isSafeInteger(id) && id > 0 && id < 1000000;
async function init() {
    if (!initialization) initialization = (async () => {
        const { FilesetResolver, ImageSegmenter } = await import('./vision_bundle.mjs');
        const prefix = new URL('./', self.location.href).href;
        const files = await FilesetResolver.forVisionTasks(`${prefix}wasm`, true);
        segmenter = await ImageSegmenter.createFromOptions(files, { baseOptions: { modelAssetPath: `${prefix}selfie_multiclass_256x256.tflite`, delegate: 'CPU' }, runningMode: 'VIDEO', outputCategoryMask: true, outputConfidenceMasks: true });
        const labels = segmenter.getLabels();
        if (labels.length !== 6) throw new Error('The segmentation model does not have the expected classes.');
        return labels;
    })();
    return initialization;
}
self.onmessage = async event => {
    const request = event.data;
    if (!request || !boundedId(request.id) || !['init', 'segment'].includes(request.op)) { request?.bitmap?.close?.(); return; }
    if (busy) { request.bitmap?.close?.(); self.postMessage({ id: request.id, error: 'The picture processor is busy.' }); return; }
    busy = true;
    try {
        if (request.op === 'init') { const labels = await init(); self.postMessage({ id: request.id, ready: true, labels }); }
        else {
            if (!segmenter || !(request.bitmap instanceof ImageBitmap) || request.bitmap.width < 8 || request.bitmap.height < 8 || Math.max(request.bitmap.width, request.bitmap.height) > 384 || !Number.isFinite(request.timestamp) || request.timestamp <= timestamp) throw new Error('Choose a bounded picture with increasing timing.');
            timestamp = request.timestamp;
            const result = segmenter.segmentForVideo(request.bitmap, timestamp);
            try {
                if (result.confidenceMasks?.length !== 6 || !result.categoryMask) throw new Error('The segmentation model returned incomplete masks.');
                const width = result.categoryMask.width, height = result.categoryMask.height;
                if (width < 8 || height < 8 || Math.max(width, height) > 512) throw new Error('The segmentation masks exceeded their bounds.');
                const background = new Float32Array(result.confidenceMasks[0].getAsFloat32Array()), body = new Float32Array(result.confidenceMasks[2].getAsFloat32Array()), face = new Float32Array(result.confidenceMasks[3].getAsFloat32Array()), categories = new Uint8Array(result.categoryMask.getAsUint8Array());
                self.postMessage({ id: request.id, width, height, background, body, face, categories }, [background.buffer, body.buffer, face.buffer, categories.buffer]);
            } finally { result.close(); }
        }
    } catch { self.postMessage({ id: request.id, error: request.op === 'init' ? 'The local segmentation runtime could not initialize.' : 'This picture could not be segmented.' }); }
    finally { request.bitmap?.close?.(); busy = false; }
};
