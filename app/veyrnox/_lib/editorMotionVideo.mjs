import { MOTION_ANALYSIS_EDGE, grayscale, estimateBlockFlow, globalMotion, meanLuminance, smoothMotionPath, trackMotionRegion, checkMotionSignal, retainsExposureStructure } from './editorMotionAnalysis.mjs';
import { MOTION_VIDEO_LIMITS, validateMotionOptions, interpolateMotionPictures, trackedCrop, movementCrop, stabilizationZoom } from './editorMotionProcessing.mjs';
import { createAlphaCanvasSource, registerLocalVp9AlphaDecoder } from './editorAlphaVideo.mjs';
const ANALYSIS_RATE = 30;
const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));
class MotionReader {
    constructor(sink, from, to) { this.iterator = sink.canvases(from, to); this.current = null; this.next = null; this.done = false; }
    async bracket(time, signal) {
        checkMotionSignal(signal);
        if (!this.current && !this.done) { const r = await this.iterator.next(); this.current = r.value || null; this.done = r.done; }
        while (!this.done) {
            if (!this.next) { const r = await this.iterator.next(); this.next = r.value || null; this.done = r.done; }
            if (this.next && this.next.timestamp <= time + 1e-7) { this.current = this.next; this.next = null; } else break;
            checkMotionSignal(signal);
        }
        return { left: this.current, right: this.next };
    }
    async close() { await this.iterator.return?.(); this.current = null; this.next = null; }
}
const canvasPixels = canvas => canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
function analysisSize(width, height) {
    const scale = MOTION_ANALYSIS_EDGE / Math.max(width, height);
    return { width: Math.max(8, Math.round(width * scale)), height: Math.max(8, Math.round(height * scale)) };
}
function pictureContrast(gray) {
    let sum = 0, square = 0;
    for (const value of gray.data) { sum += value; square += value * value; }
    return Math.max(0, square / gray.data.length - (sum / gray.data.length) ** 2);
}
function sampleAt(samples, time) {
    const index = Math.max(0, Math.min(samples.length - 1, Math.round(time * ANALYSIS_RATE)));
    return samples[index];
}
async function analyse(track, duration, origin, options, engine) {
    const size = analysisSize(await track.getDisplayWidth(), await track.getDisplayHeight()), reader = new MotionReader(new engine.CanvasSink(track, { ...size, fit: 'fill', poolSize: 3 }), origin, origin + duration);
    const samples = []; let previous = null, trackReference = null, region = options.region, x = 0, y = 0;
    try {
        for (let i = 0; i < Math.ceil(duration * ANALYSIS_RATE); i++) {
            checkMotionSignal(options.signal);
            const picture = (await reader.bracket(origin + i / ANALYSIS_RATE, options.signal)).left?.canvas;
            if (!picture) throw new Error('A source picture could not be decoded.');
            const gray = grayscale(canvasPixels(picture)); let motion = { x: 0, y: 0, confidence: 0, cut: false };
            if (previous) {
                motion = globalMotion(estimateBlockFlow(previous, gray, { signal: options.signal }));
                // A blank frame has no camera motion information, but uniform exposure flicker
                // on blank frames is not itself evidence of an editorial cut.
                if (motion.cut && pictureContrast(previous) < .0003 && pictureContrast(gray) < .0003) motion.cut = false;
                // Compression can erase fine texture at the brighter/darker exposure.
                // Only flicker correction may veto that cut, with matching coarse
                // structure plus a substantial exposure change; motion tools retain it.
                if (motion.cut && options.tool === 'flicker' && retainsExposureStructure(previous, gray)) motion.cut = false;
                if (motion.cut) { x = 0; y = 0; } else { x += motion.x; y += motion.y; }
            }
            let tracked = null;
            if (options.tool === 'track-reframe') {
                if (!trackReference) trackReference = gray;
                tracked = trackMotionRegion(trackReference, gray, region, { signal: options.signal });
                region = { x: tracked.x, y: tracked.y, width: tracked.width, height: tracked.height };
                if (tracked.tracked) trackReference = gray;
            }
            samples.push({ x, y, luminance: meanLuminance(gray), confidence: motion.confidence, cut: motion.cut, region: tracked }); previous = gray;
            options.onProgress({ stage: 'analyse', done: i + 1, total: Math.ceil(duration * ANALYSIS_RATE) });
            if (i % 3 === 0) await yieldToBrowser();
        }
        return { size, samples: smoothMotionPath(samples, options.smoothing ?? 10) };
    } finally { await reader.close(); }
}
/**
 * Bakes one bounded local operation into a new MP4. No original bytes or timeline state are changed.
 * Import/relink `file` through the existing probe path, then add it as a distinct source.
 * onProgress({stage:'analyse'|'encode'|'done',done,total}); signal cancels and discards partial output.
 * Returns {blob,file,report}. Audio and source duration are retained; optical-flow increases picture cadence.
 */
