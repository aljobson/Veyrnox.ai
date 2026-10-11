import { createVisionProcessor } from './editorVisionWorkerClient.mjs';
import { processVisionPixels, personFraming, validateVisionSettings } from './editorVisionPixelProcessing.mjs';
import { processMotionVideo } from './editorMotionVideo.mjs';
import { MOTION_VIDEO_LIMITS, trackedCrop } from './editorMotionProcessing.mjs';
import { checkMotionSignal } from './editorMotionAnalysis.mjs';
export const VISION_TOOLS = Object.freeze(['remove-background', 'replace-background', 'skin-retouch', 'person-glow', 'person-reframe']);
/** Real local person segmentation, baked into an ordinary new MP4 without modifying the original. */
export async function processVisionVideo(blob, options = {}) {
    if (!VISION_TOOLS.includes(options.tool)) throw new Error('Choose a local person tool.');
    if (options.tool === 'person-reframe' && ![9 / 16, 1, 16 / 9].includes(options.aspect)) throw new Error('Choose portrait, square or landscape framing.');
    if (options.tool !== 'person-reframe') { const problem = validateVisionSettings(options); if (problem) throw new Error(problem); }
    if (options.height !== undefined && ![360, 480, 720].includes(options.height)) throw new Error('Choose a supported processing size.');
    if (!(blob instanceof Blob) || blob.size < 1 || blob.size > MOTION_VIDEO_LIMITS.sourceBytes || !['video/mp4', 'video/quicktime', 'video/webm'].includes(blob.type)) throw new Error('Choose an MP4, MOV or WebM video under 100 MiB.');
    if (options.onProgress !== undefined && typeof options.onProgress !== 'function') throw new Error('Choose a valid processing callback.');
    checkMotionSignal(options.signal);
    options.onProgress?.({ stage: 'model', done: 0, total: 1 });
    const processor = await createVisionProcessor({ signal: options.signal });
    options.onProgress?.({ stage: 'model', done: 1, total: 1 });
    let personFrames = 0, noPersonFrames = 0, multipleFrames = 0, lastCentre = { x: .5, y: .5 }, masks, maskTime = -1, inferenceCount = 0;
    try {
        const result = await processMotionVideo(blob, {
            tool: 'camera-movement', name: options.name, signal: options.signal, onProgress: options.onProgress, height: options.height ?? 480, frameRate: 30, maxSeconds: 10, transparentOutput: options.tool === 'remove-background',
            from: { x: .5, y: .5, zoom: 1 }, to: { x: .5, y: .5, zoom: 1 }, outputAspect: options.tool === 'person-reframe' ? options.aspect : undefined,
            async processFrame(canvas, time, { picture, width, height }) {
                checkMotionSignal(options.signal);
                // Exact frame inference for foreground edges. Reframing uses 10Hz semantic
                // measurements and a smooth centre; it does not need thirty full masks per second.
                if (!masks || options.tool !== 'person-reframe' || time - maskTime >= .1 - 1e-7) { masks = await processor.segment(picture, time * 1000 + 1); maskTime = time; inferenceCount++; }
                const framing = personFraming(masks);
                if (framing.found) { personFrames++; if (framing.regions > 1) multipleFrames++; } else noPersonFrames++;
                const context = canvas.getContext('2d', { willReadFrequently: true });
                if (options.tool === 'person-reframe') {
                    if (framing.found) { lastCentre = personFrames === 1 ? { x: framing.x, y: framing.y } : { x: lastCentre.x + (framing.x - lastCentre.x) * .2, y: lastCentre.y + (framing.y - lastCentre.y) * .2 }; }
                    const crop = trackedCrop(picture.width, picture.height, options.aspect, lastCentre);
                    context.resetTransform(); context.clearRect(0, 0, width, height); context.drawImage(picture, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
                } else {
                    const pixels = context.getImageData(0, 0, width, height), processed = processVisionPixels(pixels, masks, options);
                    context.putImageData(new ImageData(processed.data, width, height), 0, 0);
                }
            },
        });
        result.report = { ...result.report, tool: options.tool, personFrames, noPersonFrames, multiplePersonRegionFrames: multipleFrames, inferenceCount, labels: processor.labels, limits: ['Uses a 256-pixel person model; hair, fast movement, low light and occlusion can reduce quality.'] };
        if (options.tool === 'skin-retouch') result.report.limits.push('Mask-based smoothing and optional skin light adjustment; no face or body reshaping.');
        if (options.tool === 'remove-background') result.report.limits.push('Transparent VP9/WebM for silent videos only; source audio is never discarded.');
        if (options.tool === 'replace-background') result.report.limits.push('Bakes a chosen solid background into MP4; the output does not have an alpha channel.');
        if (options.tool === 'person-reframe') result.report.limits.push('Follows the largest separate person mask; overlapping people can share one mask.');
        if (noPersonFrames) result.report.limits.push(`No reliable person mask in ${noPersonFrames} frames. Inspect the result.`);
        const name = String(options.name || 'source').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 60) || 'source';
        const extension = options.tool === 'remove-background' ? 'webm' : 'mp4';
        result.file = new File([result.blob], `${name}-${options.tool}.${extension}`, { type: result.blob.type });
        return result;
    } finally { processor.close(); }
}
