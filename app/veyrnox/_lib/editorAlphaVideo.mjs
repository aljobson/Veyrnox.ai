import { checkMotionSignal } from './editorMotionAnalysis.mjs';
export const ALPHA_VIDEO_LIMITS = Object.freeze({ width: 1280, height: 720, frames: 300 });
function alphaBounds(width, height) { if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8 || width > ALPHA_VIDEO_LIMITS.width || height > ALPHA_VIDEO_LIMITS.height || width % 2 || height % 2) throw new Error('Choose bounded even dimensions for transparent video.'); }
/** Two ordinary native VP9 encoders, with no blob Worker or permission exception. */
export async function createAlphaCanvasSource(engine, output, canvas, { frameRate, signal, onPacket } = {}) {
    checkMotionSignal(signal);
    const { width, height } = canvas; alphaBounds(width, height);
    const config = { codec: 'vp09.00.31.08', width, height, bitrate: 2000000, framerate: frameRate, alpha: 'discard', hardwareAcceleration: 'prefer-software', latencyMode: 'quality' };
    if (!(await VideoEncoder.isConfigSupported(config)).supported) throw new Error('This browser cannot encode transparent VP9 video.');
    const colourCanvas = new OffscreenCanvas(width, height), colourContext = colourCanvas.getContext('2d'), pixels = width * height, alphaBytes = new Uint8Array(pixels * 3 / 2); alphaBytes.fill(128, pixels);
    const source = new engine.EncodedVideoPacketSource('vp9'); output.addVideoTrack(source, { frameRate, canBeTransparent: true });
    let colourPackets = [], alphaPackets = [], metadata, failure, frames = 0, closed = false;
    const colourEncoder = new VideoEncoder({ output(chunk, meta) { colourPackets.push(chunk); if (meta?.decoderConfig) metadata = meta; }, error(error) { failure = error; } });
    const alphaEncoder = new VideoEncoder({ output(chunk) { alphaPackets.push(chunk); }, error(error) { failure = error; } });
    try { colourEncoder.configure(config); alphaEncoder.configure(config); }
    catch (error) { for (const encoder of [colourEncoder, alphaEncoder]) if (encoder.state !== 'closed') encoder.close(); source.close(); throw error; }
    const close = () => { if (closed) return; closed = true; for (const encoder of [colourEncoder, alphaEncoder]) if (encoder.state !== 'closed') encoder.close(); source.close(); colourPackets = []; alphaPackets = []; };
    return {
        async add(timestamp, duration) {
            checkMotionSignal(signal); if (closed) throw new Error('The transparent encoder was closed.');
            if (++frames > ALPHA_VIDEO_LIMITS.frames || !Number.isFinite(timestamp) || !Number.isFinite(duration) || timestamp < 0 || duration <= 0) throw new Error('Transparent video exceeded its frame or timing bounds.');
            const image = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height);
            for (let i = 0; i < pixels; i++) { alphaBytes[i] = image.data[i * 4 + 3]; image.data[i * 4 + 3] = 255; }
            colourContext.putImageData(image, 0, 0);
            const timing = { timestamp: Math.round(timestamp * 1000000), duration: Math.round(duration * 1000000) };
            const colour = new VideoFrame(colourCanvas, timing), alpha = new VideoFrame(alphaBytes, { ...timing, format: 'I420', codedWidth: width, codedHeight: height, colorSpace: { fullRange: true, matrix: 'bt709', primaries: 'bt709', transfer: 'bt709' } });
            try { colourEncoder.encode(colour, { keyFrame: true }); alphaEncoder.encode(alpha, { keyFrame: true }); }
            finally { colour.close(); alpha.close(); }
            await Promise.all([colourEncoder.flush(), alphaEncoder.flush()]); checkMotionSignal(signal);
            if (failure) throw failure;
            if (colourPackets.length !== 1 || alphaPackets.length !== 1 || !metadata || colourPackets[0].timestamp !== alphaPackets[0].timestamp) throw new Error('The transparent picture streams did not align.');
            const colourChunk = colourPackets.shift(), alphaChunk = alphaPackets.shift(), alphaData = new Uint8Array(alphaChunk.byteLength); alphaChunk.copyTo(alphaData);
            const packet = engine.EncodedPacket.fromEncodedChunk(colourChunk, { alpha: alphaData }); onPacket?.(packet); await source.add(packet, metadata);
        },
        close,
    };
}
async function alphaPlane(frame, width, height) {
    if (['I420', 'I422', 'I444', 'NV12'].includes(frame.format)) {
        const bytes = new Uint8Array(frame.allocationSize()), layout = await frame.copyTo(bytes), values = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) values.set(bytes.subarray(layout[0].offset + y * layout[0].stride, layout[0].offset + y * layout[0].stride + width), y * width);
        return values;
    }
    const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(frame, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data, values = new Uint8Array(width * height); for (let i = 0; i < values.length; i++) values[i] = pixels[i * 4]; return values;
}
let registered = false;
/** Scoped 8-bit, <=720p VP9 adapter. Other codecs/sizes keep their ordinary decoder. */
export async function registerLocalVp9AlphaDecoder(providedEngine) {
    if (registered || typeof VideoDecoder === 'undefined' || typeof OffscreenCanvas === 'undefined') return;
    const engine = providedEngine ?? await import('mediabunny');
    class LocalVp9Decoder extends engine.CustomVideoDecoder {
        static supports(codec, config) { return codec === 'vp9' && config.codec?.startsWith('vp09.00.') && config.codedWidth >= 8 && config.codedWidth <= ALPHA_VIDEO_LIMITS.width && config.codedHeight >= 8 && config.codedHeight <= ALPHA_VIDEO_LIMITS.height && config.codedWidth % 2 === 0 && config.codedHeight % 2 === 0; }
        init() {
            this.pending = new Map(); this.closed = false; this.failure = null;
            const receive = (channel, frame) => { const job = this.pending.get(frame.timestamp); if (!job || job.finishing || this.closed) { frame.close(); return; } job[channel] = frame; if (job.colour && (!job.needsAlpha || job.alpha)) void this.finish(job); };
            this.fail = cause => { this.failure = cause; for (const job of this.pending.values()) { clearTimeout(job.timeout); job.colour?.close(); job.alpha?.close(); job.reject(cause); } this.pending.clear(); if (!this.closed) this.onError(cause); };
            const error = cause => this.fail(cause);
            this.colourDecoder = new VideoDecoder({ output: frame => receive('colour', frame), error }); this.alphaDecoder = new VideoDecoder({ output: frame => receive('alpha', frame), error });
            this.colourDecoder.configure({ ...this.config, hardwareAcceleration: 'prefer-software' }); this.alphaDecoder.configure({ ...this.config, hardwareAcceleration: 'prefer-software' });
        }
        async finish(job) {
            job.finishing = true;
            try {
                if (!job.needsAlpha) { this.onSample(new engine.VideoSample(job.colour)); job.colour = null; }
                else {
                    const width = job.colour.displayWidth, height = job.colour.displayHeight; alphaBounds(width, height);
                    const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(job.colour, 0, 0);
                    const picture = context.getImageData(0, 0, width, height), alpha = await alphaPlane(job.alpha, width, height);
                    for (let i = 0; i < alpha.length; i++) picture.data[i * 4 + 3] = alpha[i];
                    const frame = new VideoFrame(picture.data, { format: 'RGBA', codedWidth: width, codedHeight: height, timestamp: job.timestamp, duration: job.duration });
                    if (this.closed) { frame.close(); throw new Error('The transparent decoder was closed.'); }
                    this.onSample(new engine.VideoSample(frame));
                }
                job.resolve();
            } catch (error) { job.reject(error); if (!this.closed) this.onError(error); }
            finally { clearTimeout(job.timeout); this.pending.delete(job.timestamp); job.colour?.close(); job.alpha?.close(); }
        }
        decode(packet) {
            if (this.failure) throw this.failure;
            if (this.closed || this.pending.size >= 8 || this.pending.has(packet.microsecondTimestamp)) throw new Error('The transparent decoder exceeded its bounds.');
            const timestamp = packet.microsecondTimestamp;
            return new Promise((resolve, reject) => {
                const job = { timestamp, duration: packet.microsecondDuration, needsAlpha: !!packet.sideData.alpha, resolve, reject, colour: null, alpha: null }; job.timeout = setTimeout(() => this.fail(new Error('Transparent frame decoding timed out.')), 15000); this.pending.set(timestamp, job);
                try { this.colourDecoder.decode(packet.toEncodedVideoChunk()); if (job.needsAlpha) this.alphaDecoder.decode(packet.alphaToEncodedVideoChunk()); }
                catch (error) { clearTimeout(job.timeout); this.pending.delete(timestamp); reject(error); }
            });
        }
        async flush() { if (this.failure) throw this.failure; await Promise.all([this.colourDecoder.flush(), this.alphaDecoder.flush()]); }
        close() { if (this.closed) return; this.closed = true; for (const decoder of [this.colourDecoder, this.alphaDecoder]) if (decoder?.state !== 'closed') decoder?.close(); for (const job of this.pending.values()) { clearTimeout(job.timeout); job.colour?.close(); job.alpha?.close(); job.reject(new Error('The transparent decoder was closed.')); } this.pending.clear(); }
    }
    engine.registerDecoder(LocalVp9Decoder); registered = true;
}