export async function processMotionVideo(blob, rawOptions = {}) {
    const problem = validateMotionOptions(rawOptions); if (problem) throw new Error(problem);
    if (!(blob instanceof Blob) || blob.size < 1 || blob.size > MOTION_VIDEO_LIMITS.sourceBytes || !['video/mp4', 'video/quicktime', 'video/webm'].includes(blob.type)) throw new Error('Choose an MP4, MOV or WebM video under 100 MiB.');
    const options = { ...rawOptions, strength: rawOptions.strength ?? 1, frameRate: rawOptions.frameRate ?? (rawOptions.tool === 'optical-flow' ? 60 : 30), height: rawOptions.height ?? (rawOptions.tool === 'optical-flow' ? 480 : 720), onProgress: rawOptions.onProgress ?? (() => {}) };
    if (typeof options.onProgress !== 'function' || (options.processFrame !== undefined && typeof options.processFrame !== 'function')) throw new Error('Choose a valid processing callback.');
    if (options.transparentOutput !== undefined && typeof options.transparentOutput !== 'boolean') throw new Error('Choose a supported transparency setting.');
    if (options.outputAspect !== undefined && ![9 / 16, 1, 16 / 9].includes(options.outputAspect)) throw new Error('Choose a supported output aspect.');
    if (options.maxSeconds !== undefined && (!Number.isFinite(options.maxSeconds) || options.maxSeconds < 1 || options.maxSeconds > 30)) throw new Error('Choose a bounded processing duration.');
    checkMotionSignal(options.signal);
    if (typeof OffscreenCanvas === 'undefined' || typeof VideoEncoder === 'undefined') throw new Error('Local picture processing requires desktop Chrome with video encoding.');
    const engine = await import('mediabunny');
    await registerLocalVp9AlphaDecoder(engine);
    const input = new engine.Input({ source: new engine.BlobSource(blob), formats: engine.ALL_FORMATS });
    let output, pictureReader, audioIterator, pendingAudio, videoSource, audioSource, audioConfig;
    try {
        const track = await input.getPrimaryVideoTrack();
        if (!track || !await track.canDecode()) throw new Error('This browser cannot decode the selected video.');
        const sourceWidth = await track.getDisplayWidth(), sourceHeight = await track.getDisplayHeight(), origin = await track.getFirstTimestamp(), duration = await track.computeDuration() - origin;
        if (!Number.isFinite(duration) || duration <= 0 || duration > (options.maxSeconds ?? (options.tool === 'optical-flow' ? MOTION_VIDEO_LIMITS.opticalSeconds : MOTION_VIDEO_LIMITS.sourceSeconds))) throw new Error(`Choose up to ${options.maxSeconds ?? (options.tool === 'optical-flow' ? 10 : 30)} seconds for local picture processing.`);
        if (![sourceWidth, sourceHeight, origin].every(Number.isFinite) || sourceWidth < 8 || sourceHeight < 8 || Math.max(sourceWidth, sourceHeight) > 4096 || Math.min(sourceWidth, sourceHeight) / Math.max(sourceWidth, sourceHeight) < .1) throw new Error('Choose a video between 8 and 4096 pixels with a supported aspect ratio.');
        const targetAspect = options.outputAspect ?? (options.tool === 'track-reframe' ? options.aspect : sourceWidth / sourceHeight);
        const height = Math.min(options.height, Math.floor(1280 / targetAspect / 2) * 2), width = Math.max(8, Math.floor(height * targetAspect / 2) * 2);
        const frameCount = Math.ceil(duration * options.frameRate);
        if (height < 8 || frameCount > MOTION_VIDEO_LIMITS.frames) throw new Error('This result exceeds the local processing bounds.');
        const videoCodec = options.transparentOutput ? 'vp9' : 'avc';
        if (!await engine.canEncodeVideo(videoCodec, { width, height, quality: engine.QUALITY_HIGH, alpha: options.transparentOutput ? 'keep' : 'discard' })) throw new Error('This browser cannot encode this picture size.');
        const sourceScale = Math.min(options.height / sourceHeight, 1280 / sourceWidth), decodeWidth = Math.max(8, Math.round(sourceWidth * sourceScale)), decodeHeight = Math.max(8, Math.round(sourceHeight * sourceScale));
        const audioTrack = await input.getPrimaryAudioTrack();
        if (audioTrack && options.transparentOutput) throw new Error('Transparent WebM currently requires a silent video. Original audio is not discarded.');
        if (audioTrack && await audioTrack.getCodec() !== 'aac') throw new Error('Picture processing currently preserves AAC audio only. Choose a video with AAC audio or a silent video.');
        if (audioTrack && Math.abs((await audioTrack.getFirstTimestamp()) - origin) > .1) throw new Error('Choose a source whose picture and sound begin together.');
        const analysis = options.tool === 'camera-movement' ? null : await analyse(track, duration, origin, options, engine);
        const zoom = options.tool === 'stabilize' ? stabilizationZoom(analysis.samples, analysis.size.width, analysis.size.height, options.strength) : 1;
        const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d', { willReadFrequently: true });
        pictureReader = new MotionReader(new engine.CanvasSink(track, { width: decodeWidth, height: decodeHeight, fit: 'fill', poolSize: 3, alpha: true }), origin, origin + duration);
        output = new engine.Output({ format: options.transparentOutput ? new engine.WebMOutputFormat() : new engine.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new engine.BufferTarget() });
        let encodedBytes = 0;
        const countPacket = packet => { encodedBytes += packet.byteLength + (packet.sideData?.alpha?.byteLength ?? 0); if (encodedBytes > MOTION_VIDEO_LIMITS.outputBytes - 1024 * 1024) throw new Error('This result exceeds the local file-size limit.'); };
        videoSource = options.transparentOutput ? await createAlphaCanvasSource(engine, output, canvas, { frameRate: options.frameRate, signal: options.signal, onPacket: countPacket }) : new engine.CanvasSource(canvas, { codec: videoCodec, alpha: options.transparentOutput ? 'keep' : 'discard', quality: new engine.Quality({ bitrate: options.height === 720 ? 3000000 : 1600000 }), hardwareAcceleration: 'prefer-software', keyFrameInterval: 2, onEncodedPacket: countPacket });
        if (!options.transparentOutput) output.addVideoTrack(videoSource, { frameRate: options.frameRate });
        if (audioTrack) {
            audioConfig = await audioTrack.getDecoderConfig();
            if (!audioConfig) throw new Error('This source audio could not be read.');
            audioSource = new engine.EncodedAudioPacketSource('aac'); output.addAudioTrack(audioSource, { decoderConfig: audioConfig });
            audioIterator = new engine.EncodedPacketSink(audioTrack).packets();
        }
        await output.start();
        const flushAudio = async time => {
            if (!audioIterator) return;
            while (true) {
                checkMotionSignal(options.signal);
                if (!pendingAudio) { const next = await audioIterator.next(); if (next.done) break; pendingAudio = next.value; }
                if (pendingAudio.timestamp >= origin + Math.min(duration, time)) break;
                const packet = pendingAudio; pendingAudio = null;
                if (packet.timestamp < origin + duration) {
                    // Preserve the original AAC bytes and encoder priming. Re-encoding adds
                    // padding and changes source duration; packet timing retains the edit list.
                    const mapped = packet.clone({ timestamp: packet.timestamp - origin, duration: Math.min(packet.duration, origin + duration - packet.timestamp) });
                    countPacket(mapped); await audioSource.add(mapped, { decoderConfig: audioConfig });
                }
            }
        };
        let flowPair = null, interpolationFrames = 0, correctionLimitedFrames = 0;
        for (let frame = 0; frame < frameCount; frame++) {
            checkMotionSignal(options.signal);
            const time = frame / options.frameRate, bracket = await pictureReader.bracket(origin + time, options.signal);
            if (!bracket.left) throw new Error('A source picture could not be decoded.');
            context.resetTransform(); context.clearRect(0, 0, width, height);
            if (options.tool === 'optical-flow' && bracket.right && bracket.right.timestamp - bracket.left.timestamp <= .15) {
                const fraction = (origin + time - bracket.left.timestamp) / (bracket.right.timestamp - bracket.left.timestamp);
                if (fraction > .001 && fraction < .999) {
                    if (flowPair?.timestamp !== bracket.left.timestamp) {
                        const left = canvasPixels(bracket.left.canvas), right = canvasPixels(bracket.right.canvas), small = new OffscreenCanvas(analysis.size.width, analysis.size.height), g = small.getContext('2d', { willReadFrequently: true });
                        g.drawImage(bracket.left.canvas, 0, 0, small.width, small.height); const a = grayscale(canvasPixels(small));
                        g.drawImage(bracket.right.canvas, 0, 0, small.width, small.height); const b = grayscale(canvasPixels(small));
                        flowPair = { timestamp: bracket.left.timestamp, left, right, forward: estimateBlockFlow(a, b, { signal: options.signal }), backward: estimateBlockFlow(b, a, { signal: options.signal }) };
                    }
                    const interpolated = interpolateMotionPictures(flowPair.left, flowPair.right, flowPair.forward, flowPair.backward, fraction);
                    if (!globalMotion(flowPair.forward).cut && !globalMotion(flowPair.backward).cut) interpolationFrames++;
                    const picture = new OffscreenCanvas(interpolated.width, interpolated.height); picture.getContext('2d').putImageData(new ImageData(interpolated.data, interpolated.width, interpolated.height), 0, 0); context.drawImage(picture, 0, 0, width, height);
                } else context.drawImage(bracket.left.canvas, 0, 0, width, height);
            } else if (options.tool === 'stabilize') {
                const sample = sampleAt(analysis.samples, time);
                const shiftX = sample.correctionX / analysis.size.width * width * options.strength, shiftY = sample.correctionY / analysis.size.height * height * options.strength, capX = width * (1 - 1 / zoom) / 2, capY = height * (1 - 1 / zoom) / 2, safeX = Math.max(-capX, Math.min(capX, shiftX)), safeY = Math.max(-capY, Math.min(capY, shiftY));
                if (Math.abs(safeX - shiftX) > .01 || Math.abs(safeY - shiftY) > .01) correctionLimitedFrames++;
                context.translate(width / 2, height / 2); context.scale(zoom, zoom); context.drawImage(bracket.left.canvas, -width / 2 + safeX, -height / 2 + safeY, width, height); context.resetTransform();
            } else if (options.tool === 'track-reframe' || options.tool === 'camera-movement') {
                const region = options.tool === 'track-reframe' ? sampleAt(analysis.samples, time).region : null;
                const crop = region ? trackedCrop(decodeWidth, decodeHeight, targetAspect, { x: region.x + region.width / 2, y: region.y + region.height / 2 }) : movementCrop(decodeWidth, decodeHeight, options.from, options.to, time / duration);
                context.drawImage(bracket.left.canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
            } else context.drawImage(bracket.left.canvas, 0, 0, width, height);
            if (options.tool === 'flicker') {
                const gain = 1 + (sampleAt(analysis.samples, time).gain - 1) * options.strength, picture = context.getImageData(0, 0, width, height);
                for (let i = 0; i < picture.data.length; i += 4) { picture.data[i] *= gain; picture.data[i + 1] *= gain; picture.data[i + 2] *= gain; } context.putImageData(picture, 0, 0);
            }
            if (options.processFrame) await options.processFrame(canvas, time, { picture: bracket.left.canvas, duration, origin, width, height });
            checkMotionSignal(options.signal);
            await videoSource.add(time, Math.min(1 / options.frameRate, duration - time));
            await flushAudio(Math.min(duration, (frame + 1) / options.frameRate));
            options.onProgress({ stage: 'encode', done: frame + 1, total: frameCount });
            if (frame % 3 === 0) await yieldToBrowser();
        }
        await flushAudio(duration); videoSource.close(); audioSource?.close(); await output.finalize(); checkMotionSignal(options.signal);
        const extension = options.transparentOutput ? 'webm' : 'mp4', mimeType = options.transparentOutput ? 'video/webm' : 'video/mp4';
        const result = new Blob([output.target.buffer], { type: mimeType });
        if (result.size > MOTION_VIDEO_LIMITS.outputBytes) throw new Error('This result exceeds the local file-size limit.');
        const samples = analysis?.samples || [], reliable = samples.filter(s => s.confidence >= .45).length, lost = samples.filter(s => s.region && !s.region.tracked).length;
        const report = { tool: options.tool, container: extension, videoCodec, transparentOutput: !!options.transparentOutput, seconds: duration, frames: frameCount, frameRate: options.frameRate, width, height, audioPreserved: !!audioSource, analyzedFrames: samples.length, reliableMotionFraction: samples.length > 1 ? reliable / (samples.length - 1) : 0, sceneCuts: samples.filter(s => s.cut).length, trackingLostFrames: lost, interpolationFrames, correctionLimitedFrames, cropZoom: zoom, limits: [] };
        if (options.tool === 'stabilize') { report.limits.push('Translation only; rotation, rolling shutter and parallax are not corrected.'); if (report.reliableMotionFraction < .5) report.limits.push('Reliable camera motion was found in fewer than half the sampled frames. Inspect the result.'); if (zoom > 1.5) report.limits.push('Large shake requires a substantial crop. Inspect the result.'); if (correctionLimitedFrames) report.limits.push(`Large corrections were limited in ${correctionLimitedFrames} frames to keep the picture edges filled.`); }
        if (options.tool === 'flicker') report.limits.push('Corrects uniform exposure variation; local light bands and intentional flashes need manual review.');
        if (options.tool === 'optical-flow') report.limits.push('Bounded block optical flow; fast motion, occlusions and cuts use nearest-frame fallbacks.');
        if (options.tool === 'track-reframe') { report.limits.push('Tracks a selected texture, with no automatic person identification.'); if (lost) report.limits.push(`Tracking was lost in ${lost} analysis frames; the last reliable framing was retained.`); }
        if (options.tool === 'camera-movement') report.limits.push('Original camera pan and zoom; this does not generate new scene content.');
        const name = String(options.name || 'source').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 60) || 'source';
        const file = new File([result], `${name}-${options.tool}.${extension}`, { type: mimeType });
        options.onProgress({ stage: 'done', done: frameCount, total: frameCount }); return { blob: result, file, report };
    } catch (error) {
        videoSource?.close();
        if (output) await output.cancel().catch(() => {});
        checkMotionSignal(options.signal); throw error;
    } finally {
        await Promise.allSettled([audioIterator?.return?.(), pictureReader?.close()]); input.dispose();
    }
}
